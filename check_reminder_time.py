import pymongo
import certifi
from datetime import datetime
from dateutil import tz

client = pymongo.MongoClient('mongodb://izhan:Care1234@ac-xlohcyt-shard-00-00.uh6daca.mongodb.net:27017,ac-xlohcyt-shard-00-01.uh6daca.mongodb.net:27017,ac-xlohcyt-shard-00-02.uh6daca.mongodb.net:27017/?ssl=true&replicaSet=atlas-w1vyuz-shard-0&authSource=admin&appName=Care-companion-DB', tlsCAFile=certifi.where())
db = client['care-companion']
collection = db['reminders']

reminder = collection.find_one({'userId': '69b8e4b2e5c81157d84a5445'})
if reminder:
    utc_date = reminder.get('date')
    local_date = utc_date.astimezone(tz.tzlocal())
    now = datetime.now(tz.tzlocal())
    diff = (local_date - now).total_seconds()
    
    print('Reminder Date (UTC):', utc_date)
    print('Reminder Date (Local):', local_date.strftime('%Y-%m-%d %H:%M:%S %Z'))
    print('Current Time (Local):', now.strftime('%Y-%m-%d %H:%M:%S %Z'))
    print('Time until reminder (seconds):', diff)
else:
    print("No reminder found")
