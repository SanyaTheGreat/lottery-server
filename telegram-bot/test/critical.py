from pyrogram import Client
from pyrogram.raw.functions.payments import GetSavedStarGifts, GetPaymentForm, SendPaymentForm
from pyrogram.raw.types import InputPeerSelf, InputPeerUser
from datetime import datetime
from supabase import create_client, Client as SupabaseClient
import os

# Supabase init
SUPABASE_URL = os.getenv("SUPABASE_URL", "https://djpcftyqkwucbksknsdu.supabase.co")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRqcGNmdHlxa3d1Y2Jrc2tuc2R1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDQ2NzE4ODIsImV4cCI6MjA2MDI0Nzg4Mn0.SNI196TucjsepnXIkZDgGwRv7J5chYE9KN6gBx5BszA")
supabase: SupabaseClient = create_client(SUPABASE_URL, SUPABASE_KEY)

app = Client("storage_account")


async def main():
    await app.start()
    me = await app.get_me()
    print(f" Вошли как: {me.first_name} (@{me.username})\n")

    #  Проверка и сохранение подарков
    try:
        result = await app.invoke(GetSavedStarGifts(
            peer=InputPeerSelf(),
            offset="",
            limit=1000,
            exclude_unsaved=True,
            exclude_saved=False,
            exclude_unlimited=False,
            exclude_limited=False,
            exclude_unique=False,
            sort_by_value=True
        ))

        gifts = getattr(result, "gifts", [])
        if not gifts:
            print("Нет доступных сохранённых подарков.")
        else:
            print(f" Найдено сохранённых подарков: {len(gifts)}\n")
            inserted = 0
            skipped = 0

            for g in gifts:
                gift = getattr(g, "gift", None)
                gift_id = getattr(gift, "id", None)
                title = getattr(gift, "title", None)
                slug = getattr(gift, "slug", None)
                stars = getattr(g, "transfer_stars", None)

                if not gift_id or not slug:
                    continue

                exists = supabase.table("available_gifts").select("nft_number").eq("nft_number", gift_id).eq("used", False).execute()
                if exists.data:
                    skipped += 1
                    continue

                data = {
                    "nft_number": gift_id,
                    "nft_name": title,
                    "slug": slug,
                    "transfer_stars": stars,
                    "link": f"https://t.me/addgift/{slug}",
                    "created_at": datetime.now().isoformat(),
                    "used": False
                }

                supabase.table("available_gifts").insert(data).execute()
                inserted += 1
                print(f"Добавлен: {gift_id} ({title})")

            print(f"\n Успешно добавлено: {inserted}")
            print(f" Пропущено (уже были): {skipped}")

    except Exception as e:
        print(f" Ошибка при получении подарков: {e}")

    

    
    #  Обработка pending_rewards
    print("\n Начинаем обработку ожидающих наград...")
    rewards = supabase.table("pending_rewards").select("*").eq("status", "pending").execute().data

    for reward in rewards:
        nft_number = reward["nft_number"]
        telegram_id = reward["telegram_id"]
        reward_id = reward["id"]

        print(f" Отправляем подарок {nft_number} пользователю {telegram_id}...")

        try:
            recipient_peer = await app.resolve_peer(int(telegram_id))

            await app.transfer_gift(message_id=int(nft_number),to_chat_id=telegram_id)

        
            form = await app.invoke(GetPaymentForm(
                peer=recipient_peer,
                gift_id=int(nft_number)
            ))

    
            await app.invoke(SendPaymentForm(
                form_id=form.form_id,
                peer=recipient_peer,
                requested_info_id="",
                shipping_option_id="",
                credentials={},
                tip_amount=0
            ))

            print(f" Подарок {nft_number} отправлен пользователю {telegram_id}")

            # Обновляем таблицы
            supabase.table("pending_rewards").update({
                "status": "confirmed",
                "sent_at": datetime.now().isoformat()
            }).eq("id", reward_id).execute()

            supabase.table("available_gifts").update({
                "used": True
            }).eq("nft_number", nft_number).execute()

            print(f"Подарок {nft_number} успешно помечен как отправленный.\n")
            

        except Exception as e:
            print(f" Ошибка при отправке подарка пользователю {telegram_id}: {e}")

    await app.stop()

import asyncio
asyncio.get_event_loop().run_until_complete(main())
