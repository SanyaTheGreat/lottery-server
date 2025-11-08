import { supabase } from "../../services/supabaseClient.js";
import { v4 as uuidv4 } from "uuid";

/* =======================
   Anti-spam HOTFIX (drop-in) + Dedupe
   ======================= */
const inMemoryBuckets = new Map(); // userId -> {ts:number[]}
const RUNNING = new Set();         // per-user mutex
const recentActions = new Map();   // key -> expiry timestamp

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function acquireUserLock(userId) {
  while (RUNNING.has(userId)) await sleep(15);
  RUNNING.add(userId);
}
function releaseUserLock(userId) { RUNNING.delete(userId); }

function passLocalRate(userId, windowMs, limit) {
  const now = Date.now();
  const b = inMemoryBuckets.get(userId) || { ts: [] };
  b.ts = b.ts.filter(t => now - t < windowMs);
  if (b.ts.length >= limit) return false;
  b.ts.push(now);
  inMemoryBuckets.set(userId, b);
  return true;
}

// простая защита от двойного клика / повторной отправки
const DEDUPE_WINDOW = 3000; // 3 секунды
function dedupeOnce(key) {
  const now = Date.now();
  const exp = recentActions.get(key);
  if (exp && exp > now) return false;
  recentActions.set(key, now + DEDUPE_WINDOW);
  setTimeout(() => recentActions.delete(key), DEDUPE_WINDOW + 1000);
  return true;
}

// Настройки лимитов (можно подкрутить без перезаливки логики)
const SEC_LIMIT  = 2;   // не больше 2 спинов в секунду
const MIN_LIMIT  = 50;  // и не больше 50 спинов в минуту

/**
 * POST /api/case/spin    🔐 JWT
 * body: { case_id: uuid, pay_with: 'tickets'|'stars'|'free', idempotency_key?: uuid }
 * telegram_id берём из req.user (миддлвара requireJwt)
 */
export const spinCase = async (req, res) => {
  try {
    const telegram_id = req.user?.telegram_id;           // ← из JWT
    if (!telegram_id) return res.status(401).json({ error: "Unauthorized" });

    // 🔐 анти-дубль на пользователя
    if (!dedupeOnce(`spin:${telegram_id}`)) {
      return res.status(409).json({ error: "Операция уже выполняется" });
    }

    const { case_id, pay_with = "tickets", idempotency_key } = req.body || {};
    if (!case_id) return res.status(400).json({ error: "case_id обязателен" });
    if (!["tickets", "stars", "free"].includes(pay_with)) {
      return res.status(400).json({ error: "pay_with должен быть 'tickets' | 'stars' | 'free'" });
    }

    // ❗ Идемпотентность по ключу (если пришёл)
    if (idempotency_key) {
      const { data: existing } = await supabase
        .from("case_spins")
        .select("id, status")
        .eq("idempotency_key", idempotency_key)
        .maybeSingle();
      if (existing) {
        return res.json({ spin_id: existing.id, status: existing.status });
      }
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

    // пользователь (+ referred_by для рефералок, + free_spin_last_at)
    const { data: user, error: userErr } = await supabase
      .from("users")
      .select("id, telegram_id, tickets, stars, referred_by, free_spin_last_at")
      .eq("telegram_id", telegram_id)
      .single();
    if (userErr || !user) return res.status(404).json({ error: "Пользователь не найден" });

    /* ---------- Antispam: лок + rate limits (не ломает текущую архитектуру) ---------- */
    await acquireUserLock(user.id);
    try {
      // Локальные лимиты (в памяти) — мгновенная отсечка
      if (!passLocalRate(user.id, 1000, SEC_LIMIT))
        return res.status(429).json({ error: "Too many spins per second" });

      if (!passLocalRate(user.id, 60_000, MIN_LIMIT))
        return res.status(429).json({ error: "Too many spins per minute" });

      // Страховка: проверка по БД (если несколько инстансов сервера)
      const iso1s = new Date(Date.now() - 1000).toISOString();
      const { data: recent1s } = await supabase
        .from("case_spins")
        .select("id")
        .eq("user_id", user.id)
        .gt("created_at", iso1s)
        .limit(SEC_LIMIT + 1);
      if ((recent1s?.length || 0) >= SEC_LIMIT)
        return res.status(429).json({ error: "Too many spins per second (db)" });

      const iso1m = new Date(Date.now() - 60_000).toISOString();
      const { data: recent1m } = await supabase
        .from("case_spins")
        .select("id")
        .eq("user_id", user.id)
        .gt("created_at", iso1m)
        .limit(MIN_LIMIT + 1);
      if ((recent1m?.length || 0) >= MIN_LIMIT)
        return res.status(429).json({ error: "Too many spins per minute (db)" });
    } finally {
      releaseUserLock(user.id);
    }
    /* ------------------------------------------------------------------------------- */

    // Бесплатный спин — только для самого дешёвого активного кейса
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
    let pay_with_ton = null;     // резерв
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
      const { error: updErr } = await supabase
        .from("users")
        .update({ stars: Number(user.stars || 0) - priceStars })
        .eq("id", user.id);
      if (updErr) return res.status(500).json({ error: updErr.message });
      pay_with_tickets = priceTon;

    } else if (pay_with === "free") {
      // Бесплатный спин: первое пополнение + кулдаун 24ч
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
      // списаний нет
    }

    // Реферальные отчисления 5% от цены кейса (TON)
    try {
      const referrerId = user.referred_by || null;
      const refAmountTon = Number(caseRow.price || 0) * 0.05;
      if (referrerId && refAmountTon > 0) {
        await supabase.from("referral_earnings").insert([{
          referrer_id: referrerId,
          referred_id: user.id,
          wheel_id: null,
          amount: refAmountTon
        }]);
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

    // активные шансы
    const { data: chances, error: chErr } = await supabase
      .from("case_chance")
      .select("id, nft_name, weight, percent, price, payout_value, quantity, is_active")
      .eq("case_id", case_id)
      .eq("is_active", true)
      .gt("quantity", 0);
    if (chErr) return res.status(500).json({ error: chErr.message });

    // если ничего нет — фиксируем проигрыш
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
          pay_with,
          reroll_amount: null,
          idempotency_key: idem
        }])
        .select("id")
        .single();
      if (spinLoseErr) return res.status(500).json({ error: spinLoseErr.message });

      if (pay_with === "free") {
        await supabase
          .from("users")
          .update({ free_spin_last_at: new Date().toISOString(), free_spin_last_notified_at: null })
          .eq("id", user.id);
      }
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

    // выпал lose → проигрыш
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
          pay_with,
          reroll_amount: null,
          idempotency_key: idem
        }]);
      if (spinLoseErr) return res.status(500).json({ error: spinLoseErr.message });

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
        pay_with,
        reroll_amount: null,
        idempotency_key: idem
      }])
      .select("id")
      .single();
    if (spinWinErr) return res.status(500).json({ error: spinWinErr.message });

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
 * POST /api/case/spin/:id/reroll   🔐 JWT
 * Продаём приз → начисляем в валюте исходной оплаты спина
 */
