import asyncio
from pyrogram import Client

# 🔐 Авторизация
api_id = 20572626
api_hash = "e0a03ec5b69ed82bc7344630fdf7ca2a"
session_name = "OGstorage_account"

# 🎁 Данные подарка
msg_id = 69  # ID сообщения, содержащего подарок
user_id = 1889455597  # Получатель

# Создание клиента
app = Client(session_name, api_id=api_id, api_hash=api_hash)

async def transfer_star_gift():
    await app.start()

    try:
        result = await app.transfer_gift(
            message_id=msg_id,
            to_chat_id=user_id
        )
        print("✅ Подарок успешно передан!")
        print(result)

    except Exception as e:
        print(f"❌ Ошибка при передаче подарка: {e}")

    await app.stop()

if __name__ == "__main__":
    asyncio.get_event_loop().run_until_complete(transfer_star_gift())
