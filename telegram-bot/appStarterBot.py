import os
import time
import threading
import telebot
from telebot.types import InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo
from supabase import create_client, Client

# --- Конфигурация ---
BOT_TOKEN = os.getenv("BOT_TOKEN")
if not BOT_TOKEN:
    raise ValueError("Ошибка: BOT_TOKEN не установлен в переменных окружениях")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError("Ошибка: SUPABASE_URL и SUPABASE_KEY должны быть установлены в переменных окружениях")

WEBAPP_URL = os.getenv("WEBAPP_URL", "https://frontend-nine-sigma-49.vercel.app/")

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

# --- Фоновый поток: оповещения ---
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
                                url=f"{WEBAPP_URL}/wheel/{wheel_id}"
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

# --- Запуск фонового потока и бота ---
if __name__ == "__main__":
    print("🚀 AppStarterBot запущен и ждёт /start")

    # Запуск потока уведомлений
    threading.Thread(target=notify_users_loop, daemon=True).start()

    # Запуск основного цикла бота
    bot.infinity_polling()
