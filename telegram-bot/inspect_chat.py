from pyrogram import Client

API_ID = 20572626
API_HASH = "e0a03ec5b69ed82bc7344630fdf7ca2a"
SESSION_NAME = "updategifts_v3"
SOURCE_PEER = "areeefeva"
LIMIT = 1  # можно увеличить

app = Client(
    SESSION_NAME,
    api_id=API_ID,
    api_hash=API_HASH,
    no_updates=True,
    ipv6=False
)

def dump_all_fields(obj, prefix=""):
    """Рекурсивно выводит все поля объекта, не падая."""
    if obj is None:
        print(prefix + "None")
        return
    if isinstance(obj, (str, int, float, bool)):
        print(f"{prefix}{repr(obj)}")
        return
    if isinstance(obj, (list, tuple, set)):
        print(f"{prefix}[{len(obj)} элементов]")
        for i, item in enumerate(obj):
            dump_all_fields(item, prefix + f"  [{i}] → ")
        return

    # если это объект с атрибутами
    print(f"{prefix}<{type(obj).__name__}>")
    for attr in dir(obj):
        if attr.startswith("_"):
            continue
        try:
            value = getattr(obj, attr)
        except Exception:
            continue
        if callable(value):
            continue
        # печатаем тип и значение
        vtype = type(value).__name__
        vdisp = str(value)
        if len(vdisp) > 120:
            vdisp = vdisp[:120] + "..."
        print(f"{prefix}• {attr} ({vtype}): {vdisp}")

app.start()

for msg in app.get_chat_history(SOURCE_PEER, limit=LIMIT):
    print("\n" + "=" * 80)
    print(f"💬 Сообщение ID: {msg.id} | Дата: {msg.date}")
    print("=" * 80)
    dump_all_fields(msg, "  ")

app.stop()
print("\n✅ Готово — все поля сообщений выведены.")
