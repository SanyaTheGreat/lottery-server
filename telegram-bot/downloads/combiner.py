import json

with open("gift.json", "r", encoding="utf-8") as f1, open("pattern.json", "r", encoding="utf-8") as f2:
    gift = json.load(f1)
    pattern = json.load(f2)

# Объединим слои (pattern должен идти первым)
combined_layers = pattern["layers"] + gift["layers"]

# Создаем финальный JSON
combined = {
    "v": gift.get("v", "5.5.2"),
    "fr": gift.get("fr", 60),
    "ip": gift.get("ip", 0),
    "op": gift.get("op", 180),
    "w": gift.get("w", 512),
    "h": gift.get("h", 512),
    "ddd": 0,
    "assets": [],
    "layers": combined_layers
}

with open("combined.json", "w", encoding="utf-8") as f:
    json.dump(combined, f, ensure_ascii=False, indent=2)

print("✅ Файл combined.json создан")
