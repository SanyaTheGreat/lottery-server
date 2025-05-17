import telebot
from telebot.types import InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo

# 🔐 Укажи токен своего Telegram-бота
BOT_TOKEN = "7737729183:AAFCgxv-H_1suiIC5T8VkwU6dMjXuK3Fs0s"  # ← заменишь на свой

# 🌐 Ссылка на твой Mini App (frontend на Vercel)
WEBAPP_URL = "https://frontend-nine-sigma-49.vercel.app/"

bot = telebot.TeleBot(BOT_TOKEN)

@bot.message_handler(commands=['start'])
def send_welcome(message):
    user = message.from_user
    print(f"🟢 /start от {user.id} ({user.username})")

    keyboard = InlineKeyboardMarkup()
    keyboard.add(
        InlineKeyboardButton("🚀 Открыть приложение", web_app=WebAppInfo(url=WEBAPP_URL))
    )

    bot.send_message(
        message.chat.id,
        f"Привет, {user.first_name or 'друг'}! 👋\nЗапусти Mini App по кнопке ниже:",
        reply_markup=keyboard
    )

if __name__ == "__main__":
    print("🚀 AppStarterBot запущен и ждёт /start")
    bot.infinity_polling()
