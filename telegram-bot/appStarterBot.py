import os
import time
import telebot
from telebot.types import InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo
from supabase import create_client, Client

# 🔧 Конфигурация
BOT_TOKEN = os.getenv("BOT_TOKEN")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
WEBAPP_URL = os.getenv("WEBAPP_URL", "https://frontend-nine-sigma-49.vercel.app/")

if not BOT_TOKEN:
    raise ValueError("Ошибка: BOT_TOKEN не установлен в переменных окружениях")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError("Ошибка: SUPABASE_URL и SUPABASE_KEY должны быть установлены в переменных окружениях")

# 📦 Инициализация Supabase и бота
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
bot = telebot.TeleBot(BOT_TOKEN)

# 🎉 Команда /start
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

# 🔔 Функция проверки новых розыгрышей
def check_and_notify():
    print("🔍 Проверка розыгрышей на запуск...")

    # Получаем все колёса со статусом completed и notified = false/null
    wheels_query = supabase.table("wheels").select("*").eq("status", "completed").is_("notified", None)
    data = wheels_query.execute()

    if not data.data:
        return

    for wheel in data.data:
        wheel_id = wheel["id"]
        nft_name = wheel.get("nft_name", "ваш приз")
        print(f"📣 Оповещение участников колеса #{wheel_id}")

        # Получаем всех участников этого колеса
        participants_query = supabase.table("wheel_participants").select("telegram_id, username").eq("wheel_id", wheel_id)
        participants = participants_query.execute().data

        for p in participants:
            tg_id = p.get("telegram_id")
            username = p.get("username", "")
            if not tg_id:
                continue

            try:
                bot.send_message(
                    tg_id,
                    f"🎯 {username or 'Игрок'}! Your game for a prize {nft_name} will start in 1 minute!"
                )
                print(f"✅ Сообщение отправлено: {tg_id}")
            except Exception as e:
                print(f"⚠️ Ошибка отправки {tg_id}: {e}")

        # Отмечаем колесо как оповещённое
        supabase.table("wheels").update({"notified": True}).eq("id", wheel_id).execute()
        print(f"✅ Колесо #{wheel_id} отмечено как notified")

if __name__ == "__main__":
    print("🚀 AppStarterBot запущен и ждёт /start")

    # Запуск отдельного потока проверки каждые 10 секунд
    while True:
        try:
            check_and_notify()
        except Exception as e:
            print(f"❌ Ошибка в check_and_notify: {e}")
        time.sleep(10)

    # Основной polling бота
    bot.infinity_polling()
