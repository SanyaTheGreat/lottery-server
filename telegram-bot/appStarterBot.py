import os
import time
import telebot
from telebot.types import InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo
from supabase import create_client, Client

# Получение переменных окружения
BOT_TOKEN = os.getenv("BOT_TOKEN")
if not BOT_TOKEN:
    raise ValueError("Ошибка: BOT_TOKEN не установлен в переменных окружениях")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError("Ошибка: SUPABASE_URL и SUPABASE_KEY должны быть установлены в переменных окружениях")

WEBAPP_URL = os.getenv("WEBAPP_URL", "https://frontend-nine-sigma-49.vercel.app/")

# Инициализация клиентов
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
bot = telebot.TeleBot(BOT_TOKEN)

# Обработка /start
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

# Отправка уведомлений о запуске розыгрыша
def notify_upcoming_wheels():
    try:
        response = supabase.table("wheels") \
            .select("id, nft_name") \
            .eq("status", "completed") \
            .eq("notified", False) \
            .execute()
        
        wheels = response.data

        for wheel in wheels:
            wheel_id = wheel["id"]
            nft_name = wheel.get("nft_name", "your prize")

            # Получаем победителя по этому розыгрышу
            result_res = supabase.table("wheel_results") \
                .select("username, telegram_id") \
                .eq("wheel_id", wheel_id) \
                .execute()

            if not result_res.data:
                continue

            winner = result_res.data[0]
            username = winner.get("username", "User")
            telegram_id = winner.get("telegram_id")

            if telegram_id:
                try:
                    bot.send_message(
                        telegram_id,
                        f"{username}! Your game for a prize {nft_name} will start in 1 minute! 🎉"
                    )
                except Exception as e:
                    print(f"Ошибка отправки уведомления пользователю {telegram_id}: {e}")

            # Обновляем поле notified = true
            supabase.table("wheels").update({"notified": True}).eq("id", wheel_id).execute()

    except Exception as e:
        print(f"Ошибка при отправке уведомлений: {e}")

# Основной запуск
if __name__ == "__main__":
    print("🚀 AppStarterBot запущен и ждёт /start")

    # Запускаем проверку каждые 10 секунд в фоне
    import threading

    def poll_notifications():
        while True:
            notify_upcoming_wheels()
            time.sleep(10)

    threading.Thread(target=poll_notifications, daemon=True).start()

    bot.infinity_polling()
