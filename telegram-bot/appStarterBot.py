import telebot
from telebot.types import InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo
from supabase import create_client, Client

# 🔐 Укажи токен своего Telegram-бота
BOT_TOKEN = "7737729183:AAEkmSIEiO0QG0tmkGzKde3wpMuiIVg5KKY"  # ← заменишь на свой

# ✅ Supabase конфиг
SUPABASE_URL = "https://djpcftyqkwucbksknsdu.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRqcGNmdHlxa3d1Y2Jrc2tuc2R1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NDY3MTg4MiwiZXhwIjoyMDYwMjQ3ODgyfQ.oSMAenP7WqL19Fl8fhwx7WfwKMG4us-KQ6d_XbpIJSw"  # или anon key, если разрешено

# 🌐 Ссылка на твой Mini App (frontend на Vercel)
WEBAPP_URL = "https://frontend-nine-sigma-49.vercel.app/"


supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
bot = telebot.TeleBot(BOT_TOKEN)

@bot.message_handler(commands=['start'])
def send_welcome(message):
    user = message.from_user
    args = message.text.split()
    ref_id = args[1] if len(args) > 1 else None

    print(f"🟢 /start от {user.id} ({user.username}) | ref_id: {ref_id}")

    # 🎯 Если передан ref_id и он не равен себе
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