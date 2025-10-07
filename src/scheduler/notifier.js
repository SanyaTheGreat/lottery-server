// src/scheduler/notifier.js
import { supabase } from "../services/supabaseClient.js";

const BOT_TOKEN  = process.env.TELEGRAM_BOT_TOKEN; // тот же токен бота
const WEBAPP_URL = process.env.WEBAPP_URL || "https://frontend-nine-sigma-49.vercel.app";
const INTERVAL_MS = 10_000; // как и в Python-версии: проверка каждые 10 сек

async function tg(method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

async function sendMessage(chat_id, text, reply_markup) {
  return tg("sendMessage", { chat_id, text, reply_markup });
}

async function notifyWheel(wheel) {
  const wheel_id = wheel.id;
  const nft_name = wheel.nft_name || "prize";

  // получаем участников
  const { data: participants, error: pErr } = await supabase
    .from("wheel_participants")
    .select("telegram_id, username")
    .eq("wheel_id", wheel_id);

  if (pErr) {
    console.error("notify: participants query error:", pErr);
    return false;
  }

  const url = `${WEBAPP_URL.replace(/\/$/, "")}/wheel/${wheel_id}?tgWebAppExpand=true`;
  const reply_markup = {
    inline_keyboard: [[
      { text: "🎯 Перейти к розыгрышу", web_app: { url } }
    ]]
  };

  // рассылаем
  for (const user of participants || []) {
    const chatId = user.telegram_id;
    const username = user.username || "Player";
    try {
      await sendMessage(
        chatId,
        `${username}! Твой розыгрыш на ${nft_name} скоро начнется! Не забудь написать @fightforgift для получения подарка. `,
        reply_markup
      );
      // небольшая пауза, чтобы не упереться в лимиты
      await new Promise(r => setTimeout(r, 150));
    } catch (e) {
      console.error(`notify: send to ${chatId} failed:`, e);
    }
  }

  // помечаем как уведомлённые
  const { error: uErr } = await supabase
    .from("wheels")
    .update({ notified: true })
    .eq("id", wheel_id);

  if (uErr) {
    console.error("notify: mark notified error:", uErr);
    return false;
  }

  console.log(`🔔 notified wheel ${wheel_id} (${nft_name}), users: ${(participants || []).length}`);
  return true;
}

async function tick() {
  try {
    // выбираем готовые колёса, по которым ещё не отправляли уведомление
    const { data: wheels, error } = await supabase
      .from("wheels")
      .select("id, nft_name")
      .eq("status", "completed")
      .eq("notified", false)
      .limit(50); // на всякий

    if (error) {
      console.error("notify: wheels query error:", error);
      return;
    }

    for (const wheel of wheels || []) {
      await notifyWheel(wheel);
    }
  } catch (e) {
    console.error("notify: tick error:", e);
  }
}

// запускаем цикл
console.log("⏰ notifier started (Telegram notifications for completed wheels)");
setInterval(tick, INTERVAL_MS);
