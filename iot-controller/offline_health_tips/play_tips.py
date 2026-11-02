import sqlite3
import pygame
import schedule
import time
import random
import os

DB_PATH = "test-data/health_tips.db"
pygame.mixer.init()

def play_random_tip():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT audio_file FROM health_tips WHERE active = 1 ORDER BY RANDOM() LIMIT 1")
    row = c.fetchone()
    conn.close()
    if row and os.path.exists(row[0]):
        pygame.mixer.music.load(row[0])
        pygame.mixer.music.play()
        while pygame.mixer.music.get_busy():
            time.sleep(0.1)
    else:
        print("No active tips found")

# Schedule every 2 hours (adjust as needed)
#schedule.every(2).hours.do(play_random_tip)
schedule.every(20).seconds.do(play_random_tip)
if __name__ == "__main__":
    print("Health tips scheduler started")
    # Optionally play one immediately on start
    play_random_tip()
    while True:
        schedule.run_pending()
        time.sleep(10)