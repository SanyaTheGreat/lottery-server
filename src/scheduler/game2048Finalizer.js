// scheduler/game2048Finalizer.js
import { supabase } from "../services/supabaseClient.js";

/**
 * 2048 Finalizer / Weekly Rollover
 *
 * Что делает:
 * - Периодически вызывает RPC: ffg_rollover_weekly_periods()
 *
 * В БД эта функция:
 * 1) Находит weekly_periods где end_at <= now() и status != 'finished'
 * 2) Вызывает ffg_finalize_weekly_period(period_id):
 *    - завершает активные game_runs
 *    - обновляет weekly_scores
 *    - записывает weekly_winners TOP 10
 *    - ставит period.status = 'finished'
 * 3) Если нет активного периода — создаёт новый weekly_period со status='active'
 *
 * Node здесь только триггер.
 * Вся бизнес-логика находится в Postgres.
 */

const ENABLED =
  (process.env.GAME2048_FINALIZER_ENABLED ?? "true") === "true";

const INTERVAL_MS = Number(
  process.env.GAME2048_FINALIZER_INTERVAL_MS ?? 60_000
);

let running = false;

async function tick() {
  if (!ENABLED) return;
  if (running) return;

  running = true;
  const startedAt = Date.now();

  try {
    const { data, error } = await supabase.rpc(
      "ffg_rollover_weekly_periods"
    );

    if (error) {
      console.error(
        "[2048/finalizer] RPC error ffg_rollover_weekly_periods:",
        error.message
      );
      return;
    }

    const payload = data ?? {};
    const closed = payload.closed_periods ?? 0;
    const created = payload.created_new_active ?? false;

    if (closed > 0 || created) {
      console.log(
        `[2048/finalizer] rollover closed_periods=${closed} created_new_active=${created} duration=${
          Date.now() - startedAt
        }ms`
      );
    }
  } catch (err) {
    console.error("[2048/finalizer] unexpected error:", err);
  } finally {
    running = false;
  }
}

if (ENABLED) {
  console.log(
    `[2048/finalizer] enabled interval=${INTERVAL_MS}ms`
  );

  // Первый запуск через 2 секунды
  setTimeout(() => tick(), 2000);

  // Повторный запуск по интервалу
  setInterval(() => tick(), INTERVAL_MS);
} else {
  console.log(
    "[2048/finalizer] disabled by env GAME2048_FINALIZER_ENABLED=false"
  );
}
