// src/controllers/telegram/webhook.js
import { supabase } from "../../services/supabaseClient.js";

// ENV
const BOT_TOKEN  = process.env.BOT_TOKEN; // токен бота (переменная в Render)
const WEBAPP_URL = process.env.WEBAPP_URL || "https://frontend-nine-sigma-49.vercel.app";

// ----- helpers ----------------------------------------------------

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

function roundDownToStep(value, step = 0.1) {
  // округляем ВНИЗ к шагу 0.1
  return Math.floor((Number(value) + 1e-9) / step) * step;
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

// ----- main handler -----------------------------------------------

export default async function telegramWebhook(req, res) {
  try {
    const upd = req.body;

    // 1) Подтверждаем платеж перед чекаутом
    if (upd?.pre_checkout_query) {
      await answerPreCheckoutQuery(upd.pre_checkout_query.id, true);
      return res.sendStatus(200);
    }

    const msg = upd?.message || upd?.edited_message;

    // 2) /start (кнопка запуска Mini App + поддержка реферала)
    if (msg?.text?.startsWith("/start")) {
      const user = msg.from;
      const parts = msg.text.trim().split(/\s+/, 2);
      const ref_id = parts.length > 1 ? parts[1] : null;

      const isSelfRef = ref_id && String(ref_id) === String(user.id);
      const search = new URLSearchParams();
      if (ref_id && !isSelfRef) search.set("referrer", ref_id);
      search.set("tgWebAppExpand", "true");

      const url = `${WEBAPP_URL.replace(/\/$/, "")}/?${search.toString()}`;
      const reply_markup = {
        inline_keyboard: [[
          { text: "🚀 Открыть приложение", web_app: { url } }
        ]]
      };

      await sendMessage(
        msg.chat.id,
        `Привет, ${user.first_name || "друг"}! 👋 Нажми кнопку ниже, чтобы открыть приложение.`,
        { reply_markup }
      );

      return res.sendStatus(200);
    }

    // 3) Успешная оплата Stars → зачисляем tickets (1 TON = 1 ticket)
    const sp = msg?.successful_payment;
    if (sp) {
      const telegram_id = msg.from.id;
      const stars_paid  = sp.total_amount; // количество звёзд (целое)
      const tx_id = sp.telegram_payment_charge_id || sp.provider_payment_charge_id;

      // идемпотентность: если транзакция уже есть — выходим
      const { data: exists } = await supabase
        .from("sells")
        .select("id")
        .eq("tx_id", tx_id)
        .maybeSingle();
      if (exists) return res.sendStatus(200);

      const { ton_per_100stars, fee_markup } = await getFx();
      const ton_per_star  = Number(ton_per_100stars) / 100;
      const netMultiplier = 1 - Number(fee_markup);

      // Рассчёт зачисления и округление до 0.1
      const tickets_raw    = Number(stars_paid) * ton_per_star * netMultiplier;
      const tickets_credit = roundDownToStep(tickets_raw, 0.1);

      // Лог в sells
      await supabase.from("sells").insert({
        telegram_id,
        amount_stars: stars_paid,
        amount_ton: tickets_raw,    // «сырое» TON, для аудита
        tickets: tickets_credit,    // зачислено на баланс
        rate_at: ton_per_100stars,
        tx_id,
        status: "paid",
        payload: JSON.stringify({ currency: sp.currency })
      });

      // Зачисляем на баланс пользователя (users.tickets)
      const { data: user } = await supabase
        .from("users")
        .select("id, tickets")
        .eq("telegram_id", telegram_id)
        .maybeSingle();

      if (user) {
        await supabase
          .from("users")
          .update({ tickets: (user.tickets || 0) + tickets_credit })
          .eq("id", user.id);
      } else {
        await supabase
          .from("users")
          .insert({ telegram_id, tickets: tickets_credit });
      }

      // Уведомление пользователю
      await sendMessage(
        msg.chat.id,
        `Оплата получена ✅ Зачислено: ${tickets_credit.toFixed(1)} tickets`
      );

      return res.sendStatus(200);
    }

    // 4) Остальные апдейты игнорируем
    return res.sendStatus(200);
  } catch (err) {
    console.error("Telegram webhook error:", err);
    return res.sendStatus(500);
  }
}
