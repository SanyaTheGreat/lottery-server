// src/routes/payments.js
import express from "express";
import { supabase } from "../services/supabaseClient.js";
import { requireJwt } from "../middleware/requireJwt.js";

const router = express.Router();
const BOT_TOKEN = process.env.BOT_TOKEN;

// helpers
function ceilToInt(n) {
  return Math.ceil(Number(n));
}

function isStep01(x) {
  return Math.abs(x * 10 - Math.round(x * 10)) < 1e-9;
}

function getUndoPrice(undoUsedCount) {
  const n = Number(undoUsedCount ?? 0);
  if (n <= 0) return 0;
  if (n === 1) return 10;
  if (n === 2) return 50;
  if (n === 3) return 100;
  return 1000;
}

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

// --------------------------------------------------
// TOPUP INVOICE
// --------------------------------------------------
router.post("/create-invoice", requireJwt(), async (req, res) => {
  try {
    const telegram_id = req.user?.telegram_id;
    if (!telegram_id) return res.status(401).json({ error: "Unauthorized" });

    const td = Number(req.body?.tickets_desired);
    if (!Number.isFinite(td) || td < 0.1 || !isStep01(td)) {
      return res.status(400).json({ error: "tickets_desired must be >= 0.1 with step 0.1" });
    }

    const { ton_per_100stars, fee_markup } = await getFx();
    const ton_per_star = Number(ton_per_100stars) / 100;
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
        stars_needed,
      }),
      currency: "XTR",
      prices: [{ label: "Stars", amount: stars_needed }],
    };

    const invoice_link = await tgCreateInvoiceLink(payload);

    return res.json({
      ok: true,
      invoice_link,
      stars_needed,
      fx: { ton_per_100stars, fee_markup },
    });
  } catch (e) {
    console.error("create-invoice error:", e);
    return res.status(500).json({ error: "Failed to create invoice" });
  }
});

// --------------------------------------------------
// UNDO INVOICE
// --------------------------------------------------
router.post("/create-undo-invoice", requireJwt(), async (req, res) => {
  try {
    const telegram_id = Number(req.user?.telegram_id);
    if (!telegram_id) return res.status(401).json({ error: "Unauthorized" });

    const { data: user, error: userErr } = await supabase
      .from("users")
      .select("id")
      .eq("telegram_id", telegram_id)
      .maybeSingle();

    if (userErr) {
      console.error("create-undo-invoice user select error:", userErr);
      return res.status(500).json({ error: "Failed to load user" });
    }

    if (!user?.id) {
      return res.status(404).json({ error: "User not found" });
    }

    const { data: runs, error: runErr } = await supabase
      .from("game_runs")
      .select("id,status,undo_available,prev_state,undo_used_count")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1);

    if (runErr) {
      console.error("create-undo-invoice run select error:", runErr);
      return res.status(500).json({ error: "Failed to load run" });
    }

    if (!runs?.length) {
      return res.status(409).json({ error: "No run found" });
    }

    const run = runs[0];

    if (!run.undo_available || !run.prev_state) {
      return res.status(409).json({ error: "Undo not available" });
    }

    const undo_used_count = Number(run.undo_used_count ?? 0);
    const price = getUndoPrice(undo_used_count);

    if (price <= 0) {
      return res.status(400).json({
        error: "Current undo is free and does not require payment",
        price: 0,
      });
    }

    const payload = {
      title: "Платный Undo",
      description: `Отмена последнего хода в 2048 за ${price} Stars`,
      payload: JSON.stringify({
        kind: "undo",
        telegram_id,
        user_id: user.id,
        run_id: run.id,
        undo_used_count,
        price,
      }),
      currency: "XTR",
      prices: [{ label: "Undo", amount: price }],
    };

    const invoice_link = await tgCreateInvoiceLink(payload);

    return res.json({
      ok: true,
      invoice_link,
      price,
      run_id: run.id,
      undo_used_count,
    });
  } catch (e) {
    console.error("create-undo-invoice error:", e);
    return res.status(500).json({ error: "Failed to create undo invoice" });
  }
});

export default router;