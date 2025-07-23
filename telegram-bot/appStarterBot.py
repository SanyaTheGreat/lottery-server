import os
import telebot
from telebot.types import InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo
from supabase import create_client, Client

# 🔐 Получаем токен Telegram-бота из переменной окружения
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

    # Если передан ref_id и он не равен себе
    if ref_id and str(user.id) != str(ref_id):
        try:
            existing = supabase.from_('users').select('id, referred_by').eq('telegram_id', user.id).single().execute()

            if existing.data and existing.data['referred_by'] is None:
                ref = supabase.from_('users').select('id').eq('telegram_id', ref_id).single().execute()

                if ref.data:
                    supabase.from_('users').update({'referred_by': ref.data['id']}).eq('telegram_id', user.id).execute()
                    print(f"✅ Привязка успешна: {user.id} → {ref_id}")
                else:
                    print(f"⚠️ Реферер с ID {ref_id} не найден")
            else:
                print("ℹ️ Пользователь уже имеет referred_by или не зарегистрирован")

        except Exception as e:
            print(f"❌ Ошибка при сохранении реферала: {e}")

    # Кнопка открытия Mini App на весь экран
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
