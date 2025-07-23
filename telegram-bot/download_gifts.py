import os
import json
from pyrogram import Client
from supabase import create_client, Client as SupabaseClient
from lottie.parsers.tgs import parse_tgs

# Supabase config
SUPABASE_URL = "https://djpcftyqkwucbksknsdu.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRqcGNmdHlxa3d1Y2Jrc2tuc2R1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDQ2NzE4ODIsImV4cCI6MjA2MDI0Nzg4Mn0.SNI196TucjsepnXIkZDgGwRv7J5chYE9KN6gBx5BszA"
TABLE_NAME = "available_gifts"

# Telegram config
TELEGRAM_SESSION = "OGstorage_account"
TELEGRAM_USER_ID = 279952870

# Paths
ANIMATIONS_DIR = "C:/Users/PC/Desktop/frontend/fronted-server/public/animations"
COLORS_FILE = os.path.join(ANIMATIONS_DIR, "colors.json")
os.makedirs(ANIMATIONS_DIR, exist_ok=True)

# Init Supabase
supabase: SupabaseClient = create_client(SUPABASE_URL, SUPABASE_KEY)

# Init Pyrogram client
app = Client(TELEGRAM_SESSION)

# Load existing colors.json (если уже есть)
if os.path.exists(COLORS_FILE):
    with open(COLORS_FILE, "r", encoding="utf-8") as f:
        colors_data = json.load(f)
else:
    colors_data = {}

with app:
    # Шаг 1: Загружаем все подарки из Supabase
    response = supabase.table(TABLE_NAME).select("nft_name,msg_id,slug").execute()
    gifts = response.data

    print(f"Найдено {len(gifts)} подарков в Supabase")

    for gift in gifts:
        nft_name = gift["nft_name"]
        msg_id = gift["msg_id"]
        slug = gift["slug"]

        print(f"\n✨ Обработка: {slug} (msg_id={msg_id})")

        try:
            message = app.get_messages(TELEGRAM_USER_ID, msg_id)

            if not message.gift:
                print("  ❌ Нет подарка в сообщении!")
                continue

            # Ищем атрибут типа MODEL (анимация)
            model_attr = next((attr for attr in message.gift.attributes if attr.type.name == "MODEL"), None)
            backdrop_attr = next((attr for attr in message.gift.attributes if attr.type.name == "BACKDROP"), None)

            if not model_attr or not hasattr(model_attr, "sticker"):
                print("  ❌ Нет MODEL атрибута или sticker!")
                continue

            # Скачиваем .tgs файл
            file_id = model_attr.sticker.file_id
            tgs_path = os.path.join(ANIMATIONS_DIR, f"{slug}.tgs")
            json_path = os.path.join(ANIMATIONS_DIR, f"{slug}.json")
            app.download_media(file_id, file_name=tgs_path)
            print(f"  ✅ Скачан: {tgs_path}")

            # Конвертируем в .json (Lottie)
            try:
                animation = parse_tgs(tgs_path)
                with open(json_path, "w", encoding="utf-8") as out:
                    json.dump(animation.to_dict(), out, ensure_ascii=False, indent=2)
                print(f"  ✅ Конвертирован в: {json_path}")
            except Exception as conv_err:
                print(f"  ⚠ Ошибка при конвертации .tgs: {conv_err}")

            # Извлекаем цвета
            if backdrop_attr:
                colors_data[slug] = {
                    "center_color": f"#{backdrop_attr.center_color:06x}",
                    "edge_color": f"#{backdrop_attr.edge_color:06x}",
                    "pattern_color": f"#{backdrop_attr.pattern_color:06x}",
                    "text_color": f"#{backdrop_attr.text_color:06x}"
                }
                print(f"  ✨ Цвета сохранены: {colors_data[slug]}")

        except Exception as e:
            print(f"  ❌ Ошибка при обработке {slug}: {e}")

# Сохраняем colors.json
with open(COLORS_FILE, "w", encoding="utf-8") as f:
    json.dump(colors_data, f, ensure_ascii=False, indent=2)

print("\n✅ Готово! Все файлы и цвета сохранены.")
