// src/controllers/freeSpinController.js
import { supabase } from "../../services/supabaseClient.js";

// GET /api/free-spin/availability?telegram_id=...
export const getFreeSpinAvailability = async (req, res) => {
  try {
    const telegram_id = req.query.telegram_id ? String(req.query.telegram_id) : null;
    if (!telegram_id) return res.status(400).json({ error: "telegram_id is required" });

    // юзер
    const { data: user, error: uerr } = await supabase
      .from("users")
      .select("id, telegram_id, free_spin_last_at")
      .eq("telegram_id", telegram_id)
      .single();
    if (uerr || !user) return res.status(404).json({ error: "user not found" });

    // есть ли пополнение хоть раз
    const { data: dep, error: derr } = await supabase
      .from("sells")
      .select("telegram_id, amount, amount_ton")
      .eq("telegram_id", telegram_id)
      .limit(1);
    if (derr) return res.status(500).json({ error: derr.message });

    const hasDeposit = !!(dep && dep.length && ((dep[0].amount ?? dep[0].amount_ton ?? 0) > 0));

    // самый дешёвый активный кейс
    const { data: cheap, error: cerr } = await supabase
      .from("cases")
      .select("id, price, is_active")
      .eq("is_active", true)
      .order("price", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (cerr || !cheap) return res.status(404).json({ error: "no active cases" });

    const last = user.free_spin_last_at ? new Date(user.free_spin_last_at) : new Date(0);
    const nextAt = new Date(last.getTime() + 24 * 60 * 60 * 1000);
    const cooldownPassed = new Date() >= nextAt;

    return res.json({
      available: hasDeposit && cooldownPassed,
      cheapest_case_id: cheap.id,
      next_at: nextAt.toISOString(),
      has_deposit: hasDeposit,
    });
  } catch (e) {
    return res.status(500).json({ error: "availability failed" });
  }
};
