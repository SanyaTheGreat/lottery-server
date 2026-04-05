import { supabase } from "../../services/supabaseClient.js";

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL || "https://frontend-nine-sigma-49.vercel.app";
const GEM_KEY = process.env.GEM_KEY;

async function tg(method, payload) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

async function sendMessage(chat_id, text, extra = {}) {
  return tg("sendMessage", { chat_id, text, ...extra });
}

async function answerPreCheckoutQuery(id, ok = true, error_message) {
  const body = { pre_checkout_query_id: id, ok };
  if (!ok && error_message) body.error_message = error_message;
  return tg("answerPreCheckoutQuery", body);
}

function floorToTenthsInt(value) {
  return Math.floor((Number(value) + 1e-9) * 10);
}

async function getFx() {
  const { data, error } = await supabase
    .from("fx_rates")
    .select("ton_per_100stars, fee_markup")
    .order("id", { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    return { ton_per_100stars: 0.5530, fee_markup: 0.20 };
  }
  return data;
}

export default async function telegramWebhook(req, res) {
  try {
    if (GEM_KEY) {
      const headerSecret = req.headers["x-telegram-bot-api-secret-token"];
      if (!headerSecret || headerSecret !== GEM_KEY) {
        console.warn("🚫 Invalid or missing Telegram secret token");
        return res.sendStatus(401);
      }
    }

    const upd = req.body;

    if (upd?.pre_checkout_query) {
      await answerPreCheckoutQuery(upd.pre_checkout_query.id, true);
      return res.sendStatus(200);
    }

    const msg = upd?.message || upd?.edited_message;

    if (msg?.text?.startsWith("/start")) {
      const user = msg.from;
      const parts = msg.text.trim().split(/\s+/, 2);
      const ref_id = parts.length > 1 ? parts[1] : null;

      const isSelfRef = ref_id && String(ref_id) === String(user.id);
      const search = new URLSearchParams();
      if (ref_id && !isSelfRef) search.set("ref", ref_id);
      search.set("tgWebAppExpand", "true");

      const url = `${WEBAPP_URL.replace(/\/$/, "")}/?${search.toString()}`;
      const reply_markup = {
        inline_keyboard: [[{ text: "🚀 Открыть приложение", web_app: { url } }]],
      };

      await sendMessage(
        msg.chat.id,
        `Привет, ${user.first_name || "друг"}! 👋 Нажми кнопку ниже, чтобы открыть приложение.`,
        { reply_markup }
      );

      return res.sendStatus(200);
    }

    const sp = msg?.successful_payment;
    if (sp) {
      const rawPayload = String(sp.invoice_payload || "");
      console.log("[tg-payments] successful_payment payload:", rawPayload);

      // --------------------------------------------------
      // UNDO PAYMENT
      // --------------------------------------------------
      if (rawPayload.startsWith("undo:")) {
        const paymentId = Number(rawPayload.split(":")[1]);

        if (!Number.isFinite(paymentId) || paymentId <= 0) {
          console.error("[tg-payments] invalid undo payment id:", rawPayload);
          return res.sendStatus(200);
        }

        const { data: payment, error: paymentErr } = await supabase
          .from("undo_payments")
          .select("*")
          .eq("id", paymentId)
          .maybeSingle();

        if (paymentErr) {
          console.error("[tg-payments] select undo payment error:", paymentErr);
          return res.sendStatus(200);
        }

        if (!payment) {
          console.error("[tg-payments] undo payment not found:", paymentId);
          return res.sendStatus(200);
        }

        if (payment.status === "paid" || payment.status === "consumed") {
          console.log("[tg-payments] undo payment already processed:", paymentId);
          return res.sendStatus(200);
        }

        if (sp.currency !== "XTR") {
          console.error("[tg-payments] invalid undo currency:", sp.currency);
          return res.sendStatus(200);
        }

        if (Number(sp.total_amount) !== Number(payment.price)) {
          console.error("[tg-payments] undo amount mismatch:", {
            expected: Number(payment.price),
            actual: Number(sp.total_amount),
            paymentId,
          });
          return res.sendStatus(200);
        }

        const { error: updateErr } = await supabase
          .from("undo_payments")
          .update({
            status: "paid",
            telegram_payment_charge_id: sp.telegram_payment_charge_id || null,
            provider_payment_charge_id: sp.provider_payment_charge_id || null,
          })
          .eq("id", paymentId)
          .eq("status", "pending");

        if (updateErr) {
          console.error("[tg-payments] update undo payment error:", updateErr);
          return res.sendStatus(200);
        }

        console.log("[tg-payments] undo payment marked paid:", {
          payment_id: payment.id,
          run_id: payment.run_id,
          user_id: payment.user_id,
          telegram_id: payment.telegram_id,
          undo_used_count: payment.undo_used_count,
          price: payment.price,
        });

        return res.sendStatus(200);
      }

      // --------------------------------------------------
      // TOPUP PAYMENT
      // --------------------------------------------------
      const telegram_id = msg.from.id;
      const stars_paid = sp.total_amount;
      const tx_id = sp.telegram_payment_charge_id || sp.provider_payment_charge_id;

      const { data: exists } = await supabase
        .from("sells")
        .select("id")
        .eq("tx_id", tx_id)
        .maybeSingle();

      if (exists) return res.sendStatus(200);

      const { ton_per_100stars, fee_markup } = await getFx();
      const ton_per_star = Number(ton_per_100stars) / 100;
      const netMultiplier = 1 - Number(fee_markup);

      const tickets_raw = Number(stars_paid) * ton_per_star * netMultiplier;
      const tickets_tenths = floorToTenthsInt(tickets_raw);
      const tickets_credit = tickets_tenths / 10;

      await supabase.from("sells").insert({
        telegram_id,
        amount_stars: stars_paid,
        amount_ton: Number.isFinite(tickets_raw) ? Number(tickets_raw.toFixed(6)) : null,
        amount: tickets_credit,
        rate_at: ton_per_100stars,
        tx_id,
        status: "paid",
        payload: JSON.stringify({ currency: sp.currency, invoice_payload: rawPayload }),
      });

      const { data: user } = await supabase
        .from("users")
        .select("id, tickets")
        .eq("telegram_id", telegram_id)
        .maybeSingle();

      const delta = tickets_tenths / 10;

      if (user) {
        const new_balance = Number(((user.tickets || 0) + delta).toFixed(2));
        await supabase.from("users").update({ tickets: new_balance }).eq("id", user.id);
      } else {
        await supabase.from("users").insert({
          telegram_id,
          tickets: Number(delta.toFixed(2)),
        });
      }

      await sendMessage(
        msg.chat.id,
        `Оплата получена ✅ Зачислено: ${tickets_credit.toFixed(1)} TON`
      );

      return res.sendStatus(200);
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error("❌ Telegram webhook error:", err);
    return res.sendStatus(500);
  }
}