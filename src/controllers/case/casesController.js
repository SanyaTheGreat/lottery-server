import { supabase } from "../../services/supabaseClient.js";

/**
 * POST /api/cases   🔐 JWT
 * Создать кейс. Сейчас просто требуем авторизованного пользователя.
 * (Если есть роль админа — добавь проверку внутри по req.user.telegram_id.)
 */
export const createCase = async (req, res) => {
  try {
    const telegram_id = req.user?.telegram_id; // ← приходит из requireJwt()
    if (!telegram_id) return res.status(401).json({ error: "Unauthorized" });

    const { name, price, is_active = true, allow_stars = true } = req.body || {};
    if (!name || price === undefined) {
      return res.status(400).json({ error: "name и price обязательны" });
    }

    const { data, error } = await supabase
      .from("cases")
      .insert([{ name, price, is_active, allow_stars }])
      .select("id, name, price, is_active, allow_stars")
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  } catch (e) {
    return res.status(500).json({ error: "createCase failed" });
  }
};

/**
 * GET /api/cases   (публично)
 * Возвращает список кейсов + вычисляемое поле price_in_stars
 */
export const getCases = async (_req, res) => {
  try {
    // курс для пересчёта TON → Stars
    const { data: rateRow, error: rateErr } = await supabase
      .from("fx_rates")
      .select("stars_per_ton")
      .eq("id", 1)
      .single();

    if (rateErr || !rateRow) {
      return res.status(500).json({ error: "Не удалось получить курс stars_per_ton" });
    }

    const starsPerTon = Number(rateRow.stars_per_ton);

    const { data, error } = await supabase
      .from("cases")
      .select("id, name, price, is_active, allow_stars")
      .order("name", { ascending: true });

    if (error) return res.status(500).json({ error: error.message });

    const casesWithStars = (data || []).map((c) => ({
      ...c,
      price_in_stars: Math.ceil(Number(c.price) * starsPerTon),
    }));

    return res.json(casesWithStars);
  } catch (e) {
    return res.status(500).json({ error: "getCases failed" });
  }
};
