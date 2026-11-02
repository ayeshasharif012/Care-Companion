import os
import pymongo
import certifi

MONGO_URI = os.getenv("MONGO_URI") or os.getenv("MONGO_CON_STRING")
DB_NAME = os.getenv("MONGO_DB_NAME", "care-companion")
COLLECTION_NAME = os.getenv("MONGO_REMINDERS_COLLECTION", "reminders")

if not MONGO_URI:
    try:
        from config import MONGO_CON_STRING, DB_NAME as _DB, COLLECTION_NAME as _COL

        MONGO_URI = MONGO_CON_STRING
        DB_NAME = _DB
        COLLECTION_NAME = _COL
        print("✅ Mongo config loaded from config.py")
    except ImportError as e:
        print(f"❌ Set MONGO_URI in iot-controller/.env (config.py missing: {e})")
        raise SystemExit(1) from e
else:
    print("✅ Mongo config loaded from environment")

try:
    client = pymongo.MongoClient(MONGO_URI, tlsCAFile=certifi.where())
    db = client[DB_NAME]
    collection = db[COLLECTION_NAME]

    print(f"🚀 Connected to Database: {DB_NAME}")
    print(f"📂 Connected to Collection: {COLLECTION_NAME}")

    test_reminder = collection.find_one()
    if test_reminder:
        med_name = test_reminder.get("title", "No Title Found")
        print(f"📄 Data Found! Example Reminder: {med_name}")
    else:
        print("⚠️ Connection successful, but the 'reminders' collection is empty.")

except Exception as e:
    print(f"❌ Connection Failed: {e}")
    raise
