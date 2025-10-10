import { supabase } from "../../services/supabaseClient.js";
import { v4 as uuidv4 } from "uuid";

/**
 * POST /api/case/spin
 * body: { case_id: uuid, telegram_id: number, pay_with: 'tickets'|'stars', idempotency_key?: uuid }
 * поведение:
 *  - списывает оплату (tickets или stars)
 *  - выбирает шанс из case_chance (is_active=true, quantity>0)
 *  - если выпадает nft_name='lose' → статус 'lose'
 *  - если приз → пишет спин со статусом 'pending'
 */
export const spinCase = async (req, res) => {
  try {
    const { case_id, telegram_id, pay_with = "tickets", idempotency_key } = req.body;
    if (!case_id || !telegram_id) {
      return res.status(400).json({ error: "case_id и telegram_id обязательны" });
    }
    if (!["tickets", "stars"].includes(pay_with)) {
      return res.status(400).json({ error: "pay_with должен быть 'tickets' или 'stars'" });
    }

    // кейс
    const { data: caseRow, error: caseErr } = await supabase
      .from("cases")
      .select("id, price, is_active, allow_stars")
      .eq("id", case_id)
      .single();
    if (caseErr || !caseRow || !caseRow.is_active) {
      return res.status(404).json({ error: "Кейс не найден или не активен" });
    }
    if (pay_with === "stars" && !caseRow.allow_stars) {
      return res.status(403).json({ error: "Оплата звёздами запрещена для этого кейса" });
    }

    // пользователь
    const { data: user, error: userErr } = await supabase
      .from("users")
      .select("id, telegram_id, tickets, stars")
      .eq("telegram_id", telegram_id)
      .single();
    if (userErr || !user) return res.status(404).json({ error: "Пользователь не найден" });

    // оплата
    let pay_with_tickets = null; // логируем TON-эквивалент для tickets/stars
    let pay_with_ton = null;     // прямой TON-платёж (на будущее)
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
    } else if (pay_with === "stars") {
      // курс (stars за 1 TON)
      const { data: rateRow, error: rateErr } = await supabase
        .from("fx_rates")
        .select("stars_per_ton")
        .eq("id", 1)
        .single();
      if (rateErr || !rateRow || !Number(rateRow.stars_per_ton)) {
        return res.status(500).json({ error: "Не задан курс stars_per_ton" });
      }
      const starsPerTon = Number(rateRow.stars_per_ton);
      const priceTon = Number(caseRow.price);
      const priceStars = Math.ceil(priceTon * starsPerTon);
      if ((user.stars || 0) < priceStars) {
        return res.status(402).json({ error: `Недостаточно звёзд (нужно ${priceStars})` });
      }
      // списываем звёзды — триггер БД пересчитает tickets автоматически
      const { error: updErr } = await supabase
        .from("users")
        .update({ stars: Number(user.stars || 0) - priceStars })
        .eq("id", user.id);
      if (updErr) return res.status(500).json({ error: updErr.message });
      pay_with_tickets = priceTon; // лог: эквивалент в TON
    }

    // активные шансы с запасом
    const { data: chances, error: chErr } = await supabase
      .from("case_chance")
      .select("id, nft_name, weight, percent, price, payout_value, quantity, is_active")
      .eq("case_id", case_id)
      .eq("is_active", true)
      .gt("quantity", 0);
    if (chErr) return res.status(500).json({ error: chErr.message });

    // если ничего доступного — фиксируем проигрыш
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
          pay_with: (pay_with === "stars" ? "stars" : "tickets"),
          reroll_amount: null,
          idempotency_key: idem
        }])
        .select("id")
        .single();
      if (spinLoseErr) return res.status(500).json({ error: spinLoseErr.message });
      return res.json({ spin_id: spinLose.id, status: "lose" });
    }

    // RNG выбор
    const weightsSum = chances.reduce((s, c) => s + Number(c.weight), 0);
    const roll = Math.random() * weightsSum;
    let pick = null;
    let acc = 0;
    for (const c of chances) {
      acc += Number(c.weight);
      if (roll <= acc) { pick = c; break; }
    }
    if (!pick) pick = chances[chances.length - 1];

    // если выпал шанс "lose" — фиксируем проигрыш
    if (pick.nft_name === "lose") {
      const spinId = uuidv4();
      const idem = idempotency_key || uuidv4();
      const { error: spinLoseErr } = await supabase
        .from("case_spins")
        .insert([{
          id: spinId,
          case_id,
          user_id: user.id,
          chance_id: null,
          status: "lose",
          rng_roll: roll,
          weights_sum: weightsSum,
          pay_with_tickets,
          pay_with_ton,
          pay_with: (pay_with === "stars" ? "stars" : "tickets"),
          reroll_amount: null,
          idempotency_key: idem
        }]);
      if (spinLoseErr) return res.status(500).json({ error: spinLoseErr.message });
      return res.json({ spin_id: spinId, status: "lose" });
    }

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
        pay_with: (pay_with === "stars" ? "stars" : "tickets"),
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
        nft_name: pick.nft_name,
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
 * Продаём приз → начисляем в валюте исходной оплаты спина:
 *  - если спин был за stars → возвращаем звёзды (payout_stars, иначе конвертируем payout_value в stars)
 *  - если спин был за tickets → возвращаем TON (payout_value)
 */
