from pyrogram import Client
import pyrogram


# Замените на ваши данные
api_id = 20572626
api_hash = "e0a03ec5b69ed82bc7344630fdf7ca2a"
session_name = "OGstorage_account"
chat_id = 7724401814  # Пример ID чата

app = Client(session_name, api_id, api_hash)

async def fetch_gift_messages():
    await app.start()

    print(f"🔍 Сканируем сообщения из чата {chat_id}...")

    async for message in app.get_chat_history(chat_id, limit=100):
        # Если в сообщении есть подарок
        if hasattr(message, 'gift') and message.gift:
            gift = message.gift
            if gift.attributes:
                for attribute in gift.attributes:
                    if isinstance(attribute, pyrogram.types.GiftAttribute) and attribute.sticker:
                        sticker = attribute.sticker
                        file_id = sticker.file_id
                        print(f"Скачиваем стикер с file_id: {file_id}")
                        await app.download_media(file_id)

    await app.stop()

app.run()
