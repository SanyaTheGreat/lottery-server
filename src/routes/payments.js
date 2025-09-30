// src/routes/payments.js
import express from "express";
import { supabase } from "../services/supabaseClient.js";

const router = express.Router();
const BOT_TOKEN = process.env.BOT_TOKEN; // токен бота (как в webhook.js)

// вспомогалки
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
  return data.result; // invoice link
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

// POST /payments/create-invoice
// body: { telegram_id: number, tickets_desired: number }  // tickets === TON в вашем словаре
router.post("/create-invoice", async (req, res) => {
  try {
    const { telegram_id, tickets_desired } = req.body || {};

    // валидация входа
    if (!telegram_id || typeof telegram_id !== "number") {
      return res.status(400).json({ error: "telegram_id (number) is required" });
    }
    const td = Number(tickets_desired);
    if (!td || td < 0.1 || !isStep01(td)) {
      return res.status(400).json({ error: "tickets_desired must be >= 0.1 and step of 0.1" });
    }

    // получаем курс
    const { ton_per_100stars, fee_markup } = await getFx();
    const ton_per_star  = Number(ton_per_100stars) / 100;
    const netMultiplier = 1 - Number(fee_markup);

    // считаем, сколько ⭐ запросить, чтобы нетто зачислить tickets_desired
    // stars_needed = ceil( tickets / (ton_per_star * (1 - fee)) )
    const denominator = ton_per_star * netMultiplier;
    if (denominator <= 0) {
      return res.status(500).json({ error: "Invalid fx rate configuration" });
    }
    const stars_needed = ceilToInt(td / denominator);

    // создаём invoice через Telegram
    // Для Stars:
    // currency: "XTR"
    // prices: [{ label: "Stars", amount: <целое число звёзд> }]
    // payload можно использовать для идемпотентности/аудита
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
      // опционально:
      // need_name: false, need_phone_number: false, ...
    };

    const invoice_link = await tgCreateInvoiceLink(payload);

    // вернём ссылку фронту
    return res.json({
      ok: true,
      invoice_link,
      // можно вернуть и расчёт, чтобы фронт показал подсказку:
      stars_needed,
      fx: { ton_per_100stars, fee_markup }
    });
  } catch (e) {
    console.error("create-invoice error:", e);
    return res.status(500).json({ error: "Failed to create invoice" });
  }
});

export default router;
