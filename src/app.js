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

// --- фоновые задачи ---
import './checkTonTransactions.js';
import './scheduler/autoDraw.js';
import './scheduler/notifier.js';
import './scheduler/msg-notifier.js';
import "./scheduler/freeSpinNotifier.js";

// 👉 Telegram Stars webhook
import telegramWebhook from './controllers/telegram/webhook.js';

console.log("🔐 ENV LOADED:", process.env.SUPABASE_URL);

const app = express();
const port = 3000;

// --- базовая настройка CORS ---
app.use(cors({
  origin: [
    'https://frontend-nine-sigma-49.vercel.app',
    'https://t.me'
  ],
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'PUT', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-gem-key'],
  credentials: true,
}));

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

    // 🆕 Получаем возможного реферала из query
    const ref = req.query?.ref;
    let referred_by = null;

    // 🆕 Проверяем, существует ли пользователь
    const { data: existing } = await supabase
      .from('users')
      .select('id, telegram_id')
      .eq('telegram_id', Number(u.id))
      .maybeSingle();

    // 🆕 Если новый пользователь и есть рефка — ищем реферера
    if (!existing && ref) {
      const { data: refUser } = await supabase
        .from('users')
        .select('id')
        .eq('telegram_id', ref)
        .maybeSingle();
      if (refUser) referred_by = refUser.id; // записываем UUID реферера
    }

    // 🆕 Формируем payload
    const payload = {
      telegram_id: Number(u.id),
      username: u.username ?? null,
      avatar_url: u.photo_url ?? null,
      updated_at: new Date().toISOString(),
      ...(referred_by && { referred_by }), // добавляем если нашли
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

    // JWT
    const token = jwt.sign(
      { telegram_id: payload.telegram_id, username: payload.username },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    console.log(`✅ User ${payload.username || payload.telegram_id} авторизован${referred_by ? ` (ref from ${ref})` : ''}`);
    return res.json({ ok: true, token, user: data });
  } catch (err) {
    console.error("❌ Ошибка /auth/telegram:", err);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// --- приватная зона (требует JWT) ---
app.use(['/wheel', '/payments', '/inventory', '/users', '/gifts'], requireJwt());

// --- Роуты API ---
app.use('/users', usersRouter);
app.use('/wheel', wheelRoutes);
app.use('/', giftsRoutes);
app.use('/payments', paymentsRoutes);
app.use("/api", casesRoutes);
app.use("/api", caseChanceRoutes);
app.use("/api", caseSpinRoutes);
app.use("/api", inventoryRoutes);

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
