import asyncio
from pyrogram import Client
from pprint import pprint

# 🔐 Авторизация — та же, что в проекте
api_id = 20437724
api_hash = "043efa2aaaf33432e3c23560015032cb"
session_name = "storage_account"

# 📩 Целевой чат с подарками
chat_id = 7724401814  # @fightforgift

# 🔍 Сколько сообщений просканировать
MESSAGE_LIMIT = 100

async def fetch_gift_messages():
    app = Client(session_name, api_id, api_hash)
    await app.start()

    print(f"🔍 Сканируем {MESSAGE_LIMIT} сообщений из чата @fightforgift...")

    async for message in app.get_chat_history(chat_id, limit=MESSAGE_LIMIT):
        print("=" * 80)
        print(f"🧾 Сообщение ID: {message.id}")
        pprint(message.__dict__)  # Вывод всех полей объекта message
        print("=" * 80)

    await app.stop()

if __name__ == "__main__":
    asyncio.get_event_loop().run_until_complete(fetch_gift_messages())