export const rerollPrize = async (req, res) => {
  try {
    const telegram_id = req.user?.telegram_id;
    if (!telegram_id) return res.status(401).json({ error: "Unauthorized" });

    // 🔐 анти-дубль
    if (!dedupeOnce(`reroll:${telegram_id}`)) {
      return res.status(409).json({ error: "Операция уже выполняется" });
    }

    // 🔒 лок на пользователя
    await acquireUserLock(telegram_id);
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

      // авторизованный пользователь должен совпадать с владельцем спина
      const { data: owner } = await supabase
        .from("users")
        .select("telegram_id")
        .eq("id", spin.user_id)
        .single();
      if (!owner || String(owner.telegram_id) !== String(telegram_id)) {
        return res.status(403).json({ error: "Forbidden" });
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
    } finally {
      releaseUserLock(telegram_id);
    }
  } catch {
    return res.status(500).json({ error: "rerollPrize failed" });
  }
};

/**
 * POST /api/case/spin/:id/claim   🔐 JWT
 * Добавлено: списание claim_price=25⭐ для не-«звёздных» призов.
 */
export const claimPrize = async (req, res) => {
  try {
    const telegram_id = req.user?.telegram_id;
    if (!telegram_id) return res.status(401).json({ error: "Unauthorized" });

    // 🔐 анти-дубль
    if (!dedupeOnce(`claim:${telegram_id}`)) {
      return res.status(409).json({ error: "Операция уже выполняется" });
    }

    // 🔒 лок на пользователя
    await acquireUserLock(telegram_id);
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

      // авторизованный пользователь должен совпадать с владельцем спина
      const { data: owner } = await supabase
        .from("users")
        .select("telegram_id")
        .eq("id", spin.user_id)
        .single();
      if (!owner || String(owner.telegram_id) !== String(telegram_id)) {
        return res.status(403).json({ error: "Forbidden" });
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

      // ⭐ Призы-звёзды — без оплаты claim_price
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

      // 💰 Если задана цена клейма (например, 25⭐) — списываем перед выдачей
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

        try {
          await supabase.from("stars_ledger").insert([{
            user_id: claimUser.id,
            change: -claimPrice,
            reason: "claim_fee",
            spin_id: id
          }]);
        } catch { /* audit best-effort */ }
      }

      // берём подготовленный подарочный код/ссылку
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
    } finally {
      releaseUserLock(telegram_id);
    }
  } catch {
    return res.status(500).json({ error: "claimPrize failed" });
  }
};
