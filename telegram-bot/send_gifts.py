import os
import sys
import asyncio
from datetime import datetime
from pyrogram import Client
from supabase import create_client, Client as SupabaseClient

# Принудительно сбрасываем stdout, чтобы Render показывал логи немедленно
sys.stdout.flush()

# 🔐 Авторизация
api_id = int(os.getenv("api_id"))
api_hash = os.getenv("api_hash")
session_name = "account"

# Supabase init
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
supabase: SupabaseClient = create_client(SUPABASE_URL, SUPABASE_KEY)

# Инициализация Telegram клиента
app = Client(session_name, api_id, api_hash)

async def send_pending_gifts():
    print("🟢 Скрипт запущен — до await app.start()", flush=True)

    await app.start()

    print("📤 После app.start(): клиент запущен", flush=True)

    while True:
        print("🔄 Новый круг проверки pending_rewards...", flush=True)
        response = supabase.table("pending_rewards").select("msg_id, telegram_id").eq("status", "pending").execute()
        pending = response.data

        if not pending:
            print("⛔ Нет подарков для отправки", flush=True)

        for item in pending:
            msg_id = item["msg_id"]
            chat_id = item["telegram_id"]

            try:
                print(f"➡️ Пытаюсь передать подарок: msg_id={msg_id}, chat_id={chat_id}", flush=True)
                await app.transfer_gift(owned_gift_id=str(msg_id), new_owner_chat_id=chat_id)
                print(f"✅ Подарок {msg_id} отправлен пользователю {chat_id}", flush=True)

                supabase.table("pending_rewards").update({
                    "status": "send",
                    "sent_at": datetime.utcnow().isoformat()
                }).eq("msg_id", msg_id).execute()

                supabase.table("available_gifts").update({"used": True}).eq("msg_id", msg_id).execute()
                print("📝 Статус и отметка used обновлены", flush=True)

            except Exception as e:
                if "PEER_ID_INVALID" in str(e):
                    print(f"⚠ Пользователь {chat_id} не писал в ЛС. Подарок не отправлен.", flush=True)
                else:
                    print(f"❌ Ошибка при отправке {msg_id} → {chat_id}: {e}", flush=True)

        await asyncio.sleep(60)

if __name__ == "__main__":
    print("🚀 Запуск event loop...", flush=True)
    loop = asyncio.get_event_loop()
    loop.run_until_complete(send_pending_gifts())
