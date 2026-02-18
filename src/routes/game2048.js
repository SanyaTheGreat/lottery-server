import express from "express";
import crypto from "crypto";
import { supabase } from "../services/supabaseClient.js";

const router = express.Router();

/**
 * requireJwt() уже на префиксе и кладёт decoded в req.user
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
  const startAt = new Date(now.toISOString());

  const day = now.getUTCDay();
  const daysToSunday = (7 - day) % 7;

  const sunday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  sunday.setUTCDate(sunday.getUTCDate() + daysToSunday);

  const endAt = new Date(Date.UTC(sunday.getUTCFullYear(), sunday.getUTCMonth(), sunday.getUTCDate(), 21, 0, 0, 0));
  if (now >= endAt) endAt.setUTCDate(endAt.getUTCDate() + 7);

  const freezeAt = new Date(endAt.getTime() - 60_000);
  return { startAt, freezeAt, endAt };
}

/**
 * FIX: crypto.randomInt() имеет лимит по диапазону.
 * Генерим seed через randomBytes (64-bit), возвращаем строкой под bigint в БД.
 */
function randomSeedBigintString() {
  const buf = crypto.randomBytes(8);
  const n = buf.readBigUInt64BE(0);
  return n.toString();
}

/**
 * --- 2048 helpers (детерминированный RNG + логика движения) ---
 */
const GRID_SIZE = 4;
const ACTIONS_LIMIT = 200;

const FINISH_REASONS = new Set(["no_moves", "manual", "period_end"]);
const LEADERBOARD_TABLE = "game2048_leaderboard"; // <-- если у тебя другое имя таблицы — поменяй тут

// splitmix64 — хорош для детерминированных псевдослучайных чисел от seed+idx
function splitmix64(x) {
  let z = (x + 0x9e3779b97f4a7c15n) & 0xffffffffffffffffn;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & 0xffffffffffffffffn;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & 0xffffffffffffffffn;
  return (z ^ (z >> 31n)) & 0xffffffffffffffffn;
}

// [0,1) из 64-bit (берём 53 бита как в JS double)
function rand01From64(u64) {
  const v = Number((u64 >> 11n) & ((1n << 53n) - 1n)); // 53 bits
  return v / 9007199254740992; // 2^53
}

function makeRng(seedStr, startIndex = 0) {
  const seed = BigInt(seedStr || "0");
  let idx = BigInt(startIndex || 0);

  return {
    next01() {
      const u = splitmix64((seed + idx) & 0xffffffffffffffffn);
      idx += 1n;
      return rand01From64(u);
    },
    getIndex() {
      return Number(idx);
    },
  };
}

function emptyGrid() {
  return Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(0));
}

function cloneGrid(g) {
  return g.map((row) => row.slice());
}

function gridsEqual(a, b) {
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (a[r][c] !== b[r][c]) return false;
    }
  }
  return true;
}

function getEmptyCells(grid) {
  const cells = [];
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (!grid[r][c]) cells.push([r, c]);
    }
  }
  return cells;
}

function spawnTile(grid, rng) {
  const empties = getEmptyCells(grid);
  if (empties.length === 0) return false;

  const pick = Math.floor(rng.next01() * empties.length);
  const [r, c] = empties[pick];

  const v = rng.next01() < 0.9 ? 2 : 4;
  grid[r][c] = v;
  return true;
}

function slideAndMergeLine(line) {
  const filtered = line.filter((x) => x !== 0);
  const out = [];
  let score = 0;

  for (let i = 0; i < filtered.length; i++) {
    if (i + 1 < filtered.length && filtered[i] === filtered[i + 1]) {
      const merged = filtered[i] * 2;
      out.push(merged);
      score += merged;
      i += 1;
    } else {
      out.push(filtered[i]);
    }
  }

  while (out.length < GRID_SIZE) out.push(0);
  return { line: out, score };
}

