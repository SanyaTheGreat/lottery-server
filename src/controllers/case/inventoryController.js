import { supabase } from "../../services/supabaseClient.js";

/**
 * GET /api/inventory?telegram_id=... | ?user_id=...
 * Возвращает pending-призы из VIEW inventory_pending.
 */
export const getInventory = async (req, res) => {
  try {
    const telegram_id = req.query.telegram_id ? String(req.query.telegram_id) : null;
    const user_id     = req.query.user_id ? String(req.query.user_id) : null;

    if (!telegram_id && !user_id) {
      return res.status(400).json({ error: "telegram_id or user_id is required" });
    }

    let query = supabase
      .from("inventory_pending")
      .select("*")
      .order("created_at", { ascending: false });

    if (telegram_id) query = query.eq("telegram_id", telegram_id);
    if (!telegram_id && user_id) query = query.eq("user_id", user_id);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ items: data || [] });
  } catch (e) {
    return res.status(500).json({ error: "getInventory failed" });
  }
};
