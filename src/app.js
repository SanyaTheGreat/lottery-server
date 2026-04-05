import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { verifyTelegramWebApp } from './utils/verifyTelegramWebApp.js';
import { requireJwt } from './middleware/requireJwt.js';
import { supabase } from './services/supabaseClient.js';

// --- роуты ---
import usersRouter from './routes/users.js';
import wheelRoutes from './routes/wheel.js';
import giftsRoutes from './routes/gifts.js';
import paymentsRoutes from './routes/payments.js';
import casesRoutes from "./routes/casesRoutes.js";
import caseChanceRoutes from "./routes/caseChanceRoutes.js";
import caseSpinRoutes from "./routes/caseSpinRoutes.js";
import inventoryRoutes from "./routes/inventoryRoutes.js";
import slotsRoutes from "./routes/slots.js";           // ✅ новые
import slotAdminRoutes from "./routes/slotAdmin.js";   // ✅ новые
import game2048Routes from "./routes/game2048.js";
import game2048LeaderboardRoutes from "./routes/game2048Leaderboard.js";
import telegramPaymentsWebhook from "./routes/telegramPaymentsWebhook.js";


// --- фоновые задачи ---
import './checkTonTransactions.js';
import './scheduler/autoDraw.js';
import './scheduler/notifier.js';
import './scheduler/msg-notifier.js';
import "./scheduler/freeSpinNotifier.js";

// ✅ 2048: авто-завершение активных игр по окончанию weekly периода
import "./scheduler/game2048Finalizer.js";

// 👉 Telegram Stars webhook
import telegramWebhook from './controllers/telegram/webhook.js';

console.log("🔐 ENV LOADED:", process.env.SUPABASE_URL);

const app = express();
const port = 3000;

// --- базовая настройка CORS ---
const allowedOrigins = [
  'https://frontend-nine-sigma-49.vercel.app',
  'https://t.me',
  'http://localhost:5173',
  'http://localhost:3000',
];

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    if (/^https:\/\/.*\.vercel\.app$/.test(origin)) {
      return callback(null, true);
    }

    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'PUT', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-gem-key'],
  credentials: true,
}));

app.options(/.*/, cors());

app.use(express.json());

// --- публичные эндпоинты ---

// Telegram webhook (публичный)
app.post('/tg/webhook', telegramWebhook);

// Авторизация через Telegram WebApp
app.post('/auth/telegram', async (req, res) => {
  try {
    const { initData } = req.body || {};
    const v = verifyTelegramWebApp(initData, process.env.BOT_TOKEN, 86400);
    if (!v.ok) return res.status(403).json({ ok: false, error: v.reason });

    const u = v.user;

    // 🔹 нормализуем рефку и отсекаем самореферал
    const refRaw = req.query?.ref;
    const refNum = refRaw ? Number(refRaw) : null;
    const isSelfRef = refNum && refNum === Number(u.id);

    // 🔹 проверяем, существует ли пользователь (читаем referred_by)
    const { data: existing, error: existingErr } = await supabase
      .from('users')
      .select('id, telegram_id, referred_by')
      .eq('telegram_id', Number(u.id))
      .maybeSingle();

    if (existingErr) {
      console.error('❌ existing check error:', existingErr.message);
      return res.status(500).json({ ok: false, error: 'Database check failed' });
    }

    // 🔹 если новый пользователь и есть валидная рефка — найдём реферера по telegram_id
    let referred_by = null;
    if (!existing && refNum && !isSelfRef) {
      const { data: refUser, error: refErr } = await supabase
        .from('users')
        .select('id')
        .eq('telegram_id', refNum)
        .maybeSingle();
      if (refErr) {
        console.error('❌ ref lookup error:', refErr.message);
      } else if (refUser) {
        referred_by = refUser.id; // UUID реферера
      }
    }

    // 🔹 формируем payload (реферал только при первом создании)
    const payload = {
      telegram_id: Number(u.id),
      username: u.username ?? null,
      avatar_url: u.photo_url ?? null,
      updated_at: new Date().toISOString(),
      ...(referred_by && { referred_by }),
    };

    // upsert пользователя
    const { data, error } = await supabase
      .from('users')
      .upsert(payload, { onConflict: 'telegram_id' })
      .select()
      .single();

    if (error) {
      console.error("❌ Ошибка upsert:", error.message);
      return res.status(500).json({ ok: false, error: 'Insert/update failed' });
    }

    // 🔹 доп. шаг: если пользователь существовал, у него пустой referred_by и есть валидная рефка — допишем один раз
    if (existing && !existing.referred_by && refNum && !isSelfRef) {
      const { data: refUser2, error: refErr2 } = await supabase
        .from('users')
        .select('id')
        .eq('telegram_id', refNum)
        .maybeSingle();

      if (refErr2) {
        console.error('❌ ref lookup2 error:', refErr2.message);
      } else if (refUser2) {
        const { error: updErr } = await supabase
          .from('users')
          .update({ referred_by: refUser2.id })
          .eq('telegram_id', Number(u.id))
          .is('referred_by', null); // важный гард — не перезаписывать

        if (updErr) {
          console.error('❌ attach referral update error:', updErr.message);
        }
      }
    }

    // JWT
    const token = jwt.sign(
      { telegram_id: Number(u.id), username: u.username ?? null },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    console.log(
      `✅ User ${u.username || u.id} авторизован` +
      (referred_by ? ` (ref from ${refNum})` : '') +
      (existing && !existing.referred_by && refNum && !isSelfRef ? ' [+attempt attach existing]' : '')
    );

    return res.json({ ok: true, token, user: data });
  } catch (err) {
    console.error("❌ Ошибка /auth/telegram:", err);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// --- приватная зона (требует JWT) ---
app.use(['/wheel', '/payments', '/inventory', '/users', '/gifts', '/game', '/game2048'], requireJwt());

// --- Роуты API ---
app.use('/users', usersRouter);
app.use('/wheel', wheelRoutes);
app.use('/', giftsRoutes);
app.use('/payments', paymentsRoutes);
app.use("/api", casesRoutes);
app.use("/api", caseChanceRoutes);
app.use("/api", caseSpinRoutes);
app.use("/api", inventoryRoutes);
app.use("/game", game2048Routes);
app.use("/game2048", game2048LeaderboardRoutes);
app.use("/telegram/payments", telegramPaymentsWebhook);


// ✅ новые роуты слотов
app.use("/api", slotsRoutes);
app.use("/api", slotAdminRoutes);

// --- тестовый эндпоинт ---
app.get('/', async (req, res) => {
  const { data, error } = await supabase.from('users').select('*').limit(5);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});

// 👉 Временная отладка Supabase
fetch("https://djpcftyqkwucbksknsdu.supabase.co/rest/v1/users", {
  method: "GET",
  headers: {
    "apikey": process.env.SUPABASE_KEY,
    "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
  }
})
  .then(res => res.json())
  .then(data => console.log("✅ Raw fetch success:", data))
  .catch(err => console.error("❌ Raw fetch error:", err));