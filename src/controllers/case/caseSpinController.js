import { supabase } from "../../services/supabaseClient.js";
import { v4 as uuidv4 } from "uuid";

/**
 * POST /api/case/spin
 * body: { case_id: uuid, telegram_id: number, pay_with: 'tickets'|'stars'|'free', idempotency_key?: uuid }
 */
export const spinCase = async (req, res) => {
  try {
    const { case_id, telegram_id, pay_with = "tickets", idempotency_key } = req.body;
    if (!case_id || !telegram_id) {
      return res.status(400).json({ error: "case_id и telegram_id обязательны" });
    }
    // ✅ добавили поддержку 'free'
    if (!["tickets", "stars", "free"].includes(pay_with)) {
      return res.status(400).json({ error: "pay_with должен быть 'tickets' | 'stars' | 'free'" });
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

    // пользователь (+ referred_by для рефералок)  ✅ добавили free_spin_last_at
    const { data: user, error: userErr } = await supabase
      .from("users")
      .select("id, telegram_id, tickets, stars, referred_by, free_spin_last_at")
      .eq("telegram_id", telegram_id)
      .single();
    if (userErr || !user) return res.status(404).json({ error: "Пользователь не найден" });

    // Если бесплатный спин — он доступен ТОЛЬКО для самого дешёвого активного кейса
    let cheapestCaseId = null;
    if (pay_with === "free") {
      const { data: cheap, error: cheapErr } = await supabase
        .from("cases")
        .select("id")
        .eq("is_active", true)
        .order("price", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (cheapErr || !cheap?.id) {
        return res.status(404).json({ error: "Нет доступных кейсов для бесплатного спина" });
      }
      cheapestCaseId = cheap.id;
      if (cheapestCaseId !== case_id) {
        return res.status(403).json({ error: "Бесплатный спин доступен только для самого дешёвого кейса" });
      }
    }

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
    } else if (pay_with === "free") {
      // ✅ Бесплатный спин: проверяем 1-е пополнение и кулдаун 24ч. Ничего не списываем.
      const { data: dep, error: derr } = await supabase
        .from("sells")
        .select("telegram_id, amount, amount_ton")
        .eq("telegram_id", telegram_id)
        .limit(1);
      if (derr) return res.status(500).json({ error: derr.message });
      const hasDeposit = !!(dep && dep.length && ((dep[0].amount ?? dep[0].amount_ton ?? 0) > 0));
      if (!hasDeposit) {
        return res.status(403).json({ error: "Бесплатный спин доступен после первого пополнения" });
      }
      const last = user.free_spin_last_at ? new Date(user.free_spin_last_at) : new Date(0);
      const canFree = Date.now() >= (last.getTime() + 24 * 60 * 60 * 1000);
      if (!canFree) {
        return res.status(429).json({ error: "Слишком рано для бесплатного спина" });
      }
      // Ничего не списываем.
    }

    // === Реферальные отчисления 10% от цены кейса (TON) ===
    try {
      const referrerId = user.referred_by || null;
      const refAmountTon = Number(caseRow.price || 0) * 0.05;
      if (referrerId && refAmountTon > 0) {
        // журнал
        await supabase.from("referral_earnings").insert([{
          referrer_id: referrerId,
          referred_id: user.id,
          wheel_id: null,
          amount: refAmountTon
        }]);

        // инкремент users.referral_earnings
        const { data: refUser } = await supabase
          .from("users")
          .select("referral_earnings")
          .eq("id", referrerId)
          .single();

        const current = Number(refUser?.referral_earnings || 0);
        await supabase
          .from("users")
          .update({ referral_earnings: current + refAmountTon })
          .eq("id", referrerId);
      }
    } catch (e) {
      console.warn("[referral] skipped:", e?.message || e);
    }
    // === /рефералки ===

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
          // ✅ сохраняем как есть, чтобы 'free' тоже попал
          pay_with: pay_with,
          reroll_amount: null,
          idempotency_key: idem
        }])
        .select("id")
        .single();
      if (spinLoseErr) return res.status(500).json({ error: spinLoseErr.message });

      // ✅ отметим использование бесплатного спина
      if (pay_with === "free") {
        await supabase
          .from("users")
          .update({ free_spin_last_at: new Date().toISOString(), free_spin_last_notified_at: null })
          .eq("id", user.id);
      }

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
          // ✅ сохраняем как есть
          pay_with: pay_with,
          reroll_amount: null,
          idempotency_key: idem
        }]);
      if (spinLoseErr) return res.status(500).json({ error: spinLoseErr.message });

      // ✅ отметим использование бесплатного спина
      if (pay_with === "free") {
        await supabase
          .from("users")
          .update({ free_spin_last_at: new Date().toISOString(), free_spin_last_notified_at: null })
          .eq("id", user.id);
      }

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
        // ✅ сохраняем как есть
        pay_with: pay_with,
        reroll_amount: null,
        idempotency_key: idem
      }])
      .select("id")
      .single();
    if (spinWinErr) return res.status(500).json({ error: spinWinErr.message });

    // ✅ отметим использование бесплатного спина
    if (pay_with === "free") {
      await supabase
        .from("users")
        .update({ free_spin_last_at: new Date().toISOString(), free_spin_last_notified_at: null })
        .eq("id", user.id);
    }

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
 * Продаём приз → начисляем в валюте исходной оплаты спина
 */
