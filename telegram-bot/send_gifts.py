import os
import sys
import asyncio
from datetime import datetime
from pyrogram import Client
from supabase import create_client, Client as SupabaseClient

sys.stdout.flush()

# 🔐 Авторизация
api_id = int(os.getenv("api_id"))
api_hash = os.getenv("api_hash")
session_name = "account"

# Supabase init
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
supabase: SupabaseClient = create_client(SUPABASE_URL, SUPABASE_KEY)

# Telegram client
app = Client(session_name, api_id, api_hash)

SPECIAL_SEND_SLUGS = {"rocket", "diamond", "bear", "heart"}

async def send_pending_gifts():
    print("🟢 Скрипт запущен — до await app.start()", flush=True)
    await app.start()
    print("📤 После app.start(): клиент запущен", flush=True)

    while True:
        print("🔄 Новый круг проверки pending_rewards...", flush=True)

        # ВАЖНО: добавили поля nft_name, nft_number, username
        response = supabase.table("pending_rewards") \
            .select("msg_id, telegram_id, username, nft_name, nft_number") \
            .eq("status", "pending") \
            .execute()
        pending = response.data

        if not pending:
            print("⛔ Нет подарков для отправки", flush=True)

        for item in pending:
            msg_id = item.get("msg_id")
            chat_id = item.get("telegram_id")
            username = item.get("username")  # может быть None
            nft_name = (item.get("nft_name") or "").strip().lower()
            gift_id = item.get("nft_number")  # = Telegram gift_id

            try:
                # если это спец-подарок из магазина — send_gift
                if nft_name in SPECIAL_SEND_SLUGS:
                    # chat_id может быть int или username-строка
                    target = chat_id if chat_id else (username or "").lstrip("@")
                    print(f"➡️ send_gift: gift_id={gift_id}, target={target}", flush=True)
                    await app.send_gift(chat_id=target, gift_id=int(gift_id))

                    # обновляем только pending_rewards
                    supabase.table("pending_rewards").update({
                        "status": "send",
                        "sent_at": datetime.utcnow().isoformat()
                    }).eq("nft_number", gift_id).eq("telegram_id", chat_id).execute()

                    print("✅ Отправлено через send_gift, статус обновлён", flush=True)

                else:
                    # старая логика: передаём уже купленный подарок по msg_id
                    print(f"➡️ transfer_gift: msg_id={msg_id}, chat_id={chat_id}", flush=True)
                    await app.transfer_gift(owned_gift_id=str(msg_id), new_owner_chat_id=chat_id)
                    print(f"✅ Подарок {msg_id} отправлен пользователю {chat_id}", flush=True)

                    # обновляем pending_rewards и помечаем available_gifts.used = True
                    supabase.table("pending_rewards").update({
                        "status": "send",
                        "sent_at": datetime.utcnow().isoformat()
                    }).eq("msg_id", msg_id).execute()

                    supabase.table("available_gifts").update({"used": True}) \
                        .eq("msg_id", msg_id).execute()
                    print("📝 Статус и used обновлены", flush=True)

            except Exception as e:
                text = str(e)
                if "PEER_ID_INVALID" in text:
                    print(f"⚠ Пользователь {chat_id or username} не писал в ЛС. Подарок не отправлен.", flush=True)
                elif "STARGIFT_USAGE_LIMITED" in text:
                    print(f"⚠ Gift {gift_id} недоступен (лимит/распродан).", flush=True)
                else:
                    print(f"❌ Ошибка при отправке ({nft_name}): {e}", flush=True)

        await asyncio.sleep(60)

if __name__ == "__main__":
    print("🚀 Запуск event loop...", flush=True)
    loop = asyncio.get_event_loop()
    loop.run_until_complete(send_pending_gifts())
