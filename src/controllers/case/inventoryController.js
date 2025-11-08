import { supabase } from "../../services/supabaseClient.js";

/* =======================
   Anti-spam HOTFIX (drop-in)
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

// анти-дубль: защита от частых повторных запросов
const DEDUPE_WINDOW = 1500; // 1.5 секунды
function dedupeOnce(key) {
  const now = Date.now();
  const exp = recentActions.get(key);
  if (exp && exp > now) return false;
  recentActions.set(key, now + DEDUPE_WINDOW);
  setTimeout(() => recentActions.delete(key), DEDUPE_WINDOW + 500);
  return true;
}

// Лимиты (можно менять без перезагрузки)
const SEC_LIMIT = 3;   // не больше 3 запросов в секунду
const MIN_LIMIT = 100; // не больше 100 запросов в минуту

/**
 * GET /api/inventory  (🔐 JWT)
 * Возвращает pending-призы текущего пользователя из VIEW inventory_pending.
 * telegram_id берём из req.user (мидлварь requireJwt()).
 */
export const getInventory = async (req, res) => {
  try {
    const telegram_id = req.user?.telegram_id;
    if (!telegram_id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // 🔐 анти-дубль
    if (!dedupeOnce(`inventory:${telegram_id}`)) {
      return res.status(409).json({ error: "Операция уже выполняется" });
    }

    // 🔒 блокируем пользователя, чтобы не было параллельных вызовов
    await acquireUserLock(telegram_id);
    try {
      // локальные лимиты
      if (!passLocalRate(telegram_id, 1000, SEC_LIMIT)) {
        return res.status(429).json({ error: "Too many requests per second" });
      }
      if (!passLocalRate(telegram_id, 60_000, MIN_LIMIT)) {
        return res.status(429).json({ error: "Too many requests per minute" });
      }

      const { data, error } = await supabase
        .from("inventory_pending")
        .select("*")
        .eq("telegram_id", String(telegram_id))
        .order("created_at", { ascending: false });

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      return res.json({ items: data || [] });
    } finally {
      releaseUserLock(telegram_id);
    }
  } catch (e) {
    return res.status(500).json({ error: "getInventory failed" });
  }
};