export const rerollPrize = async (req, res) => {
  try {
    const { id } = req.params;

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

    const { data: chance, error: chErr } = await supabase
      .from("case_chance")
      .select("id, payout_value, payout_stars")
      .eq("id", spin.chance_id)
      .single();
    if (chErr || !chance) return res.status(404).json({ error: "chance not found" });

    const { data: user, error: userErr } = await supabase
      .from("users")
      .select("id, stars, tickets")
      .eq("id", spin.user_id)
      .single();
    if (userErr || !user) return res.status(404).json({ error: "user not found" });

    let reroll_amount_stars = null;
    let reroll_amount_tickets = null;

    if (payWith === "stars") {
      if (Number(chance.payout_stars) > 0) {
        reroll_amount_stars = Number(chance.payout_stars);
      } else {
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
      reroll_amount_tickets = Number(chance.payout_value) || 0;

      const { error: updErr } = await supabase
        .from("users")
        .update({ tickets: Number(user.tickets || 0) + reroll_amount_tickets })
        .eq("id", user.id);
      if (updErr) return res.status(500).json({ error: updErr.message });
    }

    const { error: updSpinErr } = await supabase
      .from("case_spins")
      .update({
        status: "reroll",
        reroll_amount: reroll_amount_tickets ?? null
      })
      .eq("id", spin.id);
    if (updSpinErr) return res.status(500).json({ error: updSpinErr.message });

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
 * Добавлено: списание claim_price=25⭐ для не-«звёздных» призов.
 */
export const claimPrize = async (req, res) => {
  try {
    const { id } = req.params;

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

    // 👉 Тянем claim_price
    const { data: chance, error: chErr } = await supabase
      .from("case_chance")
      .select("id, nft_name, quantity, claim_price")
      .eq("id", spin.chance_id)
      .single();
    if (chErr || !chance) return res.status(404).json({ error: "chance not found" });
    if (Number(chance.quantity) <= 0) {
      return res.status(409).json({ error: "out of stock" });
    }

    const name = String(chance.nft_name || "").trim().toLowerCase();
    const looksLikeStars =
      name.includes("звезд") || name.includes("звезды") || name.includes("звезда") ||
      name.includes("star") || name.includes("⭐");
    let starsPrize = 0;
    if (looksLikeStars) {
      const matchNum = name.match(/(\d+)/);
      if (matchNum) starsPrize = Number(matchNum[1]);
    }

    // ⭐ Призы-звёзды — без оплаты claim_price, как раньше
    if (starsPrize > 0) {
      const { data: user, error: userErr } = await supabase
        .from("users")
        .select("id, stars")
        .eq("id", spin.user_id)
        .single();
      if (userErr || !user) return res.status(404).json({ error: "user not found" });

      const { error: addErr } = await supabase
        .from("users")
        .update({ stars: Number(user.stars || 0) + starsPrize })
        .eq("id", user.id);
      if (addErr) return res.status(500).json({ error: addErr.message });

      const { error: decErr1 } = await supabase
        .from("case_chance")
        .update({ quantity: Number(chance.quantity) - 1 })
        .eq("id", chance.id);
      if (decErr1) return res.status(500).json({ error: decErr1.message });

      const { error: updErr1 } = await supabase
        .from("case_spins")
        .update({ status: "reward_sent" })
        .eq("id", spin.id);
      if (updErr1) return res.status(500).json({ error: updErr1.message });

      return res.json({ status: "reward_sent" });
    }

    // 💰 Если для этого приза задана цена клейма (например, 25⭐) — списываем перед выдачей
    const claimPrice = Number(chance.claim_price || 0);
    if (claimPrice === 25) {
      const { data: claimUser, error: uErr } = await supabase
        .from("users")
        .select("id, stars")
        .eq("id", spin.user_id)
        .single();
      if (uErr || !claimUser) return res.status(404).json({ error: "user not found" });

      if (Number(claimUser.stars || 0) < claimPrice) {
        return res.status(402).json({ error: "Недостаточно звёзд для вывода (нужно 25⭐)" });
      }

      const { error: debErr } = await supabase
        .from("users")
        .update({ stars: Number(claimUser.stars) - claimPrice })
        .eq("id", claimUser.id);
      if (debErr) return res.status(500).json({ error: debErr.message });

      // опционально: аудит списаний
      try {
        await supabase.from("stars_ledger").insert([{
          user_id: claimUser.id,
          change: -claimPrice,
          reason: "claim_fee",
          spin_id: id
        }]);
      } catch { /* noop */ }
    }

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

    if (!gift.is_infinite) {
      const { error: markErr } = await supabase
        .from("gifts_for_cases")
        .update({ used: true })
        .eq("pending_id", gift.pending_id);
      if (markErr) return res.status(500).json({ error: markErr.message });
    }

    const { error: decErr } = await supabase
      .from("case_chance")
      .update({ quantity: Number(chance.quantity) - 1 })
      .eq("id", chance.id);
    if (decErr) return res.status(500).json({ error: decErr.message });

    const { data: winUser } = await supabase
      .from("users")
      .select("telegram_id, username")
      .eq("id", spin.user_id)
      .single();

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
      created_at: new Date().toISOString().slice(11, 19)
    }]);
    if (prErr) return res.status(500).json({ error: prErr.message });

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
