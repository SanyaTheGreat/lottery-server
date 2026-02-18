// scheduler/game2048Finalizer.js
import { supabase } from "../services/supabaseClient.js";

/**
 * 2048 Finalizer
 * - Запускается вместе с сервером (просто импортом файла).
 * - Периодически проверяет weekly_periods.
 * - Если период уже закончился (now >= end_at) — завершает все активные game_runs этого периода.
 *
 * ВАЖНО:
 * - Идемпотентно: повторный запуск ничего не ломает (апдейт только status='active' -> 'finished').
 * - Не трогает weekly_periods.status (это может делать другой крон/логика).
 */

const ENABLED = (process.env.GAME2048_FINALIZER_ENABLED ?? "true") === "true";
const INTERVAL_MS = Number(process.env.GAME2048_FINALIZER_INTERVAL_MS ?? 60_000);

let running = false;

function nowIso() {
  return new Date().toISOString();
}

async function tick() {
  if (!ENABLED) return;
  if (running) return;

  running = true;
  const startedAt = Date.now();

  try {
    const now = new Date();
    const nowStr = now.toISOString();

    // 1) Находим периоды, которые уже закончились
    // Берём несколько последних, чтобы не сканить всю таблицу.
    const { data: periods, error: pErr } = await supabase
      .from("weekly_periods")
      .select("id, status, end_at, freeze_at, start_at")
      .lte("end_at", nowStr)
      .order("end_at", { ascending: false })
      .limit(25);

    if (pErr) {
      console.error("[2048/finalizer] weekly_periods select error:", pErr.message);
      return;
    }

    if (!periods?.length) {
      // ничего не закончилось
      return;
    }

    let totalFinished = 0;
    const finishedByPeriod = [];

    // 2) Для каждого законченного периода завершаем все активные рансы
    for (const p of periods) {
      const periodId = p.id;
      if (!periodId) continue;

      // Сначала быстро проверим, есть ли вообще активные рансы (чтобы меньше писать)
      const { count: activeCount, error: cErr } = await supabase
        .from("game_runs")
        .select("id", { count: "exact", head: true })
        .eq("period_id", periodId)
        .eq("status", "active");

      if (cErr) {
        console.error(`[2048/finalizer] game_runs count error period=${periodId}:`, cErr.message);
        continue;
      }

      if (!activeCount || activeCount <= 0) continue;

      const { data: updated, error: uErr } = await supabase
        .from("game_runs")
        .update({
          status: "finished",
          updated_at: nowIso(),
        })
        .eq("period_id", periodId)
        .eq("status", "active")
        .select("id");

      if (uErr) {
        console.error(`[2048/finalizer] game_runs update error period=${periodId}:`, uErr.message);
        continue;
      }

      const finished = Array.isArray(updated) ? updated.length : 0;
      totalFinished += finished;
      finishedByPeriod.push({ periodId, finished });
    }

    if (totalFinished > 0) {
      console.log(
        `[2048/finalizer] finished=${totalFinished} period(s)=${finishedByPeriod
          .map((x) => `${x.periodId}:${x.finished}`)
          .join(", ")} in ${Date.now() - startedAt}ms`
      );
    }
  } catch (e) {
    console.error("[2048/finalizer] unexpected:", e);
  } finally {
    running = false;
  }
}

if (ENABLED) {
  console.log(`[2048/finalizer] enabled interval=${INTERVAL_MS}ms`);
  // стартуем сразу (через 2 секунды, чтобы сервер поднялся)
  setTimeout(() => tick(), 2000);
  setInterval(() => tick(), INTERVAL_MS);
} else {
  console.log("[2048/finalizer] disabled by env GAME2048_FINALIZER_ENABLED=false");
}
