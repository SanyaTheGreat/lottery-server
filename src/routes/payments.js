// src/routes/payments.js
import express from "express";
import { supabase } from "../services/supabaseClient.js";
import { requireJwt } from "../middleware/requireJwt.js";

const router = express.Router();
const BOT_TOKEN = process.env.BOT_TOKEN;

// helpers
function ceilToInt(n) { return Math.ceil(Number(n)); }
function isStep01(x) { return Math.abs((x * 10) - Math.round(x * 10)) < 1e-9; }

async function tgCreateInvoiceLink(payload) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/createInvoiceLink`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.description || "Telegram createInvoiceLink failed");
  return data.result;
}

async function getFx() {
  const { data, error } = await supabase
    .from("fx_rates")
    .select("ton_per_100stars, fee_markup")
    .order("id", { ascending: false })
    .limit(1)
    .single();

  if (error || !data) return { ton_per_100stars: 0.5530, fee_markup: 0.20 };
  return data;
}

// ✅ теперь защищено JWT и НЕ требуется telegram_id в body
router.post("/create-invoice", requireJwt(), async (req, res) => {
  try {
    const telegram_id = req.user?.telegram_id;           // ← из токена
    if (!telegram_id) return res.status(401).json({ error: "Unauthorized" });

    const td = Number(req.body?.tickets_desired);
    if (!Number.isFinite(td) || td < 0.1 || !isStep01(td)) {
      return res.status(400).json({ error: "tickets_desired must be >= 0.1 with step 0.1" });
    }

    const { ton_per_100stars, fee_markup } = await getFx();
    const ton_per_star  = Number(ton_per_100stars) / 100;
    const netMultiplier = 1 - Number(fee_markup);

    const denominator = ton_per_star * netMultiplier;
    if (!Number.isFinite(denominator) || denominator <= 0) {
      return res.status(500).json({ error: "Invalid fx rate configuration" });
    }

    const stars_needed = ceilToInt(td / denominator);

    const payload = {
      title: "Пополнение баланса",
      description: `Зачислим ~${td.toFixed(1)} tickets (с учётом комиссии)`,
      payload: JSON.stringify({
        kind: "topup",
        telegram_id,
        tickets_desired: td,
        stars_needed
      }),
      currency: "XTR",
      prices: [{ label: "Stars", amount: stars_needed }],
    };

    const invoice_link = await tgCreateInvoiceLink(payload);

    return res.json({
      ok: true,
      invoice_link,
      stars_needed,
      fx: { ton_per_100stars, fee_markup }
    });
  } catch (e) {
    console.error("create-invoice error:", e);
    return res.status(500).json({ error: "Failed to create invoice" });
  }
});

export default router;
