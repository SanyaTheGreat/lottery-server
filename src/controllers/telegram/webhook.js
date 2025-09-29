// src/controllers/telegram/webhook.js
import { supabase } from "../../services/supabaseClient.js";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Telegram требует ответить на pre_checkout_query
async function answerPreCheckoutQuery(id, ok = true, error_message) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerPreCheckoutQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pre_checkout_query_id: id, ok, error_message }),
  });
}

function roundDownToStep(value, step = 0.1) {
  return Math.floor((Number(value) + 1e-9) / step) * step;
}

async function getFx() {
  const { data } = await supabase
    .from("fx_rates")
    .select("ton_per_100stars, fee_markup")
    .order("id", { ascending: false })
    .limit(1)
    .single();
  return data || { ton_per_100stars: 0.5530, fee_markup: 0.20 };
}

export default async function telegramWebhook(req, res) {
  try {
    const upd = req.body;

    // 1) подтверждаем pre_checkout_query
    if (upd?.pre_checkout_query) {
      await answerPreCheckoutQuery(upd.pre_checkout_query.id, true);
      return res.sendStatus(200);
    }

    // 2) успешная оплата Stars
    const msg = upd?.message || upd?.edited_message;
    const sp = msg?.successful_payment;
    if (sp) {
      const telegram_id = msg.from.id;
      const stars_paid = sp.total_amount; // число звёзд
      const tx_id = sp.telegram_payment_charge_id || sp.provider_payment_charge_id;

      // идемпотентность: если такой tx уже был — просто 200
      const { data: exists } = await supabase
        .from("sells").select("id").eq("tx_id", tx_id).maybeSingle();
      if (exists) return res.sendStatus(200);

      const { ton_per_100stars, fee_markup } = await getFx();
      const ton_per_star = Number(ton_per_100stars) / 100;

      // 1 TON = 1 ticket (учитываем наценку), округляем вниз до 0.1
      const tickets_raw = Number(stars_paid) * ton_per_star * (1 - Number(fee_markup));
      const tickets_credit = roundDownToStep(tickets_raw, 0.1);

      // лог в sells
      await supabase.from("sells").insert({
        telegram_id,
        amount_stars: stars_paid,
        amount_ton: tickets_raw,
        tickets: tickets_credit,
        rate_at: ton_per_100stars,
        tx_id,
        status: "paid",
        payload: JSON.stringify({ currency: sp.currency }),
      });

      // зачисление на баланс (users.tickets)
      const { data: user } = await supabase
        .from("users").select("id, tickets").eq("telegram_id", telegram_id).maybeSingle();

      if (user) {
        await supabase
          .from("users")
          .update({ tickets: (user.tickets || 0) + tickets_credit })
          .eq("id", user.id);
      } else {
        await supabase.from("users").insert({ telegram_id, tickets: tickets_credit });
      }

      return res.sendStatus(200);
    }

    // 3) всё остальное игнорируем (чтобы не мешать старой логике)
    return res.sendStatus(200);
  } catch (e) {
    console.error("Telegram webhook error:", e);
    return res.sendStatus(500);
  }
}
