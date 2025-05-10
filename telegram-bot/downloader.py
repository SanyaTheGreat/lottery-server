from pyrogram import Client

api_id = 20572626 # твой api_id
api_hash = "e0a03ec5b69ed82bc7344630fdf7ca2a"
session_name = "OGstorage_account"  # имя сессии (любое)

app = Client(session_name, api_id, api_hash)

#file_ids
gift_file_id = "CAACAgIAAxUAAWgQ-onMky-XZXBa6aO98I4i_CeEAALEYAAChtxYS616-TVD3ocNHgQ"
pattern_file_id = "CAACAgIAAxUAAWgQ-onNOearUoz-uypygpTBHL5iAAIHagACjO5AS5a4jV9ZJsIaHgQ"

with Client(session_name, api_id, api_hash) as app:
    app.download_media(gift_file_id, file_name="gift.tgs")
    print("✅ gift.tgs скачан")

    app.download_media(pattern_file_id, file_name="pattern.tgs")
    print("✅ pattern.tgs скачан")
