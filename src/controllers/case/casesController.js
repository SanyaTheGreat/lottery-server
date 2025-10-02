import { supabase } from "../../services/supabaseClient.js";

// POST /api/cases
export const createCase = async (req, res) => {
  try {
    const { name, price, is_active = true } = req.body;
    if (!name || price === undefined) {
      return res.status(400).json({ error: "name и price обязательны" });
    }

    const { data, error } = await supabase
      .from("cases")
      .insert([{ name, price, is_active }])
      .select("id, name, price, is_active")
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
    const { data, error } = await supabase
      .from("cases")
      .select("id, name, price, is_active")
      .order("name", { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  } catch (e) {
    return res.status(500).json({ error: "getCases failed" });
  }
};