export const rerollPrize = async (req, res) => {
  try {
    const { id } = req.params;

    // спин
    const { data: spin, error: spinErr } = await supabase
      .from("case_spins")
      .select("id, user_id, chance_id, status, pay_with")
      .eq("id", id)
      .single();
    if (spinErr || !spin) return res.status(404).json({ error: "spin not found" });
    if (spin.status !== "pending") {
      return res.status(409).json({ error: "invalid state (ожидается pending)" });
    }
    if (!spin.chance_id) {
      return res.status(409).json({ error: "nothing to reroll (lose)" });
    }
    const payWith = spin.pay_with === "stars" ? "stars" : "tickets";

    // шанс/приз
    const { data: chance, error: chErr } = await supabase
      .from("case_chance")
      .select("id, payout_value, payout_stars")
      .eq("id", spin.chance_id)
      .single();
    if (chErr || !chance) return res.status(404).json({ error: "chance not found" });

    // пользователь
    const { data: user, error: userErr } = await supabase
      .from("users")
      .select("id, stars, tickets")
      .eq("id", spin.user_id)
      .single();
    if (userErr || !user) return res.status(404).json({ error: "user not found" });

    let reroll_amount_stars = null;
    let reroll_amount_tickets = null;

    if (payWith === "stars") {
      // при оплате звёздами — возвращаем звёзды
      if (Number(chance.payout_stars) > 0) {
        reroll_amount_stars = Number(chance.payout_stars);
      } else {
        // конвертируем payout_value (TON) → в звёзды по текущему курсу
        const { data: rateRow, error: rateErr } = await supabase
          .from("fx_rates")
          .select("stars_per_ton")
          .eq("id", 1)
          .single();
        if (rateErr || !rateRow) return res.status(500).json({ error: "Не задан курс stars_per_ton" });
        const starsPerTon = Number(rateRow.stars_per_ton || 0);
        reroll_amount_stars = Math.max(0, Math.ceil((Number(chance.payout_value) || 0) * starsPerTon));
      }

      const { error: updErr } = await supabase
        .from("users")
        .update({ stars: Number(user.stars || 0) + reroll_amount_stars })
        .eq("id", user.id);
      if (updErr) return res.status(500).json({ error: updErr.message });

    } else {
      // при оплате билетами — возвращаем TON (tickets)
      reroll_amount_tickets = Number(chance.payout_value) || 0;

      const { error: updErr } = await supabase
        .from("users")
        .update({ tickets: Number(user.tickets || 0) + reroll_amount_tickets })
        .eq("id", user.id);
      if (updErr) return res.status(500).json({ error: updErr.message });
    }

    // статус спина
    const { error: updSpinErr } = await supabase
      .from("case_spins")
      .update({
        status: "reroll",
        reroll_amount: reroll_amount_tickets ?? null // старое поле (TON) — для совместимости
      })
      .eq("id", spin.id);
    if (updSpinErr) return res.status(500).json({ error: updSpinErr.message });

    // готовый текст для фронта
    const message = payWith === "stars"
      ? `Обменять этот подарок на ${reroll_amount_stars} ⭐?`
      : `Обменять этот подарок на ${reroll_amount_tickets} TON?`;

    return res.json({
      status: "reroll",
      pay_with: payWith,
      reroll_amount_stars,
      reroll_amount_tickets,
      message
    });
  } catch {
    return res.status(500).json({ error: "rerollPrize failed" });
  }
};

