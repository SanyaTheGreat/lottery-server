import { supabase } from "../../services/supabaseClient.js";

// POST /api/cases/:case_id/chance
export const addCaseChance = async (req, res) => {
  try {
    const { case_id } = req.params;
    const { slug, weight, price, payout_value, quantity = 0, is_active = true } = req.body;

    if (!case_id || !slug || weight === undefined || price === undefined || payout_value === undefined) {
      return res.status(400).json({ error: "case_id, slug, weight, price, payout_value обязательны" });
    }

    const { data, error } = await supabase
      .from("case_chance")
      .insert([{ case_id, slug, weight, price, payout_value, quantity, is_active }])
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
      .select("id, slug, weight, price, payout_value, quantity, is_active")
      .eq("case_id", case_id)
      .order("slug", { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  } catch (e) {
    return res.status(500).json({ error: "getCaseChance failed" });
  }
};
