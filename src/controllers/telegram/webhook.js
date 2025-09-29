// src/controllers/telegram/webhook.js
import fetch from "node-fetch"; // если Node >=18 — можно убрать и использовать global fetch
import { supabase } from "../../supabaseClient.js"; // скорректируй путь к своему клиенту
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// ответ на pre_checkout_query (обязателен для прохождения оплаты)
async function answerPreCheckoutQuery(id, ok = true, error_message) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/answerPreCheckoutQuery`;
  const body = { pre_checkout_query_id: id, ok };
  if (!ok && error_message) body.error_message = error_message;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function roundDownToStep(value, step = 0.1) {
  // округляем ВНИЗ к ближайшему шагу 0.1
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
    // дефолт на всякий
    return { ton_per_100stars: 0.5530, fee_markup: 0.20 };
  }
  return data;
}

export default async function telegramWebhook(req, res) {
  const update = req.body;
  try {
    // 1) Pre-checkout — подтверждаем
    if (update?.pre_checkout_query) {
      await answerPreCheckoutQuery(update.pre_checkout_query.id, true);
      return res.sendStatus(200);
    }

    // 2) Успешная оплата
    const msg = update?.message || update?.edited_message;
    const sp = msg?.successful_payment;
    if (sp) {
      const telegram_id = msg.from.id;
      const stars_paid = sp.total_amount; // для Stars — это целое число звёзд
      const tx_id =
        sp.telegram_payment_charge_id || sp.provider_payment_charge_id;

      // идемпотентность: если такой tx уже есть — выходим
      const { data: exists } = await supabase
        .from("sells")
        .select("id")
        .eq("tx_id", tx_id)
        .maybeSingle();
      if (exists) return res.sendStatus(200);

      // курс + наценка
      const { ton_per_100stars, fee_markup } = await getFx();
      const ton_per_star = Number(ton_per_100stars) / 100;

      // 1 TON = 1 ticket (наценка учитывается)
      const tickets_raw =
        Number(stars_paid) * ton_per_star * (1 - Number(fee_markup));
      const tickets_credit = roundDownToStep(tickets_raw, 0.1); // шаг 0.1

      // найдём/создадим пользователя по telegram_id
      const { data: user } = await supabase
        .from("users")
        .select("id, tickets")
        .eq("telegram_id", telegram_id)
        .maybeSingle();

      // записываем продажу
      await supabase.from("sells").insert({
        telegram_id,
        amount_stars: stars_paid,
        amount_ton: tickets_raw, // можно хранить "сырое" до округления (для аудита)
        tickets: tickets_credit, // зачислено на баланс
        rate_at: ton_per_100stars,
        tx_id,
        status: "paid",
        payload: JSON.stringify({ currency: sp.currency }),
      });

      // зачисляем на баланс tickets (тон внутри приложения)
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

      return res.sendStatus(200);
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error("Telegram webhook error:", err);
    return res.sendStatus(500);
  }
}
