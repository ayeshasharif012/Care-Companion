import sqlite3
import json
import os
from datetime import datetime
from pathlib import Path

# SQLite database file
DB_PATH = Path(__file__).parent / "reminders.db"

def init_db():
    """Initialize SQLite database with tables for reminders and health tips"""
    conn = sqlite3.connect(str(DB_PATH))
    cursor = conn.cursor()

    # Reminders table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS reminders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            mongo_id TEXT,
            user_id TEXT NOT NULL,
            title TEXT NOT NULL,
            description TEXT,
            date TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            synced INTEGER DEFAULT 0
        )
    ''')

    # Check if mongo_id column exists, if not add it (migration)
    cursor.execute("PRAGMA table_info(reminders)")
    columns = [col[1] for col in cursor.fetchall()]
    if 'mongo_id' not in columns:
        try:
            cursor.execute('ALTER TABLE reminders ADD COLUMN mongo_id TEXT')
            print("✅ Migrated: Added mongo_id column to reminders table")
        except Exception as e:
            print(f"⚠️ Migration note: {e}")

    if 'language' not in columns:
        try:
            cursor.execute("ALTER TABLE reminders ADD COLUMN language TEXT DEFAULT 'english'")
            print("✅ Migrated: Added language column to reminders table")
        except Exception as e:
            print(f"⚠️ Migration note: {e}")

    # History table for completed reminders
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS reminder_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            reminder_id INTEGER,
            user_id TEXT NOT NULL,
            title TEXT NOT NULL,
            description TEXT,
            completed_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (reminder_id) REFERENCES reminders (id)
        )
    ''')

    # Health Tips table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS health_tips (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            mongo_id TEXT,
            user_id TEXT,
            language TEXT DEFAULT 'english',
            title TEXT NOT NULL,
            content TEXT,
            category TEXT,
            priority INTEGER,
            status TEXT DEFAULT 'active',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Check if user_id column exists, if not add it (migration)
    cursor.execute("PRAGMA table_info(health_tips)")
    columns = [col[1] for col in cursor.fetchall()]
    if 'user_id' not in columns:
        try:
            cursor.execute('ALTER TABLE health_tips ADD COLUMN user_id TEXT')
            print("✅ Migrated: Added user_id column to health_tips table")
        except Exception as e:
            print(f"⚠️ Migration note: {e}")
    
    if 'status' not in columns:
        try:
            cursor.execute('ALTER TABLE health_tips ADD COLUMN status TEXT DEFAULT "active"')
            print("✅ Migrated: Added status column to health_tips table")
        except Exception as e:
            print(f"⚠️ Migration note: {e}")

    conn.commit()
    conn.close()
    print("✅ SQLite database initialized")

