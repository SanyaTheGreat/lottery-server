import express from "express";
import crypto from "crypto";
import { supabase } from "../services/supabaseClient.js";

const router = express.Router();

/**
 * У тебя requireJwt() уже стоит на префиксе,
 * он должен положить decoded данные в req.user.
 *
 * Я делаю максимально совместимо:
 * - пробую взять telegram_id из req.user
 * - если нет — 401
 */
function getTelegramId(req) {
  const t = req?.user?.telegram_id ?? req?.user?.telegramId ?? req?.user?.tg_id;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function utcDateString(d = new Date()) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function computePeriodBoundsUTC(now = new Date()) {
  const startAt = new Date(now.toISOString()); // стартуем "сейчас"

  // 0=Sun..6=Sat
  const day = now.getUTCDay();
  const daysToSunday = (7 - day) % 7;

  const sunday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  sunday.setUTCDate(sunday.getUTCDate() + daysToSunday);

  // конец: воскресенье 21:00 UTC
  const endAt = new Date(Date.UTC(sunday.getUTCFullYear(), sunday.getUTCMonth(), sunday.getUTCDate(), 21, 0, 0, 0));

  // если уже после 21:00 в воскресенье — переносим на след. воскресенье
  if (now >= endAt) endAt.setUTCDate(endAt.getUTCDate() + 7);

  // freeze: 20:59 UTC
  const freezeAt = new Date(endAt.getTime() - 60_000);

  return { startAt, freezeAt, endAt };
}

/**
 * FIX: crypto.randomInt() имеет лимит по диапазону.
 * Генерим seed через randomBytes (64-bit), возвращаем строкой под bigint в БД.
 */
function randomSeedBigintString() {
  const buf = crypto.randomBytes(8); // 64-bit
  const n = buf.readBigUInt64BE(0);  // BigInt
  return n.toString();
}

/**
 * Достаём активный период. Если нет — создаём.
 * (у тебя уже стоит unique index на один active)
 */
async function getOrCreateActivePeriod(now) {
  const { data: active, error: e1 } = await supabase
    .from("weekly_periods")
    .select("*")
    .eq("status", "active")
    .order("start_at", { ascending: false })
    .limit(1);

  if (e1) throw new Error(`weekly_periods select failed: ${e1.message}`);
  if (active?.length) return active[0];

  const { startAt, freezeAt, endAt } = computePeriodBoundsUTC(now);

  // пробуем создать
  const { data: created, error: e2 } = await supabase
    .from("weekly_periods")
    .insert({
      start_at: startAt.toISOString(),
      freeze_at: freezeAt.toISOString(),
      end_at: endAt.toISOString(),
      status: "active",
    })
    .select("*")
    .single();

  // если конфликт из-за unique active — просто прочитаем активный ещё раз
  if (e2) {
    const { data: active2, error: e3 } = await supabase
      .from("weekly_periods")
      .select("*")
      .eq("status", "active")
      .order("start_at", { ascending: false })
      .limit(1);

    if (e3) throw new Error(`weekly_periods reselect failed: ${e3.message}`);
    if (active2?.length) return active2[0];

    throw new Error(`weekly_periods insert failed: ${e2.message}`);
  }

  return created;
}

/**
 * POST /game/run/start
 * Возвращает существующий active run или создаёт новый со списанием попытки.
 */
router.post("/run/start", async (req, res) => {
  const tgId = getTelegramId(req);
  if (!tgId) return res.status(401).json({ ok: false, error: "Unauthorized" });

  const now = new Date();

  try {
    console.log(`[2048/start] tg=${tgId} start`);

    // 1) Находим пользователя по telegram_id (UUID нам нужен для FK)
    const { data: user, error: uErr } = await supabase
      .from("users")
      .select(
        "id, telegram_id, daily_day_utc, daily_attempts_remaining, daily_plays_used, referral_attempts_balance"
      )
      .eq("telegram_id", tgId)
      .maybeSingle();

    if (uErr) {
      console.error("[2048/start] users select error:", uErr.message);
      return res.status(500).json({ ok: false, error: "DB error (users)" });
    }
    if (!user) {
      // теоретически не должен случаться, потому что /auth/telegram создаёт user
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    // 2) Daily reset (UTC)
    const today = utcDateString(now);

    let dailyDayUtc = user.daily_day_utc ? String(user.daily_day_utc) : null;
    let dailyAttempts = Number(user.daily_attempts_remaining ?? 0);
    let dailyPlaysUsed = Number(user.daily_plays_used ?? 0);
    let referralBalance = Number(user.referral_attempts_balance ?? 0);

    const needsReset = !dailyDayUtc || dailyDayUtc !== today;

    if (needsReset) {
      dailyDayUtc = today;
      dailyAttempts = 4; // 3 + 1 daily bonus
      dailyPlaysUsed = 0;

      const { error: rErr } = await supabase
        .from("users")
        .update({
          daily_day_utc: today,
          daily_attempts_remaining: dailyAttempts,
          daily_plays_used: dailyPlaysUsed,
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id);

      if (rErr) {
        console.error("[2048/start] daily reset update error:", rErr.message);
        return res.status(500).json({ ok: false, error: "DB error (daily reset)" });
      }
    }

    // 3) Дневной лимит 20 стартов
    if (dailyPlaysUsed >= 20) {
      return res.status(429).json({ ok: false, error: "Daily limit reached (20)" });
    }

    // 4) Берём активный период
    const period = await getOrCreateActivePeriod(now);

    const freezeAt = new Date(period.freeze_at);
    const endAt = new Date(period.end_at);

    // если период уже должен быть frozen/closed, но cron ещё не отработал — запрещаем старт
    if (now >= endAt) {
      return res.status(423).json({ ok: false, error: "Season rollover in progress. Try again." });
    }
    if (now >= freezeAt || period.status === "frozen") {
      return res.status(423).json({ ok: false, error: "Season is frozen. New runs disabled." });
    }

    // 5) Если уже есть active run — вернуть его (не списываем попытку второй раз)
    const { data: activeRuns, error: aErr } = await supabase
      .from("game_runs")
      .select("id, user_id, period_id, seed, actions, current_score, status, created_at, updated_at")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1);

    if (aErr) {
      console.error("[2048/start] game_runs select active error:", aErr.message);
      return res.status(500).json({ ok: false, error: "DB error (active run)" });
    }

    if (activeRuns?.length) {
      return res.json({
        ok: true,
        mode: "resume",
        period,
        run: activeRuns[0],
        attempts: {
          daily_day_utc: dailyDayUtc,
          daily_attempts_remaining: dailyAttempts,
          referral_attempts_balance: referralBalance,
          daily_plays_used: dailyPlaysUsed,
        },
      });
    }

    // 6) Списываем попытку (daily -> referral)
    let usedFrom = null;

    if (dailyAttempts > 0) {
      dailyAttempts -= 1;
      usedFrom = "daily";
    } else if (referralBalance > 0) {
      referralBalance -= 1;
      usedFrom = "referral";
    } else {
      return res.status(402).json({ ok: false, error: "No attempts available" });
    }

    dailyPlaysUsed += 1;

    // update attempts (вручную updated_at)
    const { error: updErr } = await supabase
      .from("users")
      .update({
        daily_attempts_remaining: dailyAttempts,
        daily_plays_used: dailyPlaysUsed,
        referral_attempts_balance: referralBalance,
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id);

    if (updErr) {
      console.error("[2048/start] attempts update error:", updErr.message);
      return res.status(500).json({ ok: false, error: "DB error (attempts)" });
    }

    // 7) Создаём run
    const seed = randomSeedBigintString();

    const { data: createdRun, error: insErr } = await supabase
      .from("game_runs")
      .insert({
        user_id: user.id,
        period_id: period.id,
        seed, // bigint строкой
        status: "active",
        updated_at: new Date().toISOString(),
      })
      .select("id, user_id, period_id, seed, actions, current_score, status, created_at, updated_at")
      .single();

    if (insErr) {
      console.error("[2048/start] run insert error:", insErr.message);

      // возможный race — пробуем вернуть активный
      const { data: fallback } = await supabase
        .from("game_runs")
        .select("id, user_id, period_id, seed, actions, current_score, status, created_at, updated_at")
        .eq("user_id", user.id)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1);

      if (fallback?.length) {
        return res.json({
          ok: true,
          mode: "resume",
          period,
          run: fallback[0],
          attempts: {
            daily_day_utc: dailyDayUtc,
            daily_attempts_remaining: dailyAttempts,
            referral_attempts_balance: referralBalance,
            daily_plays_used: dailyPlaysUsed,
          },
        });
      }

      return res.status(500).json({ ok: false, error: "Failed to create run" });
    }

    console.log(`[2048/start] tg=${tgId} created run=${createdRun.id} usedFrom=${usedFrom}`);

    return res.status(201).json({
      ok: true,
      mode: "new",
      used_from: usedFrom,
      period,
      run: createdRun,
      attempts: {
        daily_day_utc: dailyDayUtc,
        daily_attempts_remaining: dailyAttempts,
        referral_attempts_balance: referralBalance,
        daily_plays_used: dailyPlaysUsed,
      },
    });
  } catch (e) {
    console.error("[2048/start] unexpected:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

export default router;
