// controllers/slot/inventory.js
import { supabase } from "../../services/supabaseClient.js";

/**
 * GET /api/inventory/slot   🔐 JWT
 * Возвращает только инвентарь для слотов.
 */
export const getSlotInventory = async (req, res) => {
  try {
    const telegram_id = req.user?.telegram_id;
    if (!telegram_id) return res.status(401).json({ error: "Unauthorized" });

    const { data: user, error: uErr } = await supabase
      .from("users")
      .select("id")
      .eq("telegram_id", telegram_id)
      .single();
    if (uErr || !user) return res.status(404).json({ error: "user not found" });

    const { data, error } = await supabase
      .from("user_inventory")
      .select("id, slot_id, nft_name, status, created_at")
      .eq("user_id", user.id)
      .not("slot_id", "is", null)
      .order("created_at", { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
    res.removeHeader?.("ETag");

    return res.json(data || []);
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

    // Находим предмет
    const { data: inv, error: invErr } = await supabase
      .from("user_inventory")
      .select("id, user_id, slot_id, nft_name, status")
      .eq("id", id)
      .single();
    if (invErr || !inv) return res.status(404).json({ error: "inventory not found" });
    if (inv.status !== "jackpot") return res.status(409).json({ error: "wrong state" });

    // Владелец
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

    // Обновляем баланс
    const { error: feeErr } = await supabase
      .from("users")
      .update({ stars: Number(owner.stars) - fee })
      .eq("id", owner.id);
    if (feeErr) return res.status(500).json({ error: feeErr.message });

    // Берём доступный gift
    const { data: gifts, error: gErr } = await supabase
      .from("slot_gifts")
      .select("id, nft_name, nft_number, msg_id, is_infinite, used")
      .eq("nft_name", inv.nft_name)
      .eq("used", false)
      .limit(50);
    if (gErr) return res.status(500).json({ error: gErr.message });
    if (!gifts?.length) return res.status(409).json({ error: "no available gift" });

    const gift = gifts[Math.floor(Math.random() * gifts.length)];

    // Помечаем gift как использованный
    if (!gift.is_infinite) {
      const { error: markErr } = await supabase
        .from("slot_gifts")
        .update({ used: true })
        .eq("id", gift.id);
      if (markErr) return res.status(500).json({ error: markErr.message });
    }

    // Создаём задачу на отправку подарка
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

    // Обновляем инвентарь
    const { error: invUpdErr } = await supabase
      .from("user_inventory")
      .update({ status: "reward_sent" })
      .eq("id", inv.id);
    if (invUpdErr) return res.status(500).json({ error: invUpdErr.message });

    // Декремент gift_count, если не infinite
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
  } catch (e) {
    console.error("withdrawSlotItem failed", e);
    return res.status(500).json({ error: "withdrawSlotItem failed" });
  }
};

export { getSlotInventory as getInventory };