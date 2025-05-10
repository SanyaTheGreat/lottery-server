from pyrogram import Client
from pyrogram.raw.functions.payments import GetSavedStarGifts
from pyrogram.raw.types import InputPeerSelf
from supabase import create_client, Client as SupabaseClient
import os

# Supabase init
SUPABASE_URL = os.getenv("SUPABASE_URL", "https://djpcftyqkwucbksknsdu.supabase.co")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRqcGNmdHlxa3d1Y2Jrc2tuc2R1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDQ2NzE4ODIsImV4cCI6MjA2MDI0Nzg4Mn0.SNI196TucjsepnXIkZDgGwRv7J5chYE9KN6gBx5BszA")
supabase: SupabaseClient = create_client(SUPABASE_URL, SUPABASE_KEY)

# Инициализация Telegram клиента
app = Client("storage_account")

async def check_gift_data():
    # Запуск клиента
    await app.start()

    try:
        # Получаем сохранённые подарки
        result = await app.invoke(GetSavedStarGifts(
            peer=InputPeerSelf(),  # Получаем подарки для самого себя (аккаунт-хранилище)
            offset="",
            limit=1000,
            exclude_unsaved=True,
            exclude_saved=False,
            exclude_unlimited=False,
            exclude_limited=False,
            exclude_unique=False,
            sort_by_value=True
        ))

        # Проверяем, есть ли подарки
        gifts = getattr(result, "gifts", [])
        if not gifts:
            print("📭 Нет доступных сохранённых подарков.")
        else:
            print(f"🎁 Найдено сохранённых подарков: {len(gifts)}\n")

            # Выводим информацию о каждом подарке
            for g in gifts:
                gift = getattr(g, "gift", None)
                if gift:
                    gift_id = getattr(gift, "id", None)
                    title = getattr(gift, "title", None)
                    slug = getattr(gift, "slug", None)
                    stars = getattr(gift, "transfer_stars", None)

                    # Выводим данные подарков
                    print(f"🎁 Подарок ID: {gift_id}, Название: {title}, Slug: {slug}, Звезды: {stars}")

                    # Проверка в базе данных (сравниваем с available_gifts)
                    exists = supabase.table("available_gifts").select("nft_number").eq("nft_number", gift_id).execute()
                    if exists.data:
                        print(f"✅ Подарок {gift_id} уже существует в базе данных.")
                    else:
                        print(f"❌ Подарок {gift_id} не найден в базе данных.")

    except Exception as e:
        print(f"❌ Ошибка при получении данных о подарках: {e}")

    await app.stop()

# Запуск проверки
import asyncio
asyncio.get_event_loop().run_until_complete(check_gift_data())
