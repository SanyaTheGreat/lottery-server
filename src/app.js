import express from 'express'
import dotenv from 'dotenv'
import { supabase } from './services/supabaseClient.js'
import usersRouter from './routes/users.js'
import wheelRoutes from './routes/wheel.js'
import express from 'express'
import dotenv from 'dotenv'
import { supabase } from './services/supabaseClient.js'
import usersRouter from './routes/users.js'
import wheelRoutes from './routes/wheel.js'
import cors from 'cors'
import './checkTonTransactions.js' // ← добавили фоновый скрипт
import cors from 'cors'

dotenv.config()
console.log("🔐 ENV LOADED:", process.env.SUPABASE_URL)

const app = express()
const port = 3000

app.use(cors({
  origin: 'https://frontend-nine-sigma-49.vercel.app',
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'PUT', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
}))
app.use(express.json())

app.use('/users', usersRouter)
app.use('/wheel', wheelRoutes)

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
