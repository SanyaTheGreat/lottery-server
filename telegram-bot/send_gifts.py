import os
import asyncio
from datetime import datetime, timezone
from pyrogram import Client
from supabase import create_client, Client as SupabaseClient

# 🔐 Авторизация
api_id = int(os.getenv("api_id"))
api_hash = os.getenv("api_hash")
session_name = "OGstorage_account"

# Supabase init
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
supabase: SupabaseClient = create_client(SUPABASE_URL, SUPABASE_KEY)

# Инициализация Telegram клиента
app = Client(session_name, api_id, api_hash)

async def send_pending_gifts():
    await app.start()
    print("📤 Запущена проверка и отправка подарков")


    while True:
        print("🔄 Захожу на новый круг проверки...")
        response = supabase.table("pending_rewards").select("msg_id, telegram_id").eq("status", "pending").execute()
        pending = response.data

        if not pending:
            print("подарков для отпрвки нема=(")

        for item in pending:
            msg_id = item["msg_id"]
            chat_id = item["telegram_id"]

            try:
                await app.transfer_gift(message_id=msg_id, to_chat_id=chat_id)
                print(f"🎁 Подарок из сообщения {msg_id} отправлен пользователю {chat_id}")
                

                response = (
                supabase.table("pending_rewards") 
                .update({
                    "status": "send",
                    "sent_at": datetime.utcnow().isoformat()
                    })
                    .eq("msg_id", msg_id)
                    .execute()
                )

                response = (
                supabase.table("available_gifts")
                    .update({"used": True})
                    .eq("msg_id", msg_id)
                    .execute()
                )
                print("✅ Обновление available_gifts:", response.data)

            except Exception as e:
                if "PEER_ID_INVALID" in str(e):
                    print (f"⚠ Пользователь {chat_id} не писал в ЛС. Подарок не отправлен.")
                else:
                    print(f"❌ Неизвестная ошибка при отправке {msg_id} → {chat_id}: {e}")
    

                

        await asyncio.sleep(60)

if __name__ == "__main__":
    loop = asyncio.get_event_loop()
    loop.run_until_complete(send_pending_gifts())
