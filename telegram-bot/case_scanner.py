# case_scanner.py
import os
import asyncio
from datetime import datetime
from uuid import uuid4

from pyrogram import Client
from pyrogram.enums import MessageServiceType
from supabase import create_client, Client as SupabaseClient

# --- Telegram auth (user session, not bot) ---
api_id = 20572626
api_hash = "e0a03ec5b69ed82bc7344630fdf7ca2a"
session_name = "storagescan_v2"  # новый файл сессии, можно менять

# Чат-источник подарков (второй аккаунт)
SECOND_USER_ID = "giftrelayer"       # можно заменить на username, например "fightforgift"

# --- Supabase ---
SUPABASE_URL = os.getenv("SUPABASE_URL", "https://djpcftyqkwucbksknsdu.supabase.co")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRqcGNmdHlxa3d1Y2Jrc2tuc2R1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NDY3MTg4MiwiZXhwIjoyMDYwMjQ3ODgyfQ.oSMAenP7WqL19Fl8fhwx7WfwKMG4us-KQ6d_XbpIJSw")
supabase: SupabaseClient = create_client(SUPABASE_URL, SUPABASE_KEY)

TABLE = "slot_gifts"
SCAN_LIMIT = 4  # сколько сообщений пролистывать


async def ensure_peer(app: Client, peer):
    """
    Прогреваем peer, чтобы Pyrogram записал его в локальную БД сессии.
    Это устраняет ошибку 'ID not found: {peer_id}' в get_chat_history.
    """
    try:
        await app.get_users(peer)
    except Exception:
        # Если это не user_id, а уже username — get_users тоже сработает.
        pass
    try:
        await app.get_chat(peer)
    except Exception:
        pass


async def scan_gifts_from_chat():
    app = Client(session_name, api_id, api_hash)
    await app.start()
    print("🚀 Сканер подарков запущен")

    # прогреваем peer, чтобы убрать ID not found
    await ensure_peer(app, SECOND_USER_ID)

    added, skipped = 0, 0

    async for msg in app.get_chat_history(chat_id=SECOND_USER_ID, limit=SCAN_LIMIT):
        # интересуют только сервисные сообщения с подарками
        if msg.service != MessageServiceType.GIFT:
            continue
        gift = getattr(msg, "gift", None)
        if not gift:
            continue

        nft_number = gift.id
        slug = gift.name or ""           # ключ для кейсов
        nft_name = gift.title or ""
        transfer_stars = getattr(gift, "transfer_price", None)
        link = f"https://t.me/nft/{slug}" if slug else None
        msg_id = msg.id

        # антидубль: если уже есть запись с тем же nft_number и used=false — пропускаем
        try:
            existing = supabase.table(TABLE)\
                .select("nft_number, used")\
                .eq("nft_number", nft_number)\
                .execute()

            if existing.data and any(not row.get("used") for row in existing.data):
                skipped += 1
                print(f"⛔ {nft_number} уже есть и не использован — пропуск")
                continue
        except Exception as e:
            print(f"⚠️ Ошибка проверки дубля {nft_number}: {e}")
            continue  # безопаснее пропустить, чем задвоить

        insert_data = {
            "pending_id": str(uuid4()),
            "nft_number": nft_number,
            "msg_id": msg_id,
            "slug": slug,
            "nft_name": nft_name,
            "transfer_stars": transfer_stars,
            "link": link,
            "used": False,
            "created_at": datetime.utcnow().isoformat()
        }

        try:
            supabase.table(TABLE).insert(insert_data).execute()
            added += 1
            print(f"✅ Добавлен {nft_number} — '{nft_name}' (msg_id={msg_id})")
        except Exception as e:
            print(f"❌ Не удалось вставить {nft_number}: {e}")

    await app.stop()
    print(f"🏁 Скан завершён. Добавлено: {added}, пропущено: {skipped}")


if __name__ == "__main__":
    asyncio.run(scan_gifts_from_chat())
