import os
import asyncio
import re
from pyrogram import Client

# 🔐 Авторизация (как просил)
api_id = 20572626
api_hash = "e0a03ec5b69ed82bc7344630fdf7ca2a"
session_name = "stopper"   # отдельная сессия, не трогаем ваш рабочий воркер

def slugify(text: str) -> str:
    s = re.sub(r"\s+", "-", (text or "").strip().lower())
    s = re.sub(r"[^a-z0-9\-]+", "", s)
    s = re.sub(r"-{2,}", "-", s).strip("-")
    return s or "gift"

async def main():
    app = Client(session_name, api_id, api_hash)
    await app.start()

    gifts = await app.get_available_gifts()

    print(f"{'gift_id':>10}  {'price':>8}  {'slug':<20}  title")
    print("-" * 80)

    for g in gifts:
        # возможные варианты названия поля цены
        price = getattr(g, "price", None)
        if price is None:
            price = getattr(g, "stars", None)
        if price is None:
            price = getattr(g, "stars_price", None)

        gid = int(getattr(g, "id", 0))
        title = getattr(g, "title", str(g))
        print(f"{gid:>10}  {str(price or '-'):>8}  {slugify(title):<20}  {title}")

    await app.stop()

if __name__ == "__main__":
    asyncio.run(main())
