import { supabase } from "../../services/supabaseClient.js";

// 🔹 Создать кейс
export const createCase = async (req, res) => {
  try {
    const { name, title, price, status = "active" } = req.body;

    if (!name || !title || !price) {
      return res.status(400).json({ error: "name, title и price обязательны" });
    }

    const { data, error } = await supabase
      .from("cases")
      .insert([{ name, title, price, status }])
      .select()
      .single();

    if (error) throw error;

    return res.json(data);
  } catch (err) {
    console.error("❌ Ошибка createCase:", err.message);
    return res.status(500).json({ error: "Ошибка при создании кейса" });
  }
};

// 🔹 Получить все кейсы
export const getCases = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("cases")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    return res.json(data);
  } catch (err) {
    console.error("❌ Ошибка getCases:", err.message);
    return res.status(500).json({ error: "Ошибка при получении кейсов" });
  }
};
