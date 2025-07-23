import json
from lottie.parsers.tgs import parse_tgs

# Конвертируем gift.tgs → gift.json
animation = parse_tgs("gift.tgs")
with open("gift.json", "w", encoding="utf-8") as out:
    json.dump(animation.to_dict(), out, ensure_ascii=False, indent=2)

# Конвертируем pattern.tgs → pattern.json
animation = parse_tgs("pattern.tgs")
with open("pattern.json", "w", encoding="utf-8") as out:
    json.dump(animation.to_dict(), out, ensure_ascii=False, indent=2)

print("✅ Конвертация завершена!")