function applyMove(grid, dir) {
  const g = cloneGrid(grid);
  let gained = 0;

  const readLine = (i) => {
    if (dir === "left") return [g[i][0], g[i][1], g[i][2], g[i][3]];
    if (dir === "right") return [g[i][3], g[i][2], g[i][1], g[i][0]];
    if (dir === "up") return [g[0][i], g[1][i], g[2][i], g[3][i]];
    if (dir === "down") return [g[3][i], g[2][i], g[1][i], g[0][i]];
    return null;
  };

  const writeLine = (i, line) => {
    if (dir === "left") {
      g[i][0] = line[0];
      g[i][1] = line[1];
      g[i][2] = line[2];
      g[i][3] = line[3];
      return;
    }
    if (dir === "right") {
      g[i][3] = line[0];
      g[i][2] = line[1];
      g[i][1] = line[2];
      g[i][0] = line[3];
      return;
    }
    if (dir === "up") {
      g[0][i] = line[0];
      g[1][i] = line[1];
      g[2][i] = line[2];
      g[3][i] = line[3];
      return;
    }
    if (dir === "down") {
      g[3][i] = line[0];
      g[2][i] = line[1];
      g[1][i] = line[2];
      g[0][i] = line[3];
      return;
    }
  };

  for (let i = 0; i < GRID_SIZE; i++) {
    const line = readLine(i);
    const { line: merged, score } = slideAndMergeLine(line);
    gained += score;
    writeLine(i, merged);
  }

  return { grid: g, gained, moved: !gridsEqual(grid, g) };
}

function canMove(grid) {
  if (getEmptyCells(grid).length > 0) return true;

  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      const v = grid[r][c];
      if (r + 1 < GRID_SIZE && grid[r + 1][c] === v) return true;
      if (c + 1 < GRID_SIZE && grid[r][c + 1] === v) return true;
    }
  }
  return false;
}

function normalizeState(state) {
  const grid = state?.grid;
  if (!Array.isArray(grid) || grid.length !== GRID_SIZE) return null;
  for (const row of grid) {
    if (!Array.isArray(row) || row.length !== GRID_SIZE) return null;
    for (const v of row) {
      if (typeof v !== "number") return null;
    }
  }
  return { grid };
}

function initStateForNewRun(seedStr) {
  const grid = emptyGrid();
  const rng = makeRng(seedStr, 0);
  spawnTile(grid, rng);
  spawnTile(grid, rng);
  return {
    state: { grid },
    rng_index: rng.getIndex(),
  };
}

/**
 * Достаём активный период. Если нет — создаём.
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
 * Финишит ран и пушит best_score в лидерборд (по period_id+user_id), если score лучше.
 * reason: "no_moves" | "manual" | "period_end"
 */
async function finalizeRun({ run, reason }) {
  const nowIso = new Date().toISOString();
  const finalScore = Number(run.current_score ?? 0);
  const finalMoves = Number(run.moves ?? 0);

  // 1) завершить run (idempotent: если уже finished — просто вернуть как есть)
  if (run.status !== "finished") {
    const { data: finished, error: finErr } = await supabase
      .from("game_runs")
      .update({
        status: "finished",
        finished_reason: reason,
        finished_at: nowIso,
        // на всякий: фиксируем финал (если в таблице есть такие колонки — ок, если нет — supabase вернёт ошибку)
        final_score: finalScore,
        final_moves: finalMoves,
        updated_at: nowIso,
      })
      .eq("id", run.id)
      .select(
        "id, user_id, period_id, seed, actions, state, rng_index, moves, current_score, status, finished_reason, finished_at, created_at, updated_at"
      )
      .single();

    if (finErr) {
      // Если у тебя ещё нет колонок finished_reason/finished_at/final_score/final_moves — будет ошибка.
      // Тогда просто закрываем минимумом.
      const msg = String(finErr.message || "");
      console.error("[2048/finalize] finish update error:", msg);

      const { data: finished2, error: finErr2 } = await supabase
        .from("game_runs")
        .update({
          status: "finished",
          updated_at: nowIso,
        })
        .eq("id", run.id)
        .select(
          "id, user_id, period_id, seed, actions, state, rng_index, moves, current_score, status, created_at, updated_at"
        )
        .single();

      if (finErr2) throw new Error(`finalize minimal update failed: ${finErr2.message}`);
      run = finished2;
    } else {
      run = finished;
    }
  }

  // 2) лидерборд: best_score per user per period
  // Если таблицы ещё нет или имя другое — увидишь ошибку в логах.
  let bestScore = finalScore;

  const { data: existingLb, error: lbSelErr } = await supabase
    .from(LEADERBOARD_TABLE)
    .select("id, best_score")
    .eq("period_id", run.period_id)
    .eq("user_id", run.user_id)
    .maybeSingle();

  if (lbSelErr) {
    console.error("[2048/finalize] leaderboard select error:", lbSelErr.message);
    // не ломаем финиш игры из-за лидерборда
    return { run, leaderboard: null };
  }

  const currentBest = Number(existingLb?.best_score ?? 0);
  if (currentBest > bestScore) bestScore = currentBest;

  if (!existingLb) {
    const { data: lbIns, error: lbInsErr } = await supabase
      .from(LEADERBOARD_TABLE)
      .insert({
        period_id: run.period_id,
        user_id: run.user_id,
        best_score: bestScore,
        created_at: nowIso,
        updated_at: nowIso,
      })
      .select("id, period_id, user_id, best_score, created_at, updated_at")
      .single();

    if (lbInsErr) {
      console.error("[2048/finalize] leaderboard insert error:", lbInsErr.message);
      return { run, leaderboard: null };
    }

    return { run, leaderboard: lbIns };
  }

  if (finalScore > currentBest) {
    const { data: lbUpd, error: lbUpdErr } = await supabase
      .from(LEADERBOARD_TABLE)
      .update({
        best_score: finalScore,
        updated_at: nowIso,
      })
      .eq("id", existingLb.id)
      .select("id, period_id, user_id, best_score, created_at, updated_at")
      .single();

    if (lbUpdErr) {
      console.error("[2048/finalize] leaderboard update error:", lbUpdErr.message);
      return { run, leaderboard: null };
    }

    return { run, leaderboard: lbUpd };
  }

  // score не улучшил best
  const { data: lbSame } = await supabase
    .from(LEADERBOARD_TABLE)
    .select("id, period_id, user_id, best_score, created_at, updated_at")
    .eq("id", existingLb.id)
    .maybeSingle();

  return { run, leaderboard: lbSame ?? null };
}

