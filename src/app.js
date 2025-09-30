import dotenv from 'dotenv'
dotenv.config()

import express from 'express'
import cors from 'cors'

import { supabase } from './services/supabaseClient.js'
import usersRouter from './routes/users.js'
import wheelRoutes from './routes/wheel.js'
import giftsRoutes from './routes/gifts.js'

// фоновые задачи
import './checkTonTransactions.js'   // сканер TON
import './scheduler/autoDraw.js'
import './scheduler/notifier.js';


// 👉 Telegram Stars webhook
import telegramWebhook from './controllers/telegram/webhook.js'

console.log("🔐 ENV LOADED:", process.env.SUPABASE_URL)

const app = express()
const port = 3000

app.use(cors({
  origin: 'https://frontend-nine-sigma-49.vercel.app',
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'PUT', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
}))

// важно для приёма JSON от Telegram
app.use(express.json())

// --- Роуты API ---
app.use('/users', usersRouter)
app.use('/wheel', wheelRoutes)
app.use('/', giftsRoutes)

// --- Telegram webhook ---
// Telegram будет слать POST запросы сюда
app.post('/tg/webhook', telegramWebhook)

// тестовый корневой эндпоинт
app.get('/', async (req, res) => {
  const { data, error } = await supabase.from('users').select('*').limit(5)
  if (error) {
    return res.status(500).json({ error: error.message })
  }
  res.json(data)
})

app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`)
})


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
  console.log("✅ Raw fetch success:", data)
})
.catch(err => {
  console.error("❌ Raw fetch error:", err)
})
