import os
import time
import threading
import telebot
from telebot.types import InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo
from supabase import create_client, Client
from datetime import datetime, timezone, timedelta  # ← добавлено
import json  # ← добавлено

# --- Конфигурация ---
BOT_TOKEN = os.getenv("BOT_TOKEN")
if not BOT_TOKEN:
    raise ValueError("Ошибка: BOT_TOKEN не установлен в переменных окружениях")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError("Ошибка: SUPABASE_URL и SUPABASE_KEY должны быть установлены в переменных окружениях")

WEBAPP_URL = os.getenv("WEBAPP_URL", "https://frontend-nine-sigma-49.vercel.app/")
FREE_SPIN_CHECK_SEC = int(os.getenv("FREE_SPIN_CHECK_SEC", "900"))  # ← интервал проверки фриспина (по умолчанию 15 минут)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
bot = telebot.TeleBot(BOT_TOKEN)

# --- Команда /start ---
@bot.message_handler(commands=['start'])
def send_welcome(message):
    user = message.from_user
    args = message.text.split()
    ref_id = args[1] if len(args) > 1 else None

    print(f"🟢 /start от {user.id} ({user.username}) | ref_id: {ref_id}")

    url = WEBAPP_URL
    if ref_id and str(user.id) != str(ref_id):
        url += f"?referrer={ref_id}&tgWebAppExpand=true"
    else:
        url += "?tgWebAppExpand=true"

    keyboard = InlineKeyboardMarkup()
    keyboard.add(
        InlineKeyboardButton(
            "🚀 Открыть приложение",
            web_app=WebAppInfo(url=url)
        )
    )

    bot.send_message(
        message.chat.id,
        f"Привет, {user.first_name or 'друг'}! 👋\nЗапусти Mini App по кнопке ниже:",
        reply_markup=keyboard
    )

# --- Фоновый поток: оповещения (как было) ---
def notify_users_loop():
    while True:
        try:
            # Получаем колёса, которые скоро начнутся, но ещё не были уведомлены
            response = supabase.table('wheels').select('*') \
                .eq('status', 'completed').eq('notified', False).execute()

            wheels = response.data if response.data else []

            for wheel in wheels:
                wheel_id = wheel['id']
                nft_name = wheel.get('nft_name', 'prize')

                # Получаем всех участников этого колеса
                participants_response = supabase.table('wheel_participants') \
                    .select('telegram_id, username') \
                    .eq('wheel_id', wheel_id).execute()

                participants = participants_response.data if participants_response.data else []

                for user in participants:
                    telegram_id = user['telegram_id']
                    username = user.get('username', 'Player')

                    try:
                        keyboard = InlineKeyboardMarkup()
                        keyboard.add(
                            InlineKeyboardButton(
                                "🎯 Перейти к розыгрышу",
                                web_app=WebAppInfo(url=f"{WEBAPP_URL}/wheel/{wheel_id}?tgWebAppExpand=true")
                            )
                        )

                        bot.send_message(
                            telegram_id,
                            f"{username}! Your game for a prize {nft_name} will start in 1 minute! 🎁",
                            reply_markup=keyboard
                        )
                        print(f"🔔 Уведомление отправлено пользователю {telegram_id}")
                    except Exception as e:
                        print(f"⚠️ Ошибка при отправке {telegram_id}: {e}")

                # Помечаем, что уведомления отправлены
                supabase.table('wheels').update({'notified': True}).eq('id', wheel_id).execute()

        except Exception as e:
            print("❌ Ошибка в потоке уведомлений:", e)

        time.sleep(10)  # Проверка каждые 10 секунд

# === ↓↓↓ НОВЫЙ БЛОК: бесплатный спин (фоновый поток) ↓↓↓ ===

def _utcnow():
    return datetime.now(timezone.utc)

def _parse_ts(v):
    if not v:
        return None
    try:
        return datetime.fromisoformat(str(v).replace("Z", "+00:00")).astimezone(timezone.utc)
    except Exception:
        return None

