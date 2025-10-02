import { supabase } from "../../services/supabaseClient.js";
import { v4 as uuidv4 } from "uuid";

/**
 * POST /api/case/spin
 * body: { case_id: uuid, telegram_id: number, pay_with: 'tickets'|'ton', idempotency_key?: uuid }
 * поведение:
 *  - списывает оплату (если tickets)
 *  - выбирает шанс из case_chance (is_active=true, quantity>0)
 *  - если ничего нет → статус 'lose'
 *  - если есть приз → пишет спин со статусом 'pending' (для дальнейшего claim/reroll)
 */
export const spinCase = async (req, res) => {
  try {
    const { case_id, telegram_id, pay_with = "ton", idempotency_key } = req.body;
    if (!case_id || !telegram_id) {
      return res.status(400).json({ error: "case_id и telegram_id обязательны" });
    }
    if (pay_with !== "tickets" && pay_with !== "ton") {
      return res.status(400).json({ error: "pay_with должен быть 'tickets' или 'ton'" });
    }

    // кейс
    const { data: caseRow, error: caseErr } = await supabase
      .from("cases")
      .select("id, price, is_active")
      .eq("id", case_id)
      .single();
    if (caseErr || !caseRow || !caseRow.is_active) {
      return res.status(404).json({ error: "Кейс не найден или не активен" });
    }

    // пользователь
    const { data: user, error: userErr } = await supabase
      .from("users")
      .select("id, telegram_id, tickets")
      .eq("telegram_id", telegram_id)
      .single();
    if (userErr || !user) return res.status(404).json({ error: "Пользователь не найден" });

    // оплата
    let pay_with_tickets = null;
    let pay_with_ton = null;
    if (pay_with === "tickets") {
      const price = Number(caseRow.price);
      if ((user.tickets || 0) < price) {
        return res.status(402).json({ error: `Недостаточно билетов (нужно ${price})` });
      }
      const { error: updErr } = await supabase
        .from("users")
        .update({ tickets: Number(user.tickets) - price })
        .eq("id", user.id);
      if (updErr) return res.status(500).json({ error: updErr.message });
      pay_with_tickets = price;
    } else {
      // TON — списание не через users; просто логируем сумму
      pay_with_ton = Number(caseRow.price);
    }

    // активные шансы с запасом
    const { data: chances, error: chErr } = await supabase
      .from("case_chance")
      .select("id, slug, weight, price, payout_value, quantity, is_active")
      .eq("case_id", case_id)
      .eq("is_active", true)
      .gt("quantity", 0);
    if (chErr) return res.status(500).json({ error: chErr.message });

    // если ничего доступного — проигрыш
    if (!chances || chances.length === 0) {
      const spinId = uuidv4();
      const idem = idempotency_key || uuidv4();
      const { data: spinLose, error: spinLoseErr } = await supabase
        .from("case_spins")
        .insert([{
          id: spinId,
          case_id,
          user_id: user.id,
          chance_id: null,
          status: "lose",
          rng_roll: 0,
          weights_sum: 0,
          pay_with_tickets,
          pay_with_ton,
          reroll_amount: null,
          idempotency_key: idem
        }])
        .select("id")
        .single();
      if (spinLoseErr) return res.status(500).json({ error: spinLoseErr.message });
      return res.json({ spin_id: spinLose.id, status: "lose" });
    }

    // RNG
    const weightsSum = chances.reduce((s, c) => s + Number(c.weight), 0);
    const roll = Math.random() * weightsSum;
    let pick = null;
    let acc = 0;
    for (const c of chances) {
      acc += Number(c.weight);
      if (roll <= acc) { pick = c; break; }
    }
    if (!pick) pick = chances[chances.length - 1];

    // запись спина со статусом "pending"
    const spinId = uuidv4();
    const idem = idempotency_key || uuidv4();
    const { data: spinWin, error: spinWinErr } = await supabase
      .from("case_spins")
      .insert([{
        id: spinId,
        case_id,
        user_id: user.id,
        chance_id: pick.id,
        status: "pending",
        rng_roll: roll,
        weights_sum: weightsSum,
        pay_with_tickets,
        pay_with_ton,
        reroll_amount: null,
        idempotency_key: idem
      }])
      .select("id")
      .single();
    if (spinWinErr) return res.status(500).json({ error: spinWinErr.message });

    return res.json({
      spin_id: spinWin.id,
      status: "pending",
      rng_roll: roll,
      prize: {
        chance_id: pick.id,
        slug: pick.slug,
        price: pick.price,
        payout_value: pick.payout_value
      }
    });
  } catch (e) {
    return res.status(500).json({ error: "spinCase failed" });
  }
};

/**
 * POST /api/case/spin/:id/reroll
 * продаём приз → начисляем payout_value билетами, статус 'reroll'
 * ВАЖНО: quantity в case_chance НЕ уменьшаем.
 */
