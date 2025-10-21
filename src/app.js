import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { verifyTelegramWebApp } from './utils/verifyTelegramWebApp.js';
import { requireJwt } from './middleware/requireJwt.js';
import { supabase } from './services/supabaseClient.js';

import usersRouter from './routes/users.js';
import wheelRoutes from './routes/wheel.js';
import giftsRoutes from './routes/gifts.js';
import paymentsRoutes from './routes/payments.js';
import casesRoutes from "./routes/casesRoutes.js";
import caseChanceRoutes from "./routes/caseChanceRoutes.js";
import caseSpinRoutes from "./routes/caseSpinRoutes.js";
import inventoryRoutes from "./routes/inventoryRoutes.js";

// --- фоновые задачи ---
import './checkTonTransactions.js';   // сканер TON
import './scheduler/autoDraw.js';
import './scheduler/notifier.js';
import './scheduler/msg-notifier.js';
import "./scheduler/freeSpinNotifier.js";

// 👉 Telegram Stars webhook
import telegramWebhook from './controllers/telegram/webhook.js';

console.log("🔐 ENV LOADED:", process.env.SUPABASE_URL);

const app = express();
const port = 3000;

app.use(cors({
  origin: [
    'https://frontend-nine-sigma-49.vercel.app',
    'https://t.me'
  ],
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'PUT', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'], // ✅ добавлено Authorization
  credentials: true,
}));

// важно для приёма JSON от Telegram
app.use(express.json());

// --- публичные эндпоинты ---

// Telegram webhook (оставляем публичным)
app.post('/tg/webhook', telegramWebhook);

app.post('/auth/telegram', async (req, res) => {
  try {
    const { initData } = req.body || {};
    const v = verifyTelegramWebApp(initData, process.env.BOT_TOKEN, 86400);
    if (!v.ok) return res.status(403).json({ ok: false, error: v.reason });

    const u = v.user; // объект из Telegram initData

    // 🧩 берём только нужное
    const payload = {
      telegram_id: Number(u.id),
      username: u.username ?? null,
      avatar_url: u.photo_url ?? null,
      updated_at: new Date().toISOString(),
    };

    // 🔹 апсерт (создаёт или обновляет по telegram_id)
    const { data, error } = await supabase
      .from('users')
      .upsert(payload, { onConflict: 'telegram_id' })
      .select()
      .single();

    if (error) {
      console.error("❌ Ошибка upsert:", error.message);
      return res.status(500).json({ ok: false, error: 'Insert/update failed' });
    }

    // 🔐 создаём JWT (24 часа)
    const token = jwt.sign(
      { telegram_id: payload.telegram_id, username: payload.username },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    console.log(`✅ User ${payload.username || payload.telegram_id} авторизован`);
    return res.json({ ok: true, token, user: data });
  } catch (err) {
    console.error("❌ Ошибка /auth/telegram:", err);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
});


// --- приватная зона (требует JWT) ---
app.use(['/wheel', '/payments', '/api', '/inventory', '/users', '/gifts'], requireJwt());

// --- Роуты API ---
app.use('/users', usersRouter);
app.use('/wheel', wheelRoutes);
app.use('/', giftsRoutes);
app.use('/payments', paymentsRoutes);
app.use("/api", casesRoutes);
app.use("/api", caseChanceRoutes);
app.use("/api", caseSpinRoutes);
app.use("/api", inventoryRoutes);

// --- тестовый корневой эндпоинт ---
app.get('/', async (req, res) => {
  const { data, error } = await supabase.from('users').select('*').limit(5);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});

// 👉 Временная отладка Supabase запроса
fetch("https://djpcftyqkwucbksknsdu.supabase.co/rest/v1/users", {
  method: "GET",
  headers: {
    "apikey": process.env.SUPABASE_KEY,
    "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
  }
})
  .then(res => res.json())
  .then(data => {
    console.log("✅ Raw fetch success:", data);
  })
  .catch(err => {
    console.error("❌ Raw fetch error:", err);
  });
