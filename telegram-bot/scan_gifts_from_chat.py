import os
import asyncio
from datetime import datetime, timezone
from pyrogram import Client
from pyrogram.enums import MessageServiceType
from supabase import create_client, Client as SupabaseClient

# 🔐 Авторизация
api_id = 20572626
api_hash = "e0a03ec5b69ed82bc7344630fdf7ca2a"
session_name = "OGstorage_account"

# 👤 Второй аккаунт (источник подарков)
SECOND_USER_ID = 279952870

# Supabase init
SUPABASE_URL = os.getenv("SUPABASE_URL", "https://djpcftyqkwucbksknsdu.supabase.co")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRqcGNmdHlxa3d1Y2Jrc2tuc2R1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDQ2NzE4ODIsImV4cCI6MjA2MDI0Nzg4Mn0.SNI196TucjsepnXIkZDgGwRv7J5chYE9KN6gBx5BszA")
supabase: SupabaseClient = create_client(SUPABASE_URL, SUPABASE_KEY)



    

async def scan_gifts_from_chat():
    # Инициализация Telegram клиента
    app = Client(session_name, api_id, api_hash)
    await app.start()
    print("🚀 Запущен скан подарков")

    async for msg in app.get_chat_history(chat_id=SECOND_USER_ID, limit=200):
        if msg.service != MessageServiceType.GIFT:
            continue

        if not hasattr(msg, "gift") or not msg.gift:
            continue

        gift = msg.gift
        gift_id = gift.id
        nft_number = gift_id
        slug = gift.name
        title = gift.title
        stars = gift.transfer_price
        link = f"https://t.me/nft/{slug}"

        check = supabase.table("available_gifts").select("nft_number, used").eq("nft_number", nft_number).execute()
        if check.data and any(not g.get("used") for g in check.data):
            print(f"⛔ Подарок {nft_number} уже есть и не использован — пропуск.")
            continue

        insert_data = {
            "nft_number": nft_number,
            "slug": slug,
            "nft_name": title,
            "transfer_stars": stars,
            "link": link,
            "used": False,
            "msg_id": msg.id,
            "created_at": datetime.utcnow().isoformat()
        }

        supabase.table("available_gifts").insert(insert_data).execute()
        print(f"✅ Добавлен подарок {nft_number} — '{title}'")

    await app.stop()
    print("🏁 Скан завершён")

if __name__ == "__main__":
    asyncio.run(scan_gifts_from_chat())
