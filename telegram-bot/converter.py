import os
from pathlib import Path
from pyrogram import Client

# ---------------- CONFIG ----------------
API_ID = 20572626
API_HASH = "e0a03ec5b69ed82bc7344630fdf7ca2a"
SESSION_NAME = "updategifts_v3"

OUTPUT_DIR = r"C:\Users\PC\Desktop\png"
READ_EXACT_MESSAGES = 1   # читаем ровно 11 сообщений
# ---------------------------------------


def ensure_dir(p: Path) -> None:
    p.mkdir(parents=True, exist_ok=True)


def is_tgs_message(msg) -> bool:
    if msg.document and (msg.document.mime_type or "").lower() == "application/x-tgsticker":
        return True
    if msg.sticker and (msg.sticker.mime_type or "").lower() == "application/x-tgsticker":
        return True
    return False


def get_sticker_obj(msg):
    # поддерживаем и document, и sticker
    if msg.sticker:
        return msg.sticker
    if msg.document and (msg.document.mime_type or "").lower() == "application/x-tgsticker":
        return msg.document
    return None


def safe_name(name: str) -> str:
    bad = ['<', '>', ':', '"', '/', '\\', '|', '?', '*']
    for ch in bad:
        name = name.replace(ch, "_")
    return name.strip()


def get_thumb_file_id(sticker_obj):
    # как в твоём коде: thumb -> thumbs[0]
    if getattr(sticker_obj, "thumb", None) and getattr(sticker_obj.thumb, "file_id", None):
        return sticker_obj.thumb.file_id

    if getattr(sticker_obj, "thumbs", None):
        thumbs = sticker_obj.thumbs or []
        if thumbs and getattr(thumbs[0], "file_id", None):
            return thumbs[0].file_id

    return None


def main():
    out_dir = Path(OUTPUT_DIR)
    ensure_dir(out_dir)

    app = Client(SESSION_NAME, api_id=API_ID, api_hash=API_HASH, no_updates=True, ipv6=False)

    with app:
        print(f"✅ Connected. Reading exactly {READ_EXACT_MESSAGES} messages from Saved Messages")
        print(f"Output: {out_dir}\n")

        msgs = list(app.get_chat_history("me", limit=READ_EXACT_MESSAGES))
        print(f"Read messages: {len(msgs)}\n")

        got_png = 0
        got_tgs = 0
        no_thumb = 0

        for idx, msg in enumerate(msgs, start=1):
            msg_id = getattr(msg, "id", None)

            if not is_tgs_message(msg):
                print(f"[{idx}/{READ_EXACT_MESSAGES}] ⏭️ msg_id={msg_id} not TGS -> skip")
                continue

            sticker_obj = get_sticker_obj(msg)
            if not sticker_obj or not getattr(sticker_obj, "file_id", None):
                print(f"[{idx}/{READ_EXACT_MESSAGES}] ❌ msg_id={msg_id} no file_id -> skip")
                continue

            base = safe_name(f"{msg_id}")

            tgs_path = out_dir / f"{base}.tgs"
            png_path = out_dir / f"{base}.png"

            # 1) Скачиваем сам .tgs (на всякий)
            if not tgs_path.exists() or tgs_path.stat().st_size == 0:
                try:
                    app.download_media(sticker_obj.file_id, file_name=str(tgs_path))
                    got_tgs += 1
                except Exception as e:
                    print(f"[{idx}/{READ_EXACT_MESSAGES}] ❌ TGS download fail msg_id={msg_id}: {e}")
                    continue

            # 2) Пытаемся скачать thumbnail как PNG
            thumb_file_id = get_thumb_file_id(sticker_obj)
            if not thumb_file_id:
                print(f"[{idx}/{READ_EXACT_MESSAGES}] ⚠ msg_id={msg_id} NO_THUMB (PNG not downloaded)")
                no_thumb += 1
                continue

            if png_path.exists() and png_path.stat().st_size > 0:
                print(f"[{idx}/{READ_EXACT_MESSAGES}] ⏭️ PNG exists: {png_path.name}")
                got_png += 1
                continue

            try:
                app.download_media(thumb_file_id, file_name=str(png_path))
                print(f"[{idx}/{READ_EXACT_MESSAGES}] ✅ PNG: {png_path.name}")
                got_png += 1
            except Exception as e:
                print(f"[{idx}/{READ_EXACT_MESSAGES}] ❌ PNG download fail msg_id={msg_id}: {e}")

        print("\nDone.")
        print(f"TGS downloaded: {got_tgs}")
        print(f"PNG downloaded: {got_png}")
        print(f"No thumbnail:   {no_thumb}")
        if no_thumb > 0:
            print("⚠ Для сообщений без thumbnail нужен рендер .tgs -> .png (вторым шагом).")


if __name__ == "__main__":
    main()