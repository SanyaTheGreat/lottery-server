// src/scheduler/freeSpinNotifier.js
import { supabase } from "../services/supabaseClient.js";

const ENABLED = process.env.FREE_SPIN_NOTIFICATIONS_ENABLED === 'true' && process.env.LUDO_ENABLED === 'true';

const BOT_TOKEN  = process.env.BOT_TOKEN; // тот же токен бота
const WEBAPP_URL = (process.env.WEBAPP_URL || "https://frontend-nine-sigma-49.vercel.app").replace(/\/$/, "");
const INTERVAL_MS = Number(process.env.FREE_SPIN_INTERVAL_MS || 900_000); // по умолчанию 15 мин

if (!BOT_TOKEN) {
  console.error("[free-spin] TELEGRAM_BOT_TOKEN is missing");
}

// --- helpers ---
async function tg(method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`TG ${res.status}: ${text}`);
  }
  return res.json();
}

async function sendMessage(chat_id, text, reply_markup) {
  return tg("sendMessage", { chat_id, text, reply_markup, disable_web_page_preview: true });
}

function parseTs(v) {
  if (!v) return null;
  const t = new Date(v);
  return Number.isNaN(t.getTime()) ? null : t;
}

// самый дешёвый активный кейс
async function getCheapestCaseId() {
  const { data, error } = await supabase
    .from("cases")
    .select("id, price, is_active")
    .eq("is_active", true)
    .order("price", { ascending: true })
    .limit(1);
  if (error) throw error;
  return data?.[0]?.id || null;
}

// пользователи с пополнениями
async function getDepositorTgIds() {
  const { data, error } = await supabase.from("sells").select("telegram_id");
  if (error) throw error;
  return [...new Set((data || []).map(r => Number(r.telegram_id)).filter(Boolean))];
}

async function loadUsersByTgIds(tgIds) {
  const batchSize = 100;
  const out = [];
  for (let i = 0; i < tgIds.length; i += batchSize) {
    const batch = tgIds.slice(i, i + batchSize);
    const { data, error } = await supabase
      .from("users")
      .select("id, telegram_id, username, free_spin_last_at, free_spin_last_notified_at")
      .in("telegram_id", batch);
    if (error) throw error;
    out.push(...(data || []));
  }
  return out;
}

function pickEligible(users) {
  const now = Date.now();
  const day = 24 * 3600 * 1000;
  return users.filter(u => {
    const last = parseTs(u.free_spin_last_at)?.getTime() ?? null;
    const notified = parseTs(u.free_spin_last_notified_at)?.getTime() ?? null;
    const hasRight = !last || now >= last + day;           // право на фриспин появилось
    const edge = (last ?? 0) + day;                         // момент появления права
    const notNotifiedYet = !notified || notified < edge;    // ещё не уведомляли после появления права
    return hasRight && notNotifiedYet;
  });
}

function buildReplyMarkup(caseId) {
  const url = `${WEBAPP_URL}?tgWebAppExpand=true&open_case=${caseId}`;
  return { inline_keyboard: [[{ text: "🎁 Крутить бесплатно", web_app: { url } }]] };
}

async function markNotified(userId) {
  const { error } = await supabase
    .from("users")
    .update({ free_spin_last_notified_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) throw error;
}

async function runOnce() {
  try {
    if (!ENABLED || !BOT_TOKEN) return;

    const caseId = await getCheapestCaseId();
    if (!caseId) return;

    const tgIds = await getDepositorTgIds();
    if (!tgIds.length) return;

    const users = await loadUsersByTgIds(tgIds);
    const cand = pickEligible(users);
    if (!cand.length) return;

    for (const u of cand) {
      try {
        await sendMessage(
          u.telegram_id,
          "🎁 Доступен бесплатный спин! Испытай удачу прямо сейчас.",
          buildReplyMarkup(caseId)
        );
        await markNotified(u.id);
        console.log("[free-spin] sent →", u.telegram_id);
        await new Promise(r => setTimeout(r, 150)); // бережём rate limit
      } catch (e) {
        console.warn("[free-spin] send fail", u.telegram_id, e?.message || e);
      }
    }
  } catch (e) {
    console.error("[free-spin] tick error", e?.message || e);
  }
}

if (ENABLED) {
  console.log('freeSpinNotifier started');
  setInterval(runOnce, INTERVAL_MS);
  runOnce();
}
