import { supabase } from "../../services/supabaseClient.js";

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

    const { data, error } = await supabase
      .from("inventory_pending")
      .select("*")
      .eq("telegram_id", String(telegram_id))
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.json({ items: data || [] });
  } catch (e) {
    return res.status(500).json({ error: "getInventory failed" });
  }
};
