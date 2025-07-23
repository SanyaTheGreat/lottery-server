import os
import telebot
from telebot.types import InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo
from supabase import create_client, Client

# 🔐 Получаем токен Telegram-бота из переменных окружения
BOT_TOKEN = os.getenv("BOT_TOKEN")
if not BOT_TOKEN:
    raise ValueError("Ошибка: BOT_TOKEN не установлен в переменных окружения")

# ✅ Получаем конфиг Supabase из переменных окружения
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError("Ошибка: SUPABASE_URL и SUPABASE_KEY должны быть установлены в переменных окружения")

# 🌐 Ссылка на Mini App (frontend на Vercel)
WEBAPP_URL = os.getenv("WEBAPP_URL", "https://frontend-nine-sigma-49.vercel.app/")

# Инициализация клиента Supabase и бота
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
bot = telebot.TeleBot(BOT_TOKEN)

@bot.message_handler(commands=['start'])
def send_welcome(message):
    user = message.from_user
    args = message.text.split()
    ref_id = args[1] if len(args) > 1 else None

    print(f"🟢 /start от {user.id} ({user.username}) | ref_id: {ref_id}")

    # 🎯 Если передан ref_id и он не равен себе, добавляем в pending_referrals
    if ref_id and str(user.id) != str(ref_id):
        try:
            # Добавляем или обновляем запись в pending_referrals
            supabase.from_('pending_referrals').upsert({
                'referred_id': user.id,
                'referrer_id': int(ref_id)
            }).execute()

            print(f"✅ Добавлено в pending_referrals: referred_id={user.id}, referrer_id={ref_id}")

        except Exception as e:
            print(f"❌ Ошибка при добавлении в pending_referrals: {e}")

    # 🔘 Кнопка открытия Mini App на весь экран
    keyboard = InlineKeyboardMarkup()
    keyboard.add(
        InlineKeyboardButton(
            "🚀 Открыть приложение",
            web_app=WebAppInfo(url=WEBAPP_URL + "?tgWebAppExpand=true")  # параметр кастомный
        )
    )

    bot.send_message(
        message.chat.id,
        f"Привет, {user.first_name or 'друг'}! 👋\nЗапусти Mini App по кнопке ниже:",
        reply_markup=keyboard
    )

if __name__ == "__main__":
    print("🚀 AppStarterBot запущен и ждёт /start")
    bot.infinity_polling()
