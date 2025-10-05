import { supabase } from "../../services/supabaseClient.js";

// POST /api/cases
export const createCase = async (req, res) => {
  try {
    const { name, price, is_active = true, allow_stars = true } = req.body;

    if (!name || price === undefined) {
      return res.status(400).json({ error: "name и price обязательны" });
    }

    const { data, error } = await supabase
      .from("cases")
      .insert([{ name, price, is_active, allow_stars }])
      .select("id, name, price, is_active, allow_stars")
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  } catch (e) {
    return res.status(500).json({ error: "createCase failed" });
  }
};

// GET /api/cases
export const getCases = async (_req, res) => {
  try {
    // Получаем курс stars_per_ton из fx_rates
    const { data: rateRow, error: rateErr } = await supabase
      .from("fx_rates")
      .select("stars_per_ton")
      .eq("id", 1)
      .single();

    if (rateErr || !rateRow) {
      return res.status(500).json({ error: "Не удалось получить курс stars_per_ton" });
    }

    const starsPerTon = Number(rateRow.stars_per_ton);

    // Загружаем кейсы
    const { data, error } = await supabase
      .from("cases")
      .select("id, name, price, is_active, allow_stars")
      .order("name", { ascending: true });

    if (error) return res.status(500).json({ error: error.message });

    // Добавляем вычисляемое поле price_in_stars
    const casesWithStars = (data || []).map((c) => ({
      ...c,
      price_in_stars: Math.ceil(Number(c.price) * starsPerTon),
    }));

    return res.json(casesWithStars);
  } catch (e) {
    return res.status(500).json({ error: "getCases failed" });
  }
};
