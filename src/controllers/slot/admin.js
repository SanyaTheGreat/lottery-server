import { supabase } from "../../../services/supabaseClient.js";

/**
 * POST /api/admin/slots
 * Создать слот (через GEM_KEY, без JWT)
 * Headers: { "x-gem-key": "<ключ>" }
 */
export const createSlot = async (req, res) => {
  try {
    const gemKey = req.headers["x-gem-key"];
    if (!gemKey || gemKey !== process.env.GEM_KEY) {
      return res.status(403).json({ error: "Invalid GEM_KEY" });
    }

    const {
      name,
      nft_name,
      price,
      gift_price = 25,
      gift_count = 0,
      is_infinite = false,
      active = true,
    } = req.body || {};

    if (!nft_name || price === undefined) {
      return res
        .status(400)
        .json({ error: "Поля nft_name и price обязательны" });
    }

    const { data, error } = await supabase
      .from("slots")
      .insert([
        { name, nft_name, price, gift_price, gift_count, is_infinite, active },
      ])
      .select(
        "id, name, nft_name, price, gift_price, gift_count, is_infinite, active"
      )
      .single();

    if (error) return res.status(500).json({ error: error.message });

    return res.status(201).json({
      message: "Слот успешно создан",
      slot: data,
    });
  } catch (e) {
    return res.status(500).json({ error: "createSlot failed" });
  }
};