/**
 * POST /api/case/spin/:id/claim
 * выдаём приз:
 *  - ищем реальный подарок в gifts_for_cases по nft_name (used=false или is_infinite=true)
 *  - если подарок конечный — помечаем used=true
 *  - уменьшаем quantity в case_chance на 1
 *  - создаём запись в pending_rewards (source='case')
 *  - ставим статус спина 'reward_sent'
 */
/**
 * POST /api/case/spin/:id/claim
 * Если nft_name указывает на звездный приз (например, "2 звезды", "5 ⭐", "5 stars"),
 * то зачисляем звезды во внутренний баланс и НЕ кладём в pending_rewards.
 * Иначе — старая логика с gifts_for_cases.
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
      .select("id, nft_name, quantity")
      .eq("id", spin.chance_id)
      .single();
    if (chErr || !chance) return res.status(404).json({ error: "chance not found" });
    if (Number(chance.quantity) <= 0) {
      return res.status(409).json({ error: "out of stock" });
    }

    // --- ПРАВИЛО ДЛЯ ЗВЁЗД ПО НАЗВАНИЮ nft_name ---
    // Пытаемся извлечь число звёзд из названия: "2 звезды", "5 звезд", "3 ⭐", "4 stars" и т.д.
    const name = String(chance.nft_name || "").trim().toLowerCase();

    // 1) быстрая проверка: есть ли признак звёзд
    const looksLikeStars =
      name.includes("звезд") || name.includes("звезды") || name.includes("звезда") ||
      name.includes("star") || name.includes("⭐");

    // 2) извлекаем число (первое число в названии)
    let starsPrize = 0;
    if (looksLikeStars) {
      const matchNum = name.match(/(\d+)/); // первое число
      if (matchNum) starsPrize = Number(matchNum[1]);
    }

    if (starsPrize > 0) {
      // пользователь
      const { data: user, error: userErr } = await supabase
        .from("users")
        .select("id, stars")
        .eq("id", spin.user_id)
        .single();
      if (userErr || !user) return res.status(404).json({ error: "user not found" });

      // 1) зачисляем звезды во внутренний баланс
      const { error: addErr } = await supabase
        .from("users")
        .update({ stars: Number(user.stars || 0) + starsPrize })
        .eq("id", user.id);
      if (addErr) return res.status(500).json({ error: addErr.message });

      // 2) уменьшаем quantity у шанса
      const { error: decErr } = await supabase
        .from("case_chance")
        .update({ quantity: Number(chance.quantity) - 1 })
        .eq("id", chance.id);
      if (decErr) return res.status(500).json({ error: decErr.message });

      // 3) помечаем спин завершённым (без pending_rewards)
      const { error: updErr } = await supabase
        .from("case_spins")
        .update({ status: "reward_sent" })
        .eq("id", spin.id);
      if (updErr) return res.status(500).json({ error: updErr.message });

      return res.json({ status: "reward_sent" });
    }
    // --- конец правила для звёзд ---

    // ===== СТАРАЯ ЛОГИКА С РЕАЛЬНЫМИ ПОДАРКАМИ =====

    // 1) ищем доступный подарок по nft_name (случайный один экземпляр)
    const { data: availableGifts, error: giftErr } = await supabase
      .from("gifts_for_cases")
      .select("pending_id, nft_number, msg_id, nft_name, transfer_stars, link, is_infinite, used")
      .eq("nft_name", chance.nft_name)
      .eq("used", false)
      .limit(50);
    if (giftErr || !availableGifts?.length) {
      return res.status(409).json({ error: "no available gift" });
    }
    const gift = availableGifts[Math.floor(Math.random() * availableGifts.length)];

    // 2) если это не бесконечный — помечаем used=true
    if (!gift.is_infinite) {
      const { error: markErr } = await supabase
        .from("gifts_for_cases")
        .update({ used: true })
        .eq("pending_id", gift.pending_id);
      if (markErr) return res.status(500).json({ error: markErr.message });
    }

    // 3) уменьшаем quantity только после успешного выбора подарка
    const { error: decErr } = await supabase
      .from("case_chance")
      .update({ quantity: Number(chance.quantity) - 1 })
      .eq("id", chance.id);
    if (decErr) return res.status(500).json({ error: decErr.message });

    // подтягиваем телеграм победителя
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
      msg_id: gift.msg_id,
      status: "pending",
      created_at: new Date().toISOString().slice(11, 19) // HH:MM:SS (если в БД тип time)
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