/**
 * POST /game/run/start
 */
router.post("/run/start", async (req, res) => {
  const tgId = getTelegramId(req);
  if (!tgId) return res.status(401).json({ ok: false, error: "Unauthorized" });

  const now = new Date();

  try {
    console.log(`[2048/start] tg=${tgId} start`);

    const { data: user, error: uErr } = await supabase
      .from("users")
      .select("id, telegram_id, daily_day_utc, daily_attempts_remaining, daily_plays_used, referral_attempts_balance")
      .eq("telegram_id", tgId)
      .maybeSingle();

    if (uErr) {
      console.error("[2048/start] users select error:", uErr.message);
      return res.status(500).json({ ok: false, error: "DB error (users)" });
    }
    if (!user) return res.status(404).json({ ok: false, error: "User not found" });

    const today = utcDateString(now);

    let dailyDayUtc = user.daily_day_utc ? String(user.daily_day_utc) : null;
    let dailyAttempts = Number(user.daily_attempts_remaining ?? 0);
    let dailyPlaysUsed = Number(user.daily_plays_used ?? 0);
    let referralBalance = Number(user.referral_attempts_balance ?? 0);

    const needsReset = !dailyDayUtc || dailyDayUtc !== today;

    if (needsReset) {
      dailyDayUtc = today;
      dailyAttempts = 4;
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

    if (dailyPlaysUsed >= 20) {
      return res.status(429).json({ ok: false, error: "Daily limit reached (20)" });
    }

    const period = await getOrCreateActivePeriod(now);

    const freezeAt = new Date(period.freeze_at);
    const endAt = new Date(period.end_at);

    if (now >= endAt) return res.status(423).json({ ok: false, error: "Season rollover in progress. Try again." });
    if (now >= freezeAt || period.status === "frozen") {
      return res.status(423).json({ ok: false, error: "Season is frozen. New runs disabled." });
    }

    const { data: activeRuns, error: aErr } = await supabase
      .from("game_runs")
      .select(
        "id, user_id, period_id, seed, actions, state, rng_index, moves, current_score, status, finished_reason, finished_at, created_at, updated_at"
      )
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

    const seed = randomSeedBigintString();
    const init = initStateForNewRun(seed);

    const { data: createdRun, error: insErr } = await supabase
      .from("game_runs")
      .insert({
        user_id: user.id,
        period_id: period.id,
        seed,
        status: "active",
        state: init.state,
        rng_index: init.rng_index,
        moves: 0,
        current_score: 0,
        updated_at: new Date().toISOString(),
      })
      .select(
        "id, user_id, period_id, seed, actions, state, rng_index, moves, current_score, status, finished_reason, finished_at, created_at, updated_at"
      )
      .single();

    if (insErr) {
      console.error("[2048/start] run insert error:", insErr.message);

      const { data: fallback } = await supabase
        .from("game_runs")
        .select(
          "id, user_id, period_id, seed, actions, state, rng_index, moves, current_score, status, finished_reason, finished_at, created_at, updated_at"
        )
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

/**
 * POST /game/run/finish
 * Body: { reason?: "manual" }
 * Завершить игру вручную и записать результат в лидерборд (если лучше).
 */
router.post("/run/finish", async (req, res) => {
  const tgId = getTelegramId(req);
  if (!tgId) return res.status(401).json({ ok: false, error: "Unauthorized" });

  const reasonRaw = req?.body?.reason;
  const reason = typeof reasonRaw === "string" ? reasonRaw : "manual";
  const finalReason = FINISH_REASONS.has(reason) ? reason : "manual";

  try {
    console.log(`[2048/finish] tg=${tgId} reason=${finalReason}`);

    const { data: user, error: uErr } = await supabase
      .from("users")
      .select("id, telegram_id")
      .eq("telegram_id", tgId)
      .maybeSingle();

    if (uErr) {
      console.error("[2048/finish] users select error:", uErr.message);
      return res.status(500).json({ ok: false, error: "DB error (users)" });
    }
    if (!user) return res.status(404).json({ ok: false, error: "User not found" });

    const { data: activeRuns, error: aErr } = await supabase
      .from("game_runs")
      .select(
        "id, user_id, period_id, seed, actions, state, rng_index, moves, current_score, status, finished_reason, finished_at, created_at, updated_at"
      )
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1);

    if (aErr) {
      console.error("[2048/finish] game_runs select active error:", aErr.message);
      return res.status(500).json({ ok: false, error: "DB error (active run)" });
    }
    if (!activeRuns?.length) {
      return res.status(409).json({ ok: false, error: "No active run." });
    }

    const run = activeRuns[0];
    const out = await finalizeRun({ run, reason: finalReason });

    return res.json({
      ok: true,
      finished: true,
      reason: finalReason,
      run: out.run,
      leaderboard: out.leaderboard,
    });
  } catch (e) {
    console.error("[2048/finish] unexpected:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

/**
 * POST /game/run/move
 * Body: { dir: "up" | "down" | "left" | "right" }
 * Реальная 2048-логика: двигаем/сливаем, спавним тайл, сохраняем state/score/moves/rng_index.
 * Если больше нет ходов — game over -> status=finished + запись в лидерборд.
 */
router.post("/run/move", async (req, res) => {
  const tgId = getTelegramId(req);
  if (!tgId) return res.status(401).json({ ok: false, error: "Unauthorized" });

  const dirRaw = req?.body?.dir;
  const dir = typeof dirRaw === "string" ? dirRaw.toLowerCase() : "";
  const allowed = new Set(["up", "down", "left", "right"]);

  if (!allowed.has(dir)) {
    return res.status(400).json({ ok: false, error: "Invalid dir. Use up/down/left/right" });
  }

  try {
    console.log(`[2048/move] tg=${tgId} dir=${dir}`);

    const { data: user, error: uErr } = await supabase
      .from("users")
      .select("id, telegram_id, daily_day_utc, daily_attempts_remaining, daily_plays_used, referral_attempts_balance")
      .eq("telegram_id", tgId)
      .maybeSingle();

    if (uErr) {
      console.error("[2048/move] users select error:", uErr.message);
      return res.status(500).json({ ok: false, error: "DB error (users)" });
    }
    if (!user) return res.status(404).json({ ok: false, error: "User not found" });

    const { data: activeRuns, error: aErr } = await supabase
      .from("game_runs")
      .select(
        "id, user_id, period_id, seed, actions, state, rng_index, moves, current_score, status, finished_reason, finished_at, created_at, updated_at"
      )
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1);

    if (aErr) {
      console.error("[2048/move] game_runs select active error:", aErr.message);
      return res.status(500).json({ ok: false, error: "DB error (active run)" });
    }

    if (!activeRuns?.length) {
      return res.status(409).json({ ok: false, error: "No active run. Call /game/run/start first." });
    }

    const run = activeRuns[0];

    // защита: если период уже закончился/заморожен — завершаем ран (period_end)
    try {
      const { data: period, error: pErr } = await supabase
        .from("weekly_periods")
        .select("id, status, freeze_at, end_at")
        .eq("id", run.period_id)
        .maybeSingle();

      if (!pErr && period) {
        const now = new Date();
        const freezeAt = period.freeze_at ? new Date(period.freeze_at) : null;
        const endAt = period.end_at ? new Date(period.end_at) : null;

        const shouldForceFinish =
          (endAt && now >= endAt) || (freezeAt && now >= freezeAt) || period.status === "frozen" || period.status === "closed";

        if (shouldForceFinish) {
          const out = await finalizeRun({ run, reason: "period_end" });
          return res.status(423).json({
            ok: true,
            finished: true,
            reason: "period_end",
            run: out.run,
            leaderboard: out.leaderboard,
            error: "Season is frozen/ended. Run finished.",
          });
        }
      }
    } catch (e) {
      // если тут что-то пошло не так — не ломаем ход, просто лог
      console.error("[2048/move] period check error:", e?.message || e);
    }

    let st = normalizeState(run.state);
    let rngIndex = Number(run.rng_index ?? 0);
    const moves = Number(run.moves ?? 0);
    const score = Number(run.current_score ?? 0);

    if (!st) {
      const init = initStateForNewRun(run.seed);
      st = init.state;
      rngIndex = init.rng_index;
    }

    const beforeGrid = st.grid;
    const { grid: movedGrid, gained, moved } = applyMove(beforeGrid, dir);

    if (!moved) {
      return res.json({
        ok: true,
        moved: false,
        gained: 0,
        run: {
          ...run,
          state: st,
          rng_index: rngIndex,
          moves,
          current_score: score,
        },
      });
    }

    const rng = makeRng(run.seed, rngIndex);
    const afterGrid = cloneGrid(movedGrid);

    // после успешного хода всегда спавним новый тайл
    spawnTile(afterGrid, rng);

    const nextScore = score + gained;
    const nextMoves = moves + 1;
    const nextRngIndex = rng.getIndex();

    const prevActions = Array.isArray(run.actions) ? run.actions : [];
    let nextActions = [...prevActions, { t: new Date().toISOString(), dir, gained }];
    if (nextActions.length > ACTIONS_LIMIT) nextActions = nextActions.slice(-ACTIONS_LIMIT);

    const nextState = { grid: afterGrid };

    const stillCanMove = canMove(afterGrid);
    const nextStatus = stillCanMove ? "active" : "finished";

    const { data: updatedRun, error: upErr } = await supabase
      .from("game_runs")
      .update({
        state: nextState,
        rng_index: nextRngIndex,
        moves: nextMoves,
        current_score: nextScore,
        actions: nextActions,
        status: nextStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", run.id)
      .select(
        "id, user_id, period_id, seed, actions, state, rng_index, moves, current_score, status, finished_reason, finished_at, created_at, updated_at"
      )
      .single();

    if (upErr) {
      console.error("[2048/move] game_runs update error:", upErr.message);
      return res.status(500).json({ ok: false, error: "DB error (update run)" });
    }

    // если это game over — финишим и пишем лидерборд
    if (updatedRun.status === "finished") {
      const out = await finalizeRun({ run: updatedRun, reason: "no_moves" });

      return res.json({
        ok: true,
        moved: true,
        gained,
        finished: true,
        reason: "no_moves",
        run: out.run,
        leaderboard: out.leaderboard,
        attempts: {
          daily_day_utc: user.daily_day_utc,
          daily_attempts_remaining: user.daily_attempts_remaining,
          referral_attempts_balance: user.referral_attempts_balance,
          daily_plays_used: user.daily_plays_used,
        },
      });
    }

    return res.json({
      ok: true,
      moved: true,
      gained,
      run: updatedRun,
      attempts: {
        daily_day_utc: user.daily_day_utc,
        daily_attempts_remaining: user.daily_attempts_remaining,
        referral_attempts_balance: user.referral_attempts_balance,
        daily_plays_used: user.daily_plays_used,
      },
    });
  } catch (e) {
    console.error("[2048/move] unexpected:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

export default router;
