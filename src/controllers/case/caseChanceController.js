import { supabase } from "../../services/supabaseClient.js";

// POST /api/cases/:case_id/chance
export const addCaseChance = async (req, res) => {
  try {
    const { case_id } = req.params;
    const {
      nft_name,
      slug,
      weight,
      price,
      payout_value,
      payout_stars = null,
      quantity = 0,
      percent = null,
      chance = null,
      is_active = true,
    } = req.body;

    if (!case_id || !slug || !nft_name || weight === undefined || price === undefined || payout_value === undefined) {
      return res.status(400).json({
        error: "case_id, nft_name, slug, weight, price, payout_value обязательны",
      });
    }

    const { data, error } = await supabase
      .from("case_chance")
      .insert([
        {
          case_id,
          nft_name,
          slug,
          weight,
          price,
          payout_value,
          payout_stars,
          quantity,
          chance,
          percent,
          is_active,
        },
      ])
      .select("*")
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  } catch (e) {
    return res.status(500).json({ error: "addCaseChance failed" });
  }
};

// GET /api/cases/:case_id/chance
export const getCaseChance = async (req, res) => {
  try {
    const { case_id } = req.params;

    const { data, error } = await supabase
      .from("case_chance")
      .select("id, nft_name, percent, slug, weight, price, payout_value, payout_stars, quantity, is_active")
      .eq("case_id", case_id)
      .order("nft_name", { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  } catch (e) {
    return res.status(500).json({ error: "getCaseChance failed" });
  }
};
