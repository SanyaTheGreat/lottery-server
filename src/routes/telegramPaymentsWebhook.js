// src/routes/telegramPaymentsWebhook.js
import express from "express";
import { supabase } from "../services/supabaseClient.js";

const router = express.Router();

router.post("/webhook", async (req, res) => {
  try {
    const update = req.body || {};
    const msg = update.message;

    // Telegram ждёт быстрый 200
    res.sendStatus(200);

    if (!msg?.successful_payment) return;

    const sp = msg.successful_payment;

    let payload;
    try {
      payload = JSON.parse(sp.invoice_payload || "{}");
    } catch {
      console.error("[tg-payments] invalid invoice_payload json");
      return;
    }

    if (payload?.kind !== "undo") return;

    const telegram_id = Number(payload.telegram_id);
    const user_id = Number(payload.user_id);
    const undo_used_count = Number(payload.undo_used_count ?? 0);
    const price = Number(payload.price ?? 0);
    const run_id = payload.run_id ? String(payload.run_id) : null;

    if (!telegram_id || !user_id || !run_id || !Number.isFinite(price) || price <= 0) {
      console.error("[tg-payments] invalid undo payload:", payload);
      return;
    }

    if (sp.currency !== "XTR") {
      console.error("[tg-payments] invalid currency:", sp.currency);
      return;
    }

    if (Number(sp.total_amount) !== price) {
      console.error("[tg-payments] amount mismatch:", {
        expected: price,
        actual: Number(sp.total_amount),
      });
      return;
    }

    const row = {
      user_id,
      telegram_id,
      run_id,
      undo_used_count,
      price,
      status: "paid",
      telegram_payment_charge_id: sp.telegram_payment_charge_id || null,
      provider_payment_charge_id: sp.provider_payment_charge_id || null,
      payload_json: payload,
    };

    const { error } = await supabase
      .from("undo_payments")
      .upsert(row, {
        onConflict: "telegram_payment_charge_id",
        ignoreDuplicates: false,
      });

    if (error) {
      console.error("[tg-payments] upsert undo payment error:", error);
      return;
    }

    console.log("[tg-payments] undo payment saved:", {
      run_id,
      user_id,
      telegram_id,
      undo_used_count,
      price,
    });
  } catch (e) {
    console.error("[tg-payments] webhook error:", e);
    try {
      res.sendStatus(200);
    } catch {}
  }
});

export default router;