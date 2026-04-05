import express from "express";
import { supabase } from "../services/supabaseClient.js";

const router = express.Router();

router.post("/webhook", async (req, res) => {
  try {
    const update = req.body || {};
    const msg = update.message;

    res.sendStatus(200);

    if (!msg?.successful_payment) return;

    const sp = msg.successful_payment;
    const rawPayload = String(sp.invoice_payload || "");

    if (!rawPayload.startsWith("undo:")) return;

    const paymentId = Number(rawPayload.split(":")[1]);
    if (!Number.isFinite(paymentId) || paymentId <= 0) {
      console.error("[tg-payments] invalid undo payment id:", rawPayload);
      return;
    }

    const { data: payment, error: paymentErr } = await supabase
      .from("undo_payments")
      .select("*")
      .eq("id", paymentId)
      .maybeSingle();

    if (paymentErr) {
      console.error("[tg-payments] select undo payment error:", paymentErr);
      return;
    }

    if (!payment) {
      console.error("[tg-payments] undo payment not found:", paymentId);
      return;
    }

    if (sp.currency !== "XTR") {
      console.error("[tg-payments] invalid currency:", sp.currency);
      return;
    }

    if (Number(sp.total_amount) !== Number(payment.price)) {
      console.error("[tg-payments] amount mismatch:", {
        expected: Number(payment.price),
        actual: Number(sp.total_amount),
        paymentId,
      });
      return;
    }

    const { error: updateErr } = await supabase
      .from("undo_payments")
      .update({
        status: "paid",
        telegram_payment_charge_id: sp.telegram_payment_charge_id || null,
        provider_payment_charge_id: sp.provider_payment_charge_id || null,
      })
      .eq("id", paymentId);

    if (updateErr) {
      console.error("[tg-payments] update undo payment error:", updateErr);
      return;
    }

    console.log("[tg-payments] undo payment saved:", {
      payment_id: payment.id,
      run_id: payment.run_id,
      user_id: payment.user_id,
      telegram_id: payment.telegram_id,
      undo_used_count: payment.undo_used_count,
      price: payment.price,
    });
  } catch (e) {
    console.error("[tg-payments] webhook error:", e);
    try {
      res.sendStatus(200);
    } catch {}
  }
});

export default router;