def save_reminder_offline(user_id, title, description, date, status='pending', mongo_id=None, language='english'):
    """Save or update a reminder in SQLite (upsert by mongo_id when provided)."""
    conn = sqlite3.connect(str(DB_PATH))
    cursor = conn.cursor()
    lang = "urdu" if str(language).lower().strip() in ("urdu", "ur") else "english"
    uid = str(user_id)

    try:
        if mongo_id:
            cursor.execute('SELECT id FROM reminders WHERE mongo_id = ?', (str(mongo_id),))
            existing = cursor.fetchone()
            if existing:
                cursor.execute('''
                    UPDATE reminders
                    SET user_id = ?, title = ?, description = ?, date = ?, status = ?, language = ?, synced = 1
                    WHERE mongo_id = ?
                ''', (uid, title, description or '', str(date), status or 'pending', lang, str(mongo_id)))
                conn.commit()
                print(f"✅ Reminder updated offline ({lang}): {title}")
                return existing[0]

        cursor.execute('''
            INSERT INTO reminders (mongo_id, user_id, title, description, date, status, language, synced)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', (str(mongo_id) if mongo_id else None, uid, title, description or '', str(date), status or 'pending', lang, 1 if mongo_id else 0))

        reminder_id = cursor.lastrowid
        conn.commit()
        print(f"✅ Reminder saved offline ({lang}): {title}")
        return reminder_id
    except Exception as e:
        conn.rollback()
        print(f"❌ save_reminder_offline error: {e}")
        raise
    finally:
        conn.close()


def get_pending_reminders(user_id=None):
    """Get all pending reminders from SQLite with explicit columns mapping"""
    conn = sqlite3.connect(str(DB_PATH))
    cursor = conn.cursor()

    # Ensure language column exists for older DBs
    cursor.execute("PRAGMA table_info(reminders)")
    columns_present = [col[1] for col in cursor.fetchall()]
    has_language = 'language' in columns_present

    if has_language:
        query = '''
            SELECT id, mongo_id, user_id, title, description, date, status, created_at, synced, language
            FROM reminders
            WHERE status = 'pending'
        '''
        columns = ['id', 'mongo_id', 'user_id', 'title', 'description', 'date', 'status', 'created_at', 'synced', 'language']
    else:
        query = '''
            SELECT id, mongo_id, user_id, title, description, date, status, created_at, synced
            FROM reminders
            WHERE status = 'pending'
        '''
        columns = ['id', 'mongo_id', 'user_id', 'title', 'description', 'date', 'status', 'created_at', 'synced']

    if user_id:
        query += ' AND user_id = ?'
        cursor.execute(query, (str(user_id),))
    else:
        cursor.execute(query)

    reminders = cursor.fetchall()
    conn.close()

    result = [dict(zip(columns, row)) for row in reminders]
    for rem in result:
        if 'language' not in rem or not rem.get('language'):
            rem['language'] = 'english'
    return result

def mark_reminder_completed(reminder_id):
    """Mark a reminder as completed and add to history"""
    conn = sqlite3.connect(str(DB_PATH))
    cursor = conn.cursor()

    # Get reminder details before updating
    cursor.execute('SELECT user_id, title, description, mongo_id FROM reminders WHERE id = ?', (reminder_id,))
    reminder = cursor.fetchone()

    if reminder:
        user_id, title, description, mongo_id = reminder

        # Update status
        cursor.execute('UPDATE reminders SET status = ? WHERE id = ?', ('completed', reminder_id))

        # Add to history
        cursor.execute('''
            INSERT INTO reminder_history (reminder_id, user_id, title, description)
            VALUES (?, ?, ?, ?)
        ''', (reminder_id, user_id, title, description))

        conn.commit()
        print(f"✅ Reminder completed and added to history: {title}")
        
        # Update MongoDB via backend API (async, non-blocking)
        if mongo_id:
            try:
                import requests
                backend = (
                    os.getenv("BACKEND_URL", "").rstrip("/")
                    or "http://192.168.1.92:5000"
                )
                # Prefer Node API path; old config.py sometimes pointed at Pi itself
                try:
                    from config import BACKEND_URL as _cfg_url
                    if _cfg_url and "5002" not in str(_cfg_url):
                        backend = str(_cfg_url).rstrip("/")
                except Exception:
                    pass
                backend_url = f"{backend}/api/reminders/mark-completed"
                requests.post(backend_url, json={"reminderId": mongo_id}, timeout=2)
                print(f"✅ Updated MongoDB for reminder {mongo_id}")
            except Exception as e:
                print(f"⚠️ Failed to update MongoDB (continuing offline): {e}")

    conn.close()

def get_reminder_history(user_id=None, limit=50):
    """Get completed reminder history with explicit columns"""
    conn = sqlite3.connect(str(DB_PATH))
    cursor = conn.cursor()

    # Explicit column query
    base_query = 'SELECT id, reminder_id, user_id, title, description, completed_at FROM reminder_history'

    if user_id:
        cursor.execute(f'''
            {base_query}
            WHERE user_id = ?
            ORDER BY completed_at DESC
            LIMIT ?
        ''', (user_id, limit))
    else:
        cursor.execute(f'''
            {base_query}
            ORDER BY completed_at DESC
            LIMIT ?
        ''', (limit,))

    history = cursor.fetchall()
    conn.close()

    columns = ['id', 'reminder_id', 'user_id', 'title', 'description', 'completed_at']
    return [dict(zip(columns, row)) for row in history]

def sync_reminders_from_mongo(mongo_collection, user_id):
    """Upsert reminders from MongoDB → SQLite (no duplicates, no crash on bad rows)."""
    try:
        from bson import ObjectId

        uid = str(user_id)
        query = {"$or": [{"userId": uid}]}
        try:
            query["$or"].append({"userId": ObjectId(uid)})
        except Exception:
            pass

        mongo_reminders = list(mongo_collection.find(query))
        conn = sqlite3.connect(str(DB_PATH))
        cursor = conn.cursor()

        # Ensure language column
        cursor.execute("PRAGMA table_info(reminders)")
        cols = [c[1] for c in cursor.fetchall()]
        if "language" not in cols:
            cursor.execute("ALTER TABLE reminders ADD COLUMN language TEXT DEFAULT 'english'")

        saved = 0
        updated = 0
        remote_ids = set()

        for rem in mongo_reminders:
            try:
                mongo_id = str(rem["_id"])
                remote_ids.add(mongo_id)
                title = rem.get("title") or "Reminder"
                description = rem.get("description") or ""
                date_val = rem.get("date")
                date_str = date_val.isoformat() if hasattr(date_val, "isoformat") else str(date_val)
                status = rem.get("status") or "pending"
                lang_raw = str(rem.get("language") or "english").lower().strip()
                language = "urdu" if lang_raw in ("urdu", "ur") else "english"
                rem_user = str(rem.get("userId") or uid)

                cursor.execute("SELECT id FROM reminders WHERE mongo_id = ?", (mongo_id,))
                existing = cursor.fetchone()
                if existing:
                    cursor.execute(
                        """
                        UPDATE reminders
                        SET user_id = ?, title = ?, description = ?, date = ?, status = ?, language = ?, synced = 1
                        WHERE mongo_id = ?
                        """,
                        (rem_user, title, description, date_str, status, language, mongo_id),
                    )
                    updated += 1
                else:
                    cursor.execute(
                        """
                        INSERT INTO reminders (mongo_id, user_id, title, description, date, status, language, synced)
                        VALUES (?, ?, ?, ?, ?, ?, ?, 1)
                        """,
                        (mongo_id, rem_user, title, description, date_str, status, language),
                    )
                    saved += 1
                    print(f"💾 [Reminder] offline save ({language}): {title}")
            except Exception as row_err:
                print(f"⚠️ Skip bad reminder row: {row_err}")
                continue

        # Soft-complete local pending reminders removed from Mongo
        cursor.execute(
            "SELECT id, mongo_id, title FROM reminders WHERE user_id = ? AND status = 'pending' AND mongo_id IS NOT NULL",
            (uid,),
        )
        for local_id, local_mongo_id, title in cursor.fetchall():
            if local_mongo_id and str(local_mongo_id) not in remote_ids:
                cursor.execute(
                    "UPDATE reminders SET status = ? WHERE id = ?",
                    ("completed", local_id),
                )
                print(f"🗑️ [Reminder] removed from Mongo → marked completed locally: {title}")

        conn.commit()
        conn.close()
        print(
            f"✅ Reminder sync: mongo={len(mongo_reminders)} inserted={saved} updated={updated} user={uid}"
        )
    except Exception as e:
        print(f"❌ Reminder sync error: {e}")

def update_reminder_status(reminder_id, status):
    """Update reminder status in SQLite"""
    conn = sqlite3.connect(str(DB_PATH))
    cursor = conn.cursor()

    cursor.execute('UPDATE reminders SET status = ? WHERE id = ?', (status, reminder_id))
    conn.commit()
    conn.close()
    print(f"✅ Reminder status updated: {status}")

def delete_reminder(reminder_id):
    """Delete a reminder from SQLite"""
    conn = sqlite3.connect(str(DB_PATH))
    cursor = conn.cursor()

    cursor.execute('DELETE FROM reminders WHERE id = ?', (reminder_id,))
    conn.commit()
    conn.close()
    print("✅ Reminder deleted from offline storage")


# ==================== HEALTH TIPS FUNCTIONS ====================

def save_health_tip(title, content, language="english", category=None, priority=0, mongo_id=None, user_id=None):
    """Save a health tip to SQLite for offline use"""
    conn = sqlite3.connect(str(DB_PATH))
    cursor = conn.cursor()

    cursor.execute('''
        INSERT INTO health_tips (mongo_id, user_id, language, title, content, category, priority, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ''', (mongo_id, user_id, language, title, content, category, priority, 'active'))

    tip_id = cursor.lastrowid
    conn.commit()
    conn.close()
    print(f"✅ Health tip saved offline ({language}) for user {user_id}: {title}")
    return tip_id


def get_all_health_tips(language="english", user_id=None):
    conn = sqlite3.connect(str(DB_PATH))
    cursor = conn.cursor()

    base_query = 'SELECT id, mongo_id, user_id, language, title, content, category, priority, status, created_at FROM health_tips'
    
    # Normalize language: agar urdu hai toh 'urdu', warna 'english'
    norm_lang = "urdu" if language and language.lower() in ["urdu", "ur"] else "english"
    
    # Query: Status MUST be 'active'
    query = f'{base_query} WHERE status = "active" AND language = ?'
    params = [norm_lang]
    
    if user_id:
        query += ' AND user_id = ?'
        params.append(user_id)
        
    query += ' ORDER BY priority DESC, created_at DESC'
    
    cursor.execute(query, params)
    tips = cursor.fetchall()
    conn.close()

    columns = ['id', 'mongo_id', 'user_id', 'language', 'title', 'content', 'category', 'priority', 'status', 'created_at']
    return [dict(zip(columns, row)) for row in tips]

def sync_health_tips_from_mongo(mongo_collection, user_id=None):
    """
    Sync health tips from MongoDB → SQLite.
    - active=True  → status 'active'  (can be played)
    - active=False → status 'deleted' (never played)
    - removed from Mongo → status 'deleted'
    Logs every save / delete for AI/IoT visibility.
    """
    try:
        from bson import ObjectId

        query = {}
        if user_id:
            try:
                oid = ObjectId(user_id) if isinstance(user_id, str) else user_id
                query = {"$or": [{"createdBy": oid}, {"createdBy": str(user_id)}]}
            except Exception:
                query = {"createdBy": user_id}

        mongo_tips = list(mongo_collection.find(query))
        remote_ids = set()
        saved_count = 0
        deleted_count = 0

        conn = sqlite3.connect(str(DB_PATH))
        cursor = conn.cursor()

        for tip in mongo_tips:
            mongo_id = str(tip["_id"])
            remote_ids.add(mongo_id)
            is_active = bool(tip.get("active", True))
            tip_status = "active" if is_active else "deleted"

            tip_user = user_id
            if tip.get("createdBy") is not None:
                tip_user = str(tip.get("createdBy"))

            normalized_lang = tip.get("language", "english")
            if isinstance(normalized_lang, str):
                lang_l = normalized_lang.lower().strip()
                normalized_lang = "urdu" if ("urdu" in lang_l or lang_l == "ur") else "english"

            tip_text = (tip.get("tipText") or "").strip()
            audio_url = tip.get("audioUrl", "")
            category = tip.get("category", "")

            cursor.execute(
                "SELECT id, status FROM health_tips WHERE mongo_id = ?", (mongo_id,)
            )
            existing = cursor.fetchone()

            if existing:
                old_status = existing[1]
                cursor.execute(
                    """
                    UPDATE health_tips
                    SET user_id = ?, language = ?, title = ?, content = ?,
                        category = ?, priority = ?, status = ?
                    WHERE mongo_id = ?
                    """,
                    (
                        tip_user,
                        normalized_lang,
                        tip_text,
                        audio_url,
                        category,
                        0,
                        tip_status,
                        mongo_id,
                    ),
                )
                if tip_status == "deleted" and old_status != "deleted":
                    deleted_count += 1
                    print(f"🗑️ [HealthTip] DELETED (won't play): {tip_text[:70]}")
                elif tip_status == "active" and old_status != "active":
                    saved_count += 1
                    print(f"💾 [HealthTip] RESTORED/ACTIVE: {tip_text[:70]}")
            else:
                cursor.execute(
                    """
                    INSERT INTO health_tips
                    (mongo_id, user_id, language, title, content, category, priority, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        mongo_id,
                        tip_user,
                        normalized_lang,
                        tip_text,
                        audio_url,
                        category,
                        0,
                        tip_status,
                    ),
                )
                if tip_status == "active":
                    saved_count += 1
                    print(f"💾 [HealthTip] SAVED offline: [{normalized_lang}] {tip_text[:70]}")
                else:
                    deleted_count += 1
                    print(f"🗑️ [HealthTip] synced as deleted (skip play): {tip_text[:70]}")

        # Soft-delete local tips that vanished from Mongo for this user
        if user_id is not None:
            cursor.execute(
                'SELECT id, mongo_id, title FROM health_tips WHERE user_id = ? AND status = "active"',
                (str(user_id),),
            )
        else:
            cursor.execute(
                'SELECT id, mongo_id, title FROM health_tips WHERE status = "active"'
            )

        for local_id, local_mongo_id, title in cursor.fetchall():
            if local_mongo_id and str(local_mongo_id) not in remote_ids:
                cursor.execute(
                    'UPDATE health_tips SET status = ? WHERE id = ?',
                    ("deleted", local_id),
                )
                deleted_count += 1
                print(f"🗑️ [HealthTip] removed from Mongo → deleted locally: {(title or '')[:70]}")

        conn.commit()
        conn.close()

        active_left = 0
        conn = sqlite3.connect(str(DB_PATH))
        cursor = conn.cursor()
        if user_id:
            cursor.execute(
                'SELECT COUNT(*) FROM health_tips WHERE user_id = ? AND status = "active"',
                (str(user_id),),
            )
        else:
            cursor.execute('SELECT COUNT(*) FROM health_tips WHERE status = "active"')
        active_left = cursor.fetchone()[0]
        conn.close()

        print(
            f"✅ Health tips sync: mongo={len(mongo_tips)} saved/updated={saved_count} "
            f"deleted={deleted_count} active_playable={active_left} user={user_id}"
        )

    except Exception as e:
        print(f"❌ Health tips sync error: {e}")


def delete_health_tip(tip_id, user_id=None):
    """Soft delete a health tip (mark as deleted instead of removing)"""
    conn = sqlite3.connect(str(DB_PATH))
    cursor = conn.cursor()

    # Verify ownership if user_id provided
    if user_id:
        cursor.execute('SELECT id FROM health_tips WHERE id = ? AND user_id = ?', (tip_id, user_id))
        if not cursor.fetchone():
            conn.close()
            return False
    
    # Mark as deleted
    cursor.execute('UPDATE health_tips SET status = ? WHERE id = ?', ('deleted', tip_id))
    conn.commit()
    conn.close()
    print(f"✅ Health tip {tip_id} marked as deleted")
    return True


def get_user_health_tips_with_status(user_id, status='active'):
    """Get health tips by user and status (for display/management)"""
    conn = sqlite3.connect(str(DB_PATH))
    cursor = conn.cursor()

    query = '''SELECT id, mongo_id, user_id, language, title, content, category, priority, status, created_at 
               FROM health_tips WHERE user_id = ? AND status = ? 
               ORDER BY created_at DESC'''
    cursor.execute(query, (user_id, status))
    
    tips = cursor.fetchall()
    conn.close()

    columns = ['id', 'mongo_id', 'user_id', 'language', 'title', 'content', 'category', 'priority', 'status', 'created_at']
    return [dict(zip(columns, row)) for row in tips]


# Initialize database on import
init_db()