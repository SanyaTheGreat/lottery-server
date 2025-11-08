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

// анти-дубль
const DEDUPE_WINDOW = 1500;
function dedupeOnce(key) {
  const now = Date.now();
  const exp = recentActions.get(key);
  if (exp && exp > now) return false;
  recentActions.set(key, now + DEDUPE_WINDOW);
  setTimeout(() => recentActions.delete(key), DEDUPE_WINDOW + 500);
  return true;
}

// лимиты
const SEC_LIMIT = 3;
const MIN_LIMIT = 60;

/**
 * GET /api/inventory/slot   🔐 JWT
 * Возвращает только инвентарь для слотов.
 */
export const getSlotInventory = async (req, res) => {
  try {
    const telegram_id = req.user?.telegram_id;
    if (!telegram_id) return res.status(401).json({ error: "Unauthorized" });

    if (!dedupeOnce(`slotInv:${telegram_id}`)) {
      return res.status(409).json({ error: "Операция уже выполняется" });
    }

    await acquireUserLock(telegram_id);
    try {
      if (!passLocalRate(telegram_id, 1000, SEC_LIMIT))
        return res.status(429).json({ error: "Too many requests per second" });
      if (!passLocalRate(telegram_id, 60_000, MIN_LIMIT))
        return res.status(429).json({ error: "Too many requests per minute" });

      const { data: user, error: uErr } = await supabase
        .from("users")
        .select("id")
        .eq("telegram_id", telegram_id)
        .single();
      if (uErr || !user)
        return res.status(404).json({ error: "user not found" });

      const { data, error } = await supabase
        .from("user_inventory")
        .select(`
          id, slot_id, nft_name, status, created_at,
          slots:slot_id ( slug )
        `)
        .eq("user_id", user.id)
        .not("slot_id", "is", null)
        .order("created_at", { ascending: false });

      if (error) return res.status(500).json({ error: error.message });

      const list = (data || []).map((x) => ({
        id: x.id,
        slot_id: x.slot_id,
        nft_name: x.nft_name,
        status: x.status,
        created_at: x.created_at,
        slot_slug: x.slots?.slug || null,
      }));

      res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.set("Pragma", "no-cache");
      res.set("Expires", "0");
      res.removeHeader?.("ETag");

      return res.json(list);
    } finally {
      releaseUserLock(telegram_id);
    }
  } catch (e) {
    return res.status(500).json({ error: "getSlotInventory failed" });
  }
};

/**
 * POST /api/inventory/slot/:id/withdraw   🔐 JWT
 * Списывает 25⭐, резервирует gift, создаёт pending_rewards,
 * помечает предмет как reward_sent и декрементирует gift_count, если не infinite.
 */
export const withdrawSlotItem = async (req, res) => {
  try {
    const telegram_id = req.user?.telegram_id;
    if (!telegram_id) return res.status(401).json({ error: "Unauthorized" });

    const { id } = req.params;
    if (!id) return res.status(400).json({ error: "inventory_id обязателен" });

    // 🔐 антидубль и лок
    if (!dedupeOnce(`withdraw:${telegram_id}:${id}`)) {
      return res.status(409).json({ error: "Duplicate withdraw request" });
    }
    await acquireUserLock(telegram_id);
    try {
      if (!passLocalRate(telegram_id, 1000, 2))
        return res.status(429).json({ error: "Too many withdraws per second" });
      if (!passLocalRate(telegram_id, 60_000, 20))
        return res.status(429).json({ error: "Too many withdraws per minute" });

      const { data: inv, error: invErr } = await supabase
        .from("user_inventory")
        .select("id, user_id, slot_id, nft_name, status")
        .eq("id", id)
        .single();
      if (invErr || !inv)
        return res.status(404).json({ error: "inventory not found" });
      if (inv.status !== "jackpot")
        return res.status(409).json({ error: "wrong state" });

      const { data: owner } = await supabase
        .from("users")
        .select("id, telegram_id, username, stars")
        .eq("id", inv.user_id)
        .single();
      if (!owner || String(owner.telegram_id) !== String(telegram_id)) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const fee = 25;
      if (Number(owner.stars || 0) < fee) {
        return res.status(402).json({ error: "Недостаточно звёзд для вывода (нужно 25⭐)" });
      }

      const { error: feeErr } = await supabase
        .from("users")
        .update({ stars: Number(owner.stars) - fee })
        .eq("id", owner.id);
      if (feeErr) return res.status(500).json({ error: feeErr.message });

      const { data: gifts, error: gErr } = await supabase
        .from("slot_gifts")
        .select("id, nft_name, nft_number, msg_id, is_infinite, used")
        .eq("nft_name", inv.nft_name)
        .eq("used", false)
        .limit(50);
      if (gErr) return res.status(500).json({ error: gErr.message });
      if (!gifts?.length)
        return res.status(409).json({ error: "no available gift" });

      const gift = gifts[Math.floor(Math.random() * gifts.length)];

      if (!gift.is_infinite) {
        const { error: markErr } = await supabase
          .from("slot_gifts")
          .update({ used: true })
          .eq("id", gift.id);
        if (markErr) return res.status(500).json({ error: markErr.message });
      }

      const { error: prErr } = await supabase.from("pending_rewards").insert([{
        source: "slot",
        spin_id: null,
        winner_id: owner.id,
        telegram_id: owner.telegram_id,
        username: owner.username ?? null,
        nft_name: gift.nft_name,
        nft_number: gift.nft_number,
        msg_id: gift.msg_id,
        status: "pending",
      }]);
      if (prErr) return res.status(500).json({ error: prErr.message });

      const { error: invUpdErr } = await supabase
        .from("user_inventory")
        .update({ status: "reward_sent" })
        .eq("id", inv.id);
      if (invUpdErr) return res.status(500).json({ error: invUpdErr.message });

      const { data: slot } = await supabase
        .from("slots")
        .select("id, is_infinite, gift_count")
        .eq("id", inv.slot_id)
        .single();
      if (slot && !slot.is_infinite) {
        const left = Math.max(0, Number(slot.gift_count || 0) - 1);
        await supabase.from("slots").update({ gift_count: left }).eq("id", slot.id);
      }

      return res.json({ status: "reward_sent" });
    } finally {
      releaseUserLock(telegram_id);
    }
  } catch (e) {
    console.error("withdrawSlotItem failed", e);
    return res.status(500).json({ error: "withdrawSlotItem failed" });
  }
};

export { getSlotInventory as getInventory };
