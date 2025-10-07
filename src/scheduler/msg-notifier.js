// backend/scheduler/msg-notifier.js
import { supabase } from '../services/supabaseClient.js';

// токен бота — только из ENV (безопасность)
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
// адрес фронта (на Mini App), можно оставить дефолт
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://frontend-nine-sigma-49.vercel.app';

// ЖЁСТКИЕ НАСТРОЙКИ (без ENV)
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 час
const RATE_DELAY_MS = 60;                 // 60 мс между сообщениями (~16–17 msg/sec)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tg = (method, payload) =>
  fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => r.json());

const sendMessage = (chat_id, text, reply_markup) =>
  tg('sendMessage', { chat_id, text, reply_markup });

async function notifyFreeWheel(wheel) {
  const wheelId = wheel.id;
  const nftName = wheel.nft_name || 'подарок';

  // получатели: все пользователи с telegram_id
  const { data: users, error: usersErr } = await supabase
    .from('users')
    .select('telegram_id, username')
    .not('telegram_id', 'is', null);

  if (usersErr) {
    console.error('[msg-notifier] users query error:', usersErr);
    return false;
  }

  // текст и кнопка web_app -> прямо в лобби Mini App
  const text =
    `Привет! Тебе доступен бесплатный розыгрыш 🎁\n` +
    `Подарок: ${nftName}\n` +
    `Жми «Принять участие» ниже`;

  const reply_markup = {
    inline_keyboard: [[
      { text: 'Принять участие', web_app: { url: `${WEBAPP_URL.replace(/\/$/, '')}/lobby/${wheelId}` } }
    ]],
  };

  let sent = 0, failed = 0;

  for (const u of users || []) {
    try {
      const j = await sendMessage(u.telegram_id, text, reply_markup);
      if (j?.ok) sent++;
      else failed++; // 403/400 и т.п. — пользователь не разрешил, идём дальше
    } catch {
      failed++;
    }
    await sleep(RATE_DELAY_MS);
  }

  // помечаем колесо как разосланное, чтобы не дублировать
  const { error: updErr } = await supabase
    .from('wheels')
    .update({ broadcast_free_sent: true })
    .eq('id', wheelId);

  if (updErr) {
    console.error('[msg-notifier] mark broadcast_free_sent error:', updErr);
    return false;
  }

  console.log(`🔔 free broadcast for wheel ${wheelId}: sent=${sent}, failed=${failed}`);
  return true;
}

async function tick() {
  if (!BOT_TOKEN) {
    console.error('[msg-notifier] TELEGRAM_BOT_TOKEN is not set');
    return;
  }
  try {
    // бесплатные + по подписке + ещё не разосланные
    const { data: wheels, error } = await supabase
      .from('wheels')
      .select('id, nft_name, price, mode, broadcast_free_sent')
      .eq('mode', 'subscription')
      .eq('price', 0)
      .eq('msg', 'yes') 
      .eq('broadcast_free_sent', false)
      .order('id', { ascending: true })
      .limit(5);

    if (error) {
      console.error('[msg-notifier] wheels query error:', error);
      return;
    }

    for (const w of wheels || []) {
      await notifyFreeWheel(w);
    }
  } catch (e) {
    console.error('[msg-notifier] tick error:', e);
  }
}

// 🔁 автозапуск при импорте (как у твоих остальных фоновых задач)
if (!global.__MSG_NOTIFIER_STARTED__) {
  global.__MSG_NOTIFIER_STARTED__ = true;
  console.log(`⏰ msg-notifier: started | interval=${CHECK_INTERVAL_MS}ms, rateDelay=${RATE_DELAY_MS}ms`);
  tick(); // первый прогон сразу
  setInterval(tick, CHECK_INTERVAL_MS); // далее раз в час
}
