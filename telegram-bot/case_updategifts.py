import os
import json
from pyrogram import Client
from supabase import create_client, Client as SupabaseClient
from lottie.parsers.tgs import parse_tgs

# ── Telegram API ─────────────────────────────────────────────────
API_ID = 20572626
API_HASH = "e0a03ec5b69ed82bc7344630fdf7ca2a"
SESSION_NAME = "updategifts_v3"  # новое имя сессии, можно менять

# username БЕЗ @ (или числовой id)
SOURCE_PEER = "GiftsToPortals"

# ── Supabase ────────────────────────────────────────────────────
SUPABASE_URL = "https://djpcftyqkwucbksknsdu.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRqcGNmdHlxa3d1Y2Jrc2tuc2R1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NDY3MTg4MiwiZXhwIjoyMDYwMjQ3ODgyfQ.oSMAenP7WqL19Fl8fhwx7WfwKMG4us-KQ6d_XbpIJSw"
TABLE_NAME = "gifts_for_cases"

# ── Paths ───────────────────────────────────────────────────────
ANIMATIONS_DIR = "C:/Users/PC/Desktop/frontend/fronted-server/public/animations"
os.makedirs(ANIMATIONS_DIR, exist_ok=True)
COLORS_FILE = os.path.join(ANIMATIONS_DIR, "colors.json")

PNG_SIZE = 512  # размер PNG по большей стороне

# ── Init Supabase ───────────────────────────────────────────────
supabase: SupabaseClient = create_client(SUPABASE_URL, SUPABASE_KEY)

# ── Telegram client ─────────────────────────────────────────────
app = Client(
    SESSION_NAME,
    api_id=API_ID,
    api_hash=API_HASH,
    no_updates=True,
    ipv6=False
)

# ── Load existing colors.json ───────────────────────────────────
if os.path.exists(COLORS_FILE):
    with open(COLORS_FILE, "r", encoding="utf-8") as f:
        colors_data = json.load(f)
else:
    colors_data = {}

def render_png_from_tgs(tgs_path: str, png_path: str, size: int = PNG_SIZE) -> bool:
    """
    Рендер первого кадра TGS → PNG.
    Требуются пакеты: lottie, Pillow.
    Возвращает True при успехе.
    """
    try:
        animation = parse_tgs(tgs_path)
        # Пытаемся через экспортёр PNG из lottie
        try:
            # В некоторых версиях:
            from lottie.exporters import png as lottie_png
            lottie_png.export_png(animation, png_path, frame=0, width=size, height=size)
            return True
        except Exception:
            # Фолбэк через Pillow-экспортёр (если доступен)
            try:
                from lottie.exporters import exporters
                exporter = exporters.get("pillow")
                exporter.export(animation, png_path, frame=0, width=size, height=size)
                return True
            except Exception as e2:
                print(f"  ⚠ Не удалось отрендерить PNG через lottie: {e2}")
                return False
    except Exception as e:
        print(f"  ⚠ Ошибка parse_tgs: {e}")
        return False

with app:
    # Прогрев peer
    try:
        app.get_users(SOURCE_PEER)
    except Exception:
        pass

    # 1) Берём подарки из БД
    response = supabase.table(TABLE_NAME).select("nft_name,msg_id,slug").execute()
    gifts = response.data or []
    print(f"Найдено {len(gifts)} подарков в {TABLE_NAME}")

    for gift in gifts:
        nft_name = gift.get("nft_name")
        msg_id = gift.get("msg_id")
        slug = gift.get("slug")

        if not msg_id:
            print(f"⏭️ Пропуск: нет msg_id (slug={slug})")
            continue

        print(f"\n✨ Обработка: {slug} (msg_id={msg_id})")

        tgs_path = os.path.join(ANIMATIONS_DIR, f"{slug}.tgs")
        json_path = os.path.join(ANIMATIONS_DIR, f"{slug}.json")
        png_path = os.path.join(ANIMATIONS_DIR, f"{slug}.png")

        # Если PNG уже есть — считаем, что всё скачано/сконвертировано
        if os.path.exists(png_path) and os.path.exists(json_path):
            print(f"⏭️ Уже есть PNG и Lottie: {png_path}, {json_path}")
            continue

        try:
            message = app.get_messages(SOURCE_PEER, int(msg_id))
            if not message or not getattr(message, "gift", None):
                print("  ❌ Нет подарка в сообщении!")
                continue

            # Атрибуты
            attrs = getattr(message.gift, "attributes", []) or []
            model_attr = next((a for a in attrs if getattr(getattr(a, "type", None), "name", "") == "MODEL"), None)
            backdrop_attr = next((a for a in attrs if getattr(getattr(a, "type", None), "name", "") == "BACKDROP"), None)

            if not model_attr or not hasattr(model_attr, "sticker") or not getattr(model_attr.sticker, "file_id", None):
                print("  ❌ Нет MODEL.sticker — нечего скачивать")
                continue

            # 2) Скачиваем .tgs
            file_id = model_attr.sticker.file_id
            if not os.path.exists(tgs_path):
                app.download_media(file_id, file_name=tgs_path)
                print(f"  ✅ Скачан: {tgs_path}")
            else:
                print(f"  ⏭️ Уже есть TGS: {tgs_path}")

            # 3) Конвертируем .tgs → .json
            if not os.path.exists(json_path):
                try:
                    animation = parse_tgs(tgs_path)
                    with open(json_path, "w", encoding="utf-8") as out:
                        json.dump(animation.to_dict(), out, ensure_ascii=False, indent=2)
                    print(f"  ✅ Конвертирован в: {json_path}")
                except Exception as conv_err:
                    print(f"  ⚠ Ошибка при конвертации .tgs: {conv_err}")
            else:
                print(f"  ⏭️ Уже есть Lottie: {json_path}")

            # 4) PNG: сначала пробуем взять thumbnail стикера
            png_done = False
            sticker = model_attr.sticker
            thumb_file_id = None

            # Pyrogram может давать thumb или thumbs
            if getattr(sticker, "thumb", None):
                thumb_file_id = sticker.thumb.file_id
            elif getattr(sticker, "thumbs", None):
                thumbs = sticker.thumbs or []
                if thumbs:
                    thumb_file_id = thumbs[0].file_id

            if thumb_file_id:
                try:
                    app.download_media(thumb_file_id, file_name=png_path)
                    print(f"  ✅ PNG (thumbnail): {png_path}")
                    png_done = True
                except Exception as e_dl:
                    print(f"  ⚠ Не удалось скачать thumbnail: {e_dl}")

            # если thumbnail нет/не скачался — рендерим из TGS первый кадр
            if not png_done:
                if render_png_from_tgs(tgs_path, png_path, PNG_SIZE):
                    print(f"  ✅ PNG (rendered): {png_path}")
                else:
                    print("  ❌ PNG не удалось получить (ни thumbnail, ни рендер)")

            # 5) Цвета BACKDROP
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

print("\n✅ Готово! Анимации (.tgs, .json), PNG и цвета сохранены.")
