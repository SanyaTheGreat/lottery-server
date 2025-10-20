// src/controllers/freeSpinController.js
import { supabase } from "../../services/supabaseClient.js";

// GET /api/free-spin/availability  🔐 JWT required
export const getFreeSpinAvailability = async (req, res) => {
  try {
    const telegram_id = req.user?.telegram_id;
    if (!telegram_id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // 1️⃣ Получаем пользователя
    const { data: user, error: uerr } = await supabase
      .from("users")
      .select("id, telegram_id, free_spin_last_at")
      .eq("telegram_id", telegram_id)
      .single();

    if (uerr || !user) {
      return res.status(404).json({ error: "User not found" });
    }

    // 2️⃣ Проверяем, было ли хотя бы одно пополнение
    const { data: dep, error: derr } = await supabase
      .from("sells")
      .select("telegram_id, amount, amount_ton")
      .eq("telegram_id", telegram_id)
      .limit(1);

    if (derr) {
      return res.status(500).json({ error: derr.message });
    }

    const hasDeposit =
      !!(dep && dep.length && ((dep[0].amount ?? dep[0].amount_ton ?? 0) > 0));

    // 3️⃣ Находим самый дешёвый активный кейс
    const { data: cheap, error: cerr } = await supabase
      .from("cases")
      .select("id, price, is_active")
      .eq("is_active", true)
      .order("price", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (cerr || !cheap) {
      return res.status(404).json({ error: "No active cases found" });
    }

    // 4️⃣ Проверяем кулдаун (раз в 24 часа)
    const last = user.free_spin_last_at
      ? new Date(user.free_spin_last_at)
      : new Date(0);
    const nextAt = new Date(last.getTime() + 24 * 60 * 60 * 1000);
    const cooldownPassed = new Date() >= nextAt;

    // ✅ Ответ
    return res.status(200).json({
      available: hasDeposit && cooldownPassed,
      cheapest_case_id: cheap.id,
      next_at: nextAt.toISOString(),
      has_deposit: hasDeposit,
    });
  } catch (e) {
    console.error("❌ freeSpin availability failed:", e);
    return res.status(500).json({ error: "availability failed" });
  }
};
