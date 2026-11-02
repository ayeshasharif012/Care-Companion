import pymongo
import certifi

client = pymongo.MongoClient('mongodb://izhan:Care1234@ac-xlohcyt-shard-00-00.uh6daca.mongodb.net:27017,ac-xlohcyt-shard-00-01.uh6daca.mongodb.net:27017,ac-xlohcyt-shard-00-02.uh6daca.mongodb.net:27017/?ssl=true&replicaSet=atlas-w1vyuz-shard-0&authSource=admin&appName=Care-companion-DB', tlsCAFile=certifi.where())
db = client['care-companion']
collection = db['reminders']

all_reminders = list(collection.find({}))
print(f"Total reminders: {len(all_reminders)}")
for i, rem in enumerate(all_reminders):
    print(f"\n{i+1}. UserID: {rem.get('userId')}")
    print(f"   Title: {rem.get('title')}")
    print(f"   Date: {rem.get('date')}")
    print(f"   Status: {rem.get('status')}")
    print(f"   ID: {rem.get('_id')}")