def _get_cheapest_case_id():
    # самый дешёвый активный кейс (под бесплатный спин)
    res = supabase.table("cases") \
        .select("id, price, is_active") \
        .eq("is_active", True) \
        .order("price", ascending=True) \
        .limit(1) \
        .execute()
    rows = res.data or []
    return rows[0]["id"] if rows else None

def _get_depositors_tids():
    # все пользователи, у кого есть пополнения (sells)
    res = supabase.table("sells").select("telegram_id").execute()
    ids = [r["telegram_id"] for r in (res.data or []) if r.get("telegram_id")]
    return list({int(x) for x in ids})

def _load_users_by_tids(tids):
    users = []
    for i in range(0, len(tids), 100):
        batch = tids[i:i+100]
        q = supabase.table("users").select(
            "id, telegram_id, username, free_spin_last_at, free_spin_last_notified_at"
        ).in_("telegram_id", batch).execute()
        users.extend(q.data or [])
    return users

def _eligible_free(users):
    # кандидаты на уведомление: есть депозит + (никогда не крутил или прошло 24ч) + ещё не уведомляли после наступления права
    out, now = [], _utcnow()
    day = timedelta(hours=24)
    for u in users:
        last = _parse_ts(u.get("free_spin_last_at"))
        notified = _parse_ts(u.get("free_spin_last_notified_at"))
        has_right = (last is None) or (now >= (last + day))
        # уведомляем 1 раз на цикл, пока снова не будет free_spin_last_at + 24ч
        edge = (last or datetime(1970, 1, 1, tzinfo=timezone.utc)) + day
        not_notified_yet = (notified is None) or (notified < edge)
        if has_right and not_notified_yet:
            out.append(u)
    return out

def _build_free_markup(case_id: str):
    # кнопка, открывающая mini-app на нужном кейсе
    url = f"{WEBAPP_URL}?tgWebAppExpand=true&open_case={case_id}"
    kb = InlineKeyboardMarkup()
    kb.add(InlineKeyboardButton("🎁 Крутить бесплатно", web_app=WebAppInfo(url=url)))
    return kb

def _mark_free_notified(user_id: str):
    supabase.table("users").update({
        "free_spin_last_notified_at": _utcnow().isoformat()
    }).eq("id", user_id).execute()

def notify_free_spin_loop():
    print("[free-spin] notifier started (interval:", FREE_SPIN_CHECK_SEC, "sec)")
    while True:
        try:
            # 1) выясняем самый дешёвый активный кейс
            case_id = _get_cheapest_case_id()
            if not case_id:
                time.sleep(FREE_SPIN_CHECK_SEC)
                continue

            # 2) у кого были пополнения
            tids = _get_depositors_tids()
            if not tids:
                time.sleep(FREE_SPIN_CHECK_SEC)
                continue

            # 3) подгружаем пользователей и фильтруем по условию фриспина
            users = _load_users_by_tids(tids)
            cand = _eligible_free(users)

            if cand:
                print(f"[free-spin] candidates: {len(cand)}")

            # 4) отправляем уведомления
            for u in cand:
                try:
                    kb = _build_free_markup(case_id)
                    bot.send_message(
                        u["telegram_id"],
                        "🎁 Доступен бесплатный спин! Испытай удачу прямо сейчас.",
                        reply_markup=kb
                    )
                    _mark_free_notified(u["id"])
                    print("[free-spin] sent →", u["telegram_id"])
                except Exception as e:
                    print("[free-spin] send fail:", u["telegram_id"], e)

        except Exception as e:
            print("[free-spin] tick fail:", e)

        time.sleep(FREE_SPIN_CHECK_SEC)

# === ↑↑↑ КОНЕЦ НОВОГО БЛОКА ↑↑↑ ===

# --- Запуск фоновых потоков и бота ---
if __name__ == "__main__":
    print("🚀 AppStarterBot запущен и ждёт /start")

    # Поток уведомлений по колёсам (твой существующий)
    threading.Thread(target=notify_users_loop, daemon=True).start()

    # Поток уведомлений о бесплатном спине (новый)
    threading.Thread(target=notify_free_spin_loop, daemon=True).start()

    # Основной цикл бота
    bot.infinity_polling()
