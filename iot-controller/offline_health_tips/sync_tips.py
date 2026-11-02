import sqlite3
import requests
import os
import json
import time

# --- Configuration ---
# Aapke current IP (192.168.0.106) ke mutabiq update kar diya gaya hai
SERVER_IP = "192.168.0.106" 
PORT = "5000"
BASE_URL = f"http://{SERVER_IP}:{PORT}"

BACKEND_URL = f"{BASE_URL}/api/health-tips"
AUDIO_DIR = "test-audio"
DB_PATH = "test-data/health_tips.db"

os.makedirs(AUDIO_DIR, exist_ok=True)
os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS health_tips
                 (id TEXT PRIMARY KEY,
                  language TEXT,
                  category TEXT,
                  tip_text TEXT,
                  audio_file TEXT,
                  active INTEGER,
                  last_updated TEXT)''')
    conn.commit()
    conn.close()

def fetch_tips():
    try:
        print(f"Fetching tips from: {BACKEND_URL}")
        resp = requests.get(BACKEND_URL, timeout=10)
        if resp.status_code == 200:
            return resp.json()
        else:
            print(f"Backend returned {resp.status_code}")
            return []
    except Exception as e:
        print(f"Error fetching tips: {e}")
        return []

def download_audio(url, local_path):
    try:
        # Full URL construct karne ke liye BASE_URL ka istemal
        full_url = f"{BASE_URL}{url}"
        r = requests.get(full_url, stream=True)
        if r.status_code == 200:
            with open(local_path, 'wb') as f:
                for chunk in r.iter_content(1024):
                    f.write(chunk)
            return True
    except Exception as e:
        print(f"Download failed for {url}: {e}")
    return False

def sync():
    init_db()
    tips = fetch_tips()
    if not tips:
        print("No tips received or backend unreachable.")
        return

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    # Existing IDs check karna
    c.execute("SELECT id, audio_file FROM health_tips")
    existing_rows = {row[0]: row[1] for row in c.fetchall()}
    fetched_ids = {tip['_id'] for tip in tips}

    # New/Updated tips process karna
    for tip in tips:
        tip_id = tip['_id']
        audio_url = tip['audioUrl']
        local_filename = os.path.join(AUDIO_DIR, f"{tip_id}.wav")

        # Agar naya tip hai ya audio file missing hai toh download karein
        if tip_id not in existing_rows or not os.path.exists(local_filename):
            print(f"Downloading tip {tip_id}...")
            if download_audio(audio_url, local_filename):
                c.execute('''INSERT OR REPLACE INTO health_tips
                             (id, language, category, tip_text, audio_file, active, last_updated)
                             VALUES (?,?,?,?,?,?,?)''',
                          (tip_id, tip.get('language'), tip.get('category'), tip.get('tipText'),
                           local_filename, 1 if tip.get('active', True) else 0,
                           tip.get('updatedAt', '')))
                conn.commit()
            else:
                print(f"Failed to download audio for {tip_id}")

    # Orphaned tips remove karna (jo backend par nahi hain)
    orphaned_ids = set(existing_rows.keys()) - fetched_ids
    for tid in orphaned_ids:
        audio_path = existing_rows[tid]
        if audio_path and os.path.exists(audio_path):
            os.remove(audio_path)
            print(f"Deleted old audio: {audio_path}")
        c.execute("DELETE FROM health_tips WHERE id = ?", (tid,))
        conn.commit()
        print(f"Removed old tip {tid} from database")

    conn.close()
    print("Sync complete successfully!")

if __name__ == "__main__":
    sync()