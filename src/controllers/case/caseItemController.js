import { supabase } from "../../services/supabaseClient.js";

// 🔹 Добавить предмет в кейс
export const addCaseItem = async (req, res) => {
  try {
    const { case_id, title, tier, type, weight, payout_value, active = true } = req.body;

    if (!case_id || !title || !type || !weight) {
      return res.status(400).json({ error: "case_id, title, type и weight обязательны" });
    }

    const { data, error } = await supabase
      .from("case_items")
      .insert([{ case_id, title, tier, type, weight, payout_value, active }])
      .select()
      .single();

    if (error) throw error;

    return res.json(data);
  } catch (err) {
    console.error("❌ Ошибка addCaseItem:", err.message);
    return res.status(500).json({ error: "Ошибка при добавлении предмета в кейс" });
  }
};

// 🔹 Получить предметы конкретного кейса
export const getCaseItems = async (req, res) => {
  try {
    const { case_id } = req.params;

    const { data, error } = await supabase
      .from("case_items")
      .select("*")
      .eq("case_id", case_id)
      .order("id", { ascending: true });

    if (error) throw error;

    return res.json(data);
  } catch (err) {
    console.error("❌ Ошибка getCaseItems:", err.message);
    return res.status(500).json({ error: "Ошибка при получении предметов кейса" });
  }
};