export const rerollPrize = async (req, res) => {
  try {
    const { id } = req.params;

    // грузим спин + шанс
    const { data: spin, error: spinErr } = await supabase
      .from("case_spins")
      .select("id, user_id, chance_id, status")
      .eq("id", id)
      .single();
    if (spinErr || !spin) return res.status(404).json({ error: "spin not found" });
    if (spin.status !== "pending") {
      return res.status(409).json({ error: "invalid state (ожидается pending)" });
    }
    if (!spin.chance_id) {
      return res.status(409).json({ error: "nothing to reroll (lose)" });
    }

    const { data: chance, error: chErr } = await supabase
      .from("case_chance")
      .select("id, payout_value")
      .eq("id", spin.chance_id)
      .single();
    if (chErr || !chance) return res.status(404).json({ error: "chance not found" });

    const payout = Number(chance.payout_value) || 0;

    // начисляем билеты пользователю
    const { data: user } = await supabase.from("users").select("id, tickets").eq("id", spin.user_id).single();
    if (user) {
      await supabase
        .from("users")
        .update({ tickets: Number(user.tickets || 0) + payout })
        .eq("id", spin.user_id);
    }

    // статус спина
    const { error: updErr } = await supabase
      .from("case_spins")
      .update({ status: "reroll", reroll_amount: payout })
      .eq("id", spin.id);
    if (updErr) return res.status(500).json({ error: updErr.message });

    return res.json({ status: "reroll", reroll_amount: payout });
  } catch {
    return res.status(500).json({ error: "rerollPrize failed" });
  }
};

/**
 * POST /api/case/spin/:id/claim
 * выдаём приз:
 *  - уменьшаем quantity в case_chance на 1
 *  - ищем реальный подарок в gifts_for_cases по slug (used=false)
 *  - помечаем его used=true
 *  - создаём запись в pending_rewards (source='case')
 *  - ставим статус спина 'reward_sent'
 */
export const claimPrize = async (req, res) => {
  try {
    const { id } = req.params;

    // спин
    const { data: spin, error: spinErr } = await supabase
      .from("case_spins")
      .select("id, user_id, chance_id, status")
      .eq("id", id)
      .single();
    if (spinErr || !spin) return res.status(404).json({ error: "spin not found" });
    if (spin.status !== "pending") {
      return res.status(409).json({ error: "invalid state (ожидается pending)" });
    }
    if (!spin.chance_id) {
      return res.status(409).json({ error: "nothing to claim (lose)" });
    }

    // шанс/приз
    const { data: chance, error: chErr } = await supabase
      .from("case_chance")
      .select("id, slug, quantity")
      .eq("id", spin.chance_id)
      .single();
    if (chErr || !chance) return res.status(404).json({ error: "chance not found" });
    if (Number(chance.quantity) <= 0) {
      return res.status(409).json({ error: "out of stock" });
    }

    // уменьшаем quantity
    const { error: decErr } = await supabase
      .from("case_chance")
      .update({ quantity: Number(chance.quantity) - 1 })
      .eq("id", chance.id);
    if (decErr) return res.status(500).json({ error: decErr.message });

    // берём реальный подарок
    const { data: gift, error: giftErr } = await supabase
      .from("gifts_for_cases")
      .select("pending_id, nft_number, msg_id, slug, nft_name, transfer_stars, link")
      .eq("slug", chance.slug)
      .eq("used", false)
      .limit(1)
      .single();
    if (giftErr || !gift) return res.status(409).json({ error: "no available gift" });

    // помечаем used=true
    const { error: markErr } = await supabase
      .from("gifts_for_cases")
      .update({ used: true })
      .eq("pending_id", gift.pending_id);
    if (markErr) return res.status(500).json({ error: markErr.message });

    // подтягиваем telegram_id/username победителя
    const { data: winUser } = await supabase
      .from("users")
      .select("telegram_id, username")
      .eq("id", spin.user_id)
      .single();

    // кладём в очередь на отправку
    const { error: prErr } = await supabase.from("pending_rewards").insert([{
      source: "case",
      spin_id: spin.id,
      winner_id: spin.user_id,
      telegram_id: winUser?.telegram_id ?? null,
      username: winUser?.username ?? null,
      nft_name: gift.nft_name,
      nft_number: gift.nft_number,
      slug: gift.slug,
      msg_id: gift.msg_id,
      status: "pending",
      created_at: new Date().toISOString().slice(11, 19) // HH:MM:SS (тип time в БД)
    }]);
    if (prErr) return res.status(500).json({ error: prErr.message });

    // статус спина
    const { error: updErr } = await supabase
      .from("case_spins")
      .update({ status: "reward_sent" })
      .eq("id", spin.id);
    if (updErr) return res.status(500).json({ error: updErr.message });

    return res.json({ status: "reward_sent" });
  } catch {
    return res.status(500).json({ error: "claimPrize failed" });
  }
};
