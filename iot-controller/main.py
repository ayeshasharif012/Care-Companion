"""
Care Companion IoT Controller (Raspberry Pi)
Integrates: reminders sync, health tips player, SOS button, wake-word voice, emotion child process.
"""
import time
import os
import sys
import re
import asyncio
import threading
import random
import subprocess
import socket
import requests
from pathlib import Path
from flask import Flask, request, jsonify
from datetime import datetime, timezone
from dateutil import parser, tz
from flask_cors import CORS


def _load_dotenv():
    """Load /home/carecompanion/.env BEFORE reading ENABLE_* flags. Last key wins."""
    for env_path in (
        Path(__file__).resolve().parent / ".env",
        Path.home() / ".env",
        Path("/home/carecompanion/.env"),
    ):
        try:
            if not env_path.exists():
                continue
            parsed = {}
            for line in env_path.read_text(encoding="utf-8", errors="ignore").splitlines():
                line = line.strip().replace("\r", "")
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, val = line.partition("=")
                key, val = key.strip(), val.strip().strip('"').strip("'")
                if key and " " not in key:
                    parsed[key] = val
            for key, val in parsed.items():
                os.environ[key] = val
            break
        except Exception:
            continue


_load_dotenv()

# Pi USB PnP mic lock: PortAudio [1] = hw:3,0 — never pulse [3]
if sys.platform != "win32" and os.getenv("RUN_MODE", "").lower() != "local":
    try:
        from apply_pi_mic_env import apply as _apply_pi_mic

        _apply_pi_mic()
    except Exception:
        os.environ["MIC_DEVICE_INDEX"] = "1"
        os.environ.setdefault("MIC_SAMPLE_RATE", "44100")

try:
    from voice.stt.audio_io import apply_local_audio_profile

    apply_local_audio_profile()
except Exception as _audio_profile_err:
    print(f"⚠️ Local audio profile skipped: {_audio_profile_err}")

from database import collection

# Voice stack — prefer packaged modules; fall back to speech_engine
speak_stream = None
try:
    from voice.tts.tts_engine import speak, speak_stream
except Exception as _tts_err:
    print(f"⚠️ voice.tts unavailable ({_tts_err}) — using speech_engine")
    from speech_engine import speak

try:
    from voice.stt.stt_engine import listen, warmup_stt
except Exception as _stt_err:
    print(f"⚠️ STT unavailable: {_stt_err}")

    def listen(language="english", timeout=5, return_audio=False, use_vad=None):
        print("⚠️ listen() stub — install sounddevice + openai")
        return (None, None) if return_audio else None

    def warmup_stt():
        pass

try:
    from voice.chat.controller import chat_controller, generate_story, warmup_chat
except Exception as _chat_err:
    print(f"⚠️ chat_controller unavailable: {_chat_err}")

    async def chat_controller(patient_id, user_text, language="english", audio_file_path=None, emotion_override=None, return_meta=False):
        text = "I'm here with you." if "urdu" not in str(language).lower() else "میں یہاں ہوں۔"
        if return_meta:
            return {"reply": text, "emotion": emotion_override or "neutral", "confidence": 0.0}
        return text

    def generate_story(emotion="neutral", language="english"):
        return "You are safe. Take a slow breath — I am with you."

    def warmup_chat():
        pass

from sqlite_db import (
    save_reminder_offline,
    get_pending_reminders,
    mark_reminder_completed,
    get_reminder_history,
    sync_reminders_from_mongo,
    update_reminder_status,
    delete_reminder,
    get_all_health_tips,
    sync_health_tips_from_mongo,
    delete_health_tip,
    get_user_health_tips_with_status,
)

mic_lock = threading.Lock()
# True while wake greeting / conversation / emotion scan uses mic+speaker
voice_busy = threading.Event()


def _set_voice_busy(on: bool, reason: str = ""):
    if on:
        voice_busy.set()
        if reason:
            print(f"🔒 Voice session ON ({reason}) — health tips/reminders paused")
    else:
        voice_busy.clear()
        if reason:
            print(f"🔓 Voice session OFF ({reason})")


def _voice_is_busy() -> bool:
    return voice_busy.is_set()

# ---------------------------------------------------------------------------
# GPIO (SOS) — optional on non-Pi machines
# ---------------------------------------------------------------------------
GPIO_AVAILABLE = True
try:
    import RPi.GPIO as GPIO
except Exception as exc:
    GPIO_AVAILABLE = False

    class _DummyGPIO:
        BCM = "BCM"
        FALLING = "FALLING"
        IN = "IN"
        PUD_UP = "PUD_UP"
        HIGH = 1
        LOW = 0

        def setwarnings(self, *_a, **_k):
            pass

        def setmode(self, *_a, **_k):
            pass

        def setup(self, *_a, **_k):
            pass

        def input(self, *_a, **_k):
            return self.HIGH

        def add_event_detect(self, *_a, **_k):
            return False

        def cleanup(self):
            pass

    GPIO = _DummyGPIO()
    print(f"⚠️ GPIO disabled: {exc}")

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
HEALTH_TIPS_MIN_INTERVAL = int(os.getenv("HEALTH_TIPS_MIN_INTERVAL", "30"))
HEALTH_TIPS_MAX_INTERVAL = int(os.getenv("HEALTH_TIPS_MAX_INTERVAL", "90"))
WAKE_PHRASE = os.getenv("WAKE_PHRASE", "hello care companion").lower()
EMOTION_POLL_SECONDS = int(os.getenv("EMOTION_POLL_SECONDS", "25"))
EMOTION_SERVICE_URL = os.getenv("EMOTION_SERVICE_URL", "http://127.0.0.1:5001").rstrip("/")
# Wake-word needs USB mic (MIC_DEVICE_INDEX=1, MIC_SAMPLE_RATE=44100). SOS on by default.
ENABLE_WAKE_WORD = os.getenv("ENABLE_WAKE_WORD", "1").lower() in ("1", "true", "yes")
ENABLE_SOS = os.getenv("ENABLE_SOS", "1").lower() in ("1", "true", "yes")
ENABLE_PI_EMOTION = os.getenv("ENABLE_PI_EMOTION", "0").lower() in ("1", "true", "yes")
WAKE_RECORD_SECONDS = float(os.getenv("WAKE_RECORD_SECONDS", "4"))
WAKE_TRIGGER_COOLDOWN = float(os.getenv("WAKE_TRIGGER_COOLDOWN", "12"))
VOICE_CHAT_SECONDS = float(os.getenv("VOICE_CHAT_SECONDS", os.getenv("RECORD_MAX_SECONDS", "6")))
# After wake: how many listen→emotion→reply turns on the Pi mic/speaker
VOICE_CHAT_TURNS = max(1, int(os.getenv("VOICE_CHAT_TURNS", "3")))
TTS_STREAMING = os.getenv("TTS_STREAMING", "1").lower() in ("1", "true", "yes")
USE_VAD = os.getenv("USE_VAD", "1").lower() in ("1", "true", "yes")

# Windows PC running Node.js (NOT localhost on the Pi)
BACKEND_URL = os.getenv("BACKEND_URL", "http://192.168.1.92:5000").rstrip("/")
EMERGENCY_SERVER_URLS = [
    u
    for u in [
        f"{BACKEND_URL}/api/emergency/trigger-demo",
        os.getenv("EMERGENCY_URL_FALLBACK", "http://100.94.54.17:5000/api/emergency/trigger-demo"),
        "http://192.168.1.92:5000/api/emergency/trigger-demo",
    ]
    if u
]
# Deduplicate while preserving order
_seen = set()
EMERGENCY_SERVER_URLS = [u for u in EMERGENCY_SERVER_URLS if not (u in _seen or _seen.add(u))]

REMINDER_MESSAGES = {
    "urdu": {"template": "السلام عليكم! آپ کا {title} کا وقت ہو گیا ہے۔"},
    "english": {"template": "Hello! It's time for {title}."},
}

# ---------------------------------------------------------------------------
# Flask app
# ---------------------------------------------------------------------------
app = Flask(__name__)
CORS(
    app,
    resources={r"/*": {"origins": "*"}},
    supports_credentials=True,
    allow_headers=["Content-Type", "Authorization"],
    methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
)

last_active_user = None
is_online = True
user_language = "english"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def get_companion_language(user_id):
    if not user_id:
        return "english"
    try:
        from bson import ObjectId

        companions = collection.database["companions"]
        try:
            user_oid = ObjectId(user_id) if isinstance(user_id, str) else user_id
        except Exception:
            user_oid = user_id
        companion = companions.find_one({"user": user_oid})
        if companion and "language" in companion:
            lang_raw = str(companion["language"]).lower().strip()
            if any(x in lang_raw for x in ["urdu", "ur"]):
                return "urdu"
            if any(x in lang_raw for x in ["english", "en"]):
                return "english"
        return "english"
    except Exception as e:
        print(f"❌ Error fetching companion language: {e}")
        return "english"


def generate_reminder_message(title, language="english"):
    lang_key = "urdu" if language == "urdu" else "english"
    return REMINDER_MESSAGES[lang_key]["template"].format(title=title)


def perform_sync_for_user(user_id):
    """Sync reminders + health tips from Mongo → SQLite for this user."""
    global last_active_user, user_language
    if not user_id:
        return
    try:
        last_active_user = user_id
        sync_reminders_from_mongo(collection, user_id)
        user_language = get_companion_language(user_id)
        print(f"🌐 Companion language: {user_language}")
        sync_health_tips_from_mongo(collection.database["healthtips"], user_id)
        print(f"✅ Reminder + health-tips sync done for: {user_id}")
    except Exception as e:
        print(f"❌ Background sync failed for {user_id}: {e}")


# ---------------------------------------------------------------------------
# SOS — polling (edge detect fails on many Pi OS / lgpio builds)
# ---------------------------------------------------------------------------
_voice_sos_last = [0.0]


def trigger_emergency_alert():
    last_error = None
    for server_url in EMERGENCY_SERVER_URLS:
        try:
            response = requests.post(server_url, json={}, timeout=5)
            if response.ok or response.status_code in (201, 400):
                print(f"✅ Emergency alert OK ({response.status_code}) → {server_url}")
                return True
            last_error = f"{server_url} -> {response.status_code} {response.text[:200]}"
        except Exception as exc:
            last_error = f"{server_url} -> {exc}"
    print(f"❌ Emergency alert failed: {last_error}")
    return False


def _is_voice_emergency(text: str) -> bool:
    """True if user asked for SOS / emergency by voice (EN + UR)."""
    t = str(text or "").lower().strip()
    if not t:
        return False
    phrases = (
        "emergency",
        "emergencies",
        "sos",
        "help me",
        "i need help",
        "call for help",
        "send help",
        "alert caregiver",
        "alert my caregiver",
        "call caregiver",
        "call my caregiver",
        "امدادی",
        "ایمرجنسی",
        "مدد کرو",
        "مدد چاہیے",
        "SOS",
    )
    # Whole-word-ish checks for short tokens
    if re.search(r"\b(sos|emergency|emergencies)\b", t):
        return True
    return any(p.lower() in t for p in phrases if len(p) > 3)


def handle_voice_emergency(language: str = "english") -> bool:
    """
    Same backend path as GPIO SOS button.
    Debounced so repeated Whisper 'emergency' doesn't spam alerts.
    """
    now = time.time()
    if now - _voice_sos_last[0] < 5.0:
        print("⏭️ Voice SOS ignored (debounce)")
        return False
    _voice_sos_last[0] = now

    print("\n🚨 Voice SOS detected! Sending emergency (same as push button)...")
    ok = trigger_emergency_alert()
    ur = str(language).lower().startswith("ur")
    if ok:
        msg = (
            "ایمرجنسی الرٹ بھیج دیا گیا ہے۔ مدد جلد پہنچے گی۔"
            if ur
            else "Emergency alert sent. Help is on the way."
        )
    else:
        msg = (
            "ایمرجنسی بھیجنے میں مسئلہ ہوا۔ براہ کرم بٹن دبائیں۔"
            if ur
            else "Could not reach the emergency server. Please press the SOS button."
        )
    try:
        speak(msg, language)
    except Exception as exc:
        print(f"⚠️ Voice SOS speak failed: {exc}")
    return ok


def start_keyboard_sos_listener():
    """Windows / no-GPIO: type 's' + Enter in this terminal to trigger SOS."""

    def loop():
        print("⌨️ Keyboard SOS ready — type s + Enter (or POST http://127.0.0.1:5002/sos)")
        while True:
            try:
                line = sys.stdin.readline()
                if line and line.strip().lower() in ("s", "sos", "!"):
                    print("\n🚨 Keyboard SOS! Sending alert...")
                    trigger_emergency_alert()
            except Exception as exc:
                print(f"⚠️ Keyboard SOS error: {exc}")
                time.sleep(2)

    threading.Thread(target=loop, daemon=True).start()


def start_sos_listener():
    BUTTON_PIN = 4
    last_trigger = [0.0]

    def on_press(_channel=None):
        now = time.time()
        if now - last_trigger[0] < 3.0:
            return
        last_trigger[0] = now
        print("\n🚨 Button Pressed! Sending SOS...")
        trigger_emergency_alert()

    try:
        GPIO.setwarnings(False)
        GPIO.cleanup()
    except Exception:
        pass

    try:
        GPIO.setmode(GPIO.BCM)
        GPIO.setup(BUTTON_PIN, GPIO.IN, pull_up_down=GPIO.PUD_UP)
    except Exception as e:
        print(f"⚠️ Could not set up GPIO: {e}")
        return

    print("🚀 SOS Listener ACTIVE (polling GPIO 4)...")
    last_state = GPIO.input(BUTTON_PIN)
    while True:
        try:
            current = GPIO.input(BUTTON_PIN)
            if last_state == GPIO.HIGH and current == GPIO.LOW:
                on_press()
            last_state = current
            time.sleep(0.05)
        except Exception as e:
            print(f"⚠️ SOS poll error: {e}")
            time.sleep(1)


# ---------------------------------------------------------------------------
# Emotion child process (:5001)
# ---------------------------------------------------------------------------
def start_emotion_server():
    if _port_busy(5001):
        print("⚠️ [Emotion] Port 5001 already in use — assuming emotion_service is running")
        return
    here = os.path.dirname(os.path.abspath(__file__))
    home = os.path.expanduser("~")
    candidates = [
        os.path.join(here, "emotion_service.py"),
        os.path.join(here, "realtime_server.py"),
        os.path.join(home, "emotion_service.py"),
        "/home/carecompanion/emotion_service.py",
    ]
    for path in candidates:
        if os.path.exists(path):
            try:
                subprocess.Popen([sys.executable, path], cwd=os.path.dirname(path))
                print(f"✅ [Emotion] Launched {path} (:5001)")
            except Exception as exc:
                print(f"❌ [Emotion] Failed to launch {path}: {exc}")
            return
    print("ℹ️ [Emotion] No emotion_service.py found — skipped")


# ---------------------------------------------------------------------------
# Health tips player
# ---------------------------------------------------------------------------
def get_random_active_health_tip(user_id, language=None):
    """Only tips with status == 'active' in companion language are returned."""
    global user_language
    try:
        tips = get_user_health_tips_with_status(str(user_id), "active")
        want_lang = "urdu" if str(language or user_language or "english").lower().strip() in (
            "urdu",
            "ur",
        ) else "english"
        tips = [
            t
            for t in tips
            if (t.get("title") or "").strip()
            and t.get("status") == "active"
            and str(t.get("language") or "english").lower().strip() == want_lang
        ]
        if not tips:
            return None
        tip = random.choice(tips)
        print(
            f"🎲 [HealthTip] selected ({want_lang}) id={tip.get('id')} "
            f"text={(tip.get('title') or '')[:60]}"
        )
        return tip
    except Exception as exc:
        print(f"❌ Health tip fetch failed: {exc}")
        return None


def play_health_tips_loop():
    print(
        f"🌟 Health Tips Player started (every {HEALTH_TIPS_MIN_INTERVAL}s–{HEALTH_TIPS_MAX_INTERVAL}s)"
    )
    global last_active_user, user_language
    time.sleep(HEALTH_TIPS_MIN_INTERVAL)
    while True:
        try:
            if not last_active_user:
                time.sleep(10)
                continue

            # Re-sync so deletes from the app stop playing quickly
            try:
                sync_health_tips_from_mongo(
                    collection.database["healthtips"], last_active_user
                )
            except Exception as sync_err:
                print(f"⚠️ Health tip re-sync skipped: {sync_err}")

            tip = get_random_active_health_tip(last_active_user, user_language)
            if tip and tip.get("status") == "active":
                text = (tip.get("title") or "").strip()
                lang = tip.get("language") or user_language or "english"
                if text:
                    if _voice_is_busy():
                        print("⏭️ [HealthTip] skipped — voice conversation active")
                    else:
                        # Hold mic_lock so tip TTS cannot overlap STT / wake
                        acquired = mic_lock.acquire(blocking=False)
                        if not acquired:
                            print("⏭️ [HealthTip] skipped — mic busy")
                        else:
                            try:
                                if _voice_is_busy():
                                    print("⏭️ [HealthTip] skipped — voice conversation active")
                                else:
                                    print(f"💡 [HealthTip] PLAYING ({lang}): {text[:80]}")
                                    speak(text, lang)
                            finally:
                                mic_lock.release()
                else:
                    print("⏭️ [HealthTip] skip empty tip text")
            else:
                print(
                    f"⚠️ [HealthTip] no ACTIVE {user_language} tips to play "
                    "(other languages / deleted tips are ignored)"
                )

            time.sleep(random.randint(HEALTH_TIPS_MIN_INTERVAL, HEALTH_TIPS_MAX_INTERVAL))
        except Exception as e:
            print(f"❌ Health Tips Loop Error: {e}")
            time.sleep(60)


# ---------------------------------------------------------------------------
# Reminder worker
# ---------------------------------------------------------------------------
def check_reminders_loop():
    print("🕵️ Reminder Worker Started...")
    global last_active_user, user_language
    while True:
        try:
            current_lang = (
                get_companion_language(last_active_user) if last_active_user else "english"
            )
            if current_lang != user_language:
                user_language = current_lang

            reminders = (
                get_pending_reminders(last_active_user)
                if last_active_user
                else get_pending_reminders()
            )
            if reminders:
                now = datetime.now(tz.tzlocal())
                # Log soonest pending so timezone issues are visible
                try:
                    soonest = min(
                        (
                            parser.isoparse(r["date"])
                            if isinstance(r.get("date"), str)
                            else r["date"]
                        )
                        for r in reminders
                        if r.get("date")
                    )
                    if getattr(soonest, "tzinfo", None) is None:
                        soonest = soonest.replace(tzinfo=timezone.utc)
                    soonest_local = soonest.astimezone(tz.tzlocal())
                    secs = (soonest_local - now).total_seconds()
                    if abs(secs) < 120 or int(time.time()) % 60 < 6:
                        print(
                            f"🕵️ Pending={len(reminders)} | next={soonest_local.strftime('%H:%M:%S')} "
                            f"({secs:+.0f}s) | now={now.strftime('%H:%M:%S')}"
                        )
                except Exception:
                    pass

                for rem in reminders:
                    try:
                        db_date_str = rem["date"]
                        db_date = (
                            parser.isoparse(db_date_str)
                            if isinstance(db_date_str, str)
                            else db_date_str
                        )
                        if db_date.tzinfo is None:
                            db_date = db_date.replace(tzinfo=timezone.utc)
                        local_db_time = db_date.astimezone(tz.tzlocal())
                        time_diff = (now - local_db_time).total_seconds()
                        # 90s window — Pi clock / sync jitter
                        if 0 <= time_diff <= 90:
                            title = rem["title"]
                            rem_lang_raw = str(rem.get("language") or current_lang or "english").lower().strip()
                            rem_lang = "urdu" if rem_lang_raw in ("urdu", "ur") else "english"
                            print(f"🔔 TRIGGER: {title} | lang={rem_lang} | due={local_db_time}")
                            if _voice_is_busy():
                                # Keep pending; avoid spamming the same line every 5s
                                continue
                            with mic_lock:
                                if _voice_is_busy():
                                    continue
                                speak(generate_reminder_message(title, rem_lang), rem_lang)
                            mark_reminder_completed(rem["id"])
                            print(f"✅ Reminder {rem['id']} completed.")
                    except Exception as rem_err:
                        print(f"⚠️ Reminder skip: {rem_err}")
                        continue
        except Exception as e:
            print(f"❌ Reminder loop error: {e}")
        time.sleep(5)


# ---------------------------------------------------------------------------
# Voice chat
# ---------------------------------------------------------------------------
def _run_async(coro):
    """Run async coroutine from sync Flask/threads without FastAPI dependency."""
    try:
        return asyncio.run(coro)
    except RuntimeError:
        loop = asyncio.new_event_loop()
        try:
            return loop.run_until_complete(coro)
        finally:
            loop.close()


def _speak_reply(text: str, language: str):
    """TTS with streaming when enabled (lower latency)."""
    if not text:
        print("⚠️ [PIPELINE] TTS skipped — empty LLM reply")
        return
    print(f"🔊 [PIPELINE] Step 3/3 TTS — speaking LLM reply on Pi speaker...")
    if TTS_STREAMING and speak_stream:
        try:
            speak_stream(text, language)
            print("✅ [PIPELINE] TTS playing complete (stream)")
            return
        except Exception as exc:
            print(f"⚠️ [PIPELINE] Stream TTS fallback: {exc}")
    speak(text, language)
    print("✅ [PIPELINE] TTS playing complete")


def _warmup_voice_stack():
    """Pre-load OpenAI clients — faster first voice turn."""
    try:
        from voice.openai_util import log_openai_key_status

        log_openai_key_status()
    except Exception as exc:
        print(f"⚠️ OpenAI key check: {exc}")
    try:
        warmup_stt()
        print("✅ STT warmed up (Whisper via OpenAI key)")
    except Exception as exc:
        print(f"⚠️ STT warmup: {exc}")
    try:
        from voice.tts.tts_engine import warmup_tts
        warmup_tts()
        print("✅ TTS warmed up (OpenAI nova)")
    except Exception as exc:
        print(f"⚠️ TTS warmup: {exc}")
    try:
        warmup_chat()
        print("✅ Chat client warmed up (OpenAI ChatGPT)")
    except Exception as exc:
        print(f"⚠️ Chat warmup: {exc}")


async def voice_chat_interaction(patient_id, language="en", recording_timeout=None, turns=None):
    """
    Full loop: Pi mic → Whisper STT → emotion(:5001) → OpenAI ChatGPT → TTS speaker.
    Logs each stage so breaks are easy to spot.
    """
    _set_voice_busy(True, "conversation")
    try:
        timeout = float(recording_timeout or VOICE_CHAT_SECONDS)
        n_turns = max(1, int(turns if turns is not None else VOICE_CHAT_TURNS))
        loop = asyncio.get_event_loop()
        vad = USE_VAD
        turns_out = []
        last_emotion = "neutral"

        print(
            f"🔁 [PIPELINE] Starting conversation loop "
            f"user={patient_id} lang={language} turns={n_turns} vad={vad}"
        )

        for turn_i in range(n_turns):
            print(f"——— Turn {turn_i + 1}/{n_turns} ———")
            print("🎙️ [PIPELINE] Step 1/3 STT — listening on Pi mic → Whisper...")

            def _listen():
                with mic_lock:
                    return listen(
                        language=language,
                        timeout=timeout,
                        return_audio=True,
                        use_vad=vad,
                    )

            listen_result = await loop.run_in_executor(None, _listen)
            if isinstance(listen_result, tuple):
                text, audio_path = listen_result
            else:
                text, audio_path = listen_result, None

            if not text:
                print("❌ [PIPELINE] STT failed / No speech — loop stop for this turn")
                if turn_i == 0:
                    return {"status": "error", "message": "No speech detected"}
                break

            print(f"✅ [PIPELINE] STT success: {str(text)[:160]!r}")
            if audio_path:
                print(f"📁 [PIPELINE] Audio clip for emotion/STT: {audio_path}")

            # Voice SOS — same path as GPIO push button
            low = str(text).lower()
            if _is_voice_emergency(text):
                print("🚨 [PIPELINE] Emergency phrase in conversation")
                await loop.run_in_executor(
                    None, lambda: handle_voice_emergency(language)
                )
                turns_out.append(
                    {
                        "user_text": text,
                        "bot_response": "Emergency alert sent",
                        "emotion": "sad",
                    }
                )
                break

            # Soft goodbye / stop phrases
            if any(w in low for w in ("goodbye", "bye", "stop", "خدا حافظ", "الوداع", "بس")):
                bye = (
                    "ٹھیک ہے، میں یہاں ہوں جب آپ کو ضرورت ہو۔"
                    if str(language).lower().startswith("ur")
                    else "Alright — I'm here whenever you need me."
                )
                print("👋 [PIPELINE] Goodbye phrase — speaking farewell")
                await loop.run_in_executor(None, lambda: _speak_reply(bye, language))
                turns_out.append({"user_text": text, "bot_response": bye, "emotion": last_emotion})
                break

            print("🧠 [PIPELINE] Step 2/3 LLM — emotion + OpenAI ChatGPT...")
            result = await chat_controller(
                patient_id=patient_id,
                user_text=text,
                language=language,
                audio_file_path=audio_path,
                return_meta=True,
            )
            if isinstance(result, dict):
                bot_response = result.get("reply") or ""
                last_emotion = result.get("emotion") or last_emotion
                conf = result.get("confidence") or 0
            else:
                bot_response = str(result or "")
                conf = 0

            if not bot_response:
                print("❌ [PIPELINE] OpenAI returned empty reply")
                bot_response = (
                    "میں یہاں ہوں۔"
                    if str(language).lower().startswith("ur")
                    else "I'm here with you."
                )
            else:
                print(f"✅ [PIPELINE] OpenAI response received: {bot_response[:160]!r}")

            await loop.run_in_executor(None, lambda t=bot_response: _speak_reply(t, language))
            turns_out.append(
                {
                    "user_text": text,
                    "bot_response": bot_response,
                    "emotion": last_emotion,
                    "confidence": conf,
                }
            )
            print(
                f"✅ [PIPELINE] Turn {turn_i + 1}/{n_turns} complete "
                f"emotion={last_emotion} conf={conf}"
            )

            # Clean up temp wav from STT if present
            if audio_path:
                try:
                    os.remove(audio_path)
                except Exception:
                    pass

            # Prompt for next turn (except last)
            if turn_i < n_turns - 1:
                nudge = (
                    "اور کچھ کہنا چاہیں گے؟"
                    if str(language).lower().startswith("ur")
                    else "Would you like to say anything else?"
                )
                await loop.run_in_executor(None, lambda: _speak_reply(nudge, language))

        if not turns_out:
            return {"status": "error", "message": "No speech detected"}

        last = turns_out[-1]
        print("✅ [PIPELINE] Conversation loop finished OK")
        return {
            "status": "success",
            "user_text": last.get("user_text"),
            "bot_response": last.get("bot_response"),
            "emotion": last.get("emotion") or last_emotion,
            "turns": turns_out,
        }
    except Exception as e:
        print(f"❌ [PIPELINE] Voice Chat Error: {e}")
        return {"status": "error", "message": str(e)}
    finally:
        _set_voice_busy(False, "conversation done")


def wake_word_listener():
    global user_language, last_active_user
    print(f"👂 Wake Word Listener ready (phrase: '{WAKE_PHRASE}')...")
    last_trigger_at = 0.0
    while True:
        try:
            if not ENABLE_WAKE_WORD:
                time.sleep(5)
                continue
            if not last_active_user:
                # Do not keep transcribing random room audio before a user is active.
                time.sleep(3)
                continue
            if _voice_is_busy():
                time.sleep(1)
                continue

            # IMPORTANT: release mic_lock BEFORE speak/conversation
            # (conversation also needs mic_lock — holding it here = deadlock)
            with mic_lock:
                result = listen(
                    language="english",
                    timeout=WAKE_RECORD_SECONDS,
                    use_vad=USE_VAD,
                )
            text = result[0] if isinstance(result, tuple) else result
            text_norm = str(text or "").lower().strip()
            if not text_norm:
                time.sleep(0.5)
                continue
            print(f"👂 Heard: {text_norm[:80]}")
            try:
                from voice.stt.vad import is_hallucination

                if is_hallucination(text):
                    print(f"🚫 Wake ignored hallucination: {text_norm[:60]!r}")
                    continue
            except Exception:
                pass

            # Voice SOS works even without wake phrase (critical safety)
            if _is_voice_emergency(text_norm):
                handle_voice_emergency(user_language)
                continue

            if time.time() - last_trigger_at < WAKE_TRIGGER_COOLDOWN:
                continue
            wake_hit = (
                text_norm == WAKE_PHRASE
                or WAKE_PHRASE in text_norm
                or ("care companion" in text_norm and "hello" in text_norm)
                or (text_norm.startswith("hello") and "companion" in text_norm)
                or ("hello" in text_norm and "companion" in text_norm)
            )
            if wake_hit:
                print("✅ Wake word detected!")
                last_trigger_at = time.time()
                _set_voice_busy(True, "wake")
                try:
                    greet = (
                        "السلام علیکم! میں آپ کی کیا مدد کر سکتی ہوں؟"
                        if str(user_language).lower().startswith("ur")
                        else "Hello! How can I help you?"
                    )
                    speak(greet, user_language)
                    if last_active_user:
                        _run_async(voice_chat_interaction(last_active_user, user_language))
                    else:
                        speak("Please log in on the app first.", user_language)
                finally:
                    _set_voice_busy(False, "wake done")
        except Exception as e:
            print(f"⚠️ Wake listener: {e}")
            time.sleep(10)
        time.sleep(1)


# ---------------------------------------------------------------------------
# Pi microphone → emotion → MongoDB (via Node /api/emotion/save)
# ---------------------------------------------------------------------------
def _record_emotion_wav(seconds=3.0):
    try:
        import tempfile
        import numpy as np
        import sounddevice as sd
        from voice.stt.audio_io import capture_sample_rate, mic_device_index, save_wav

        dev = mic_device_index()
        cap_sr = capture_sample_rate(dev)
        frames = int(seconds * cap_sr)
        kwargs = dict(frames=frames, samplerate=cap_sr, channels=1, dtype="int16")
        if dev is not None:
            kwargs["device"] = dev
        audio = sd.rec(**kwargs)
        sd.wait()
        fd, path = tempfile.mkstemp(suffix=".wav")
        os.close(fd)
        save_wav(path, audio, cap_sr)
        return path
    except Exception as exc:
        print(f"⚠️ Emotion mic record failed: {exc}")
        return None


def pi_emotion_monitor_loop():
    """Periodically capture Pi mic, classify on :5001, save to Mongo via backend."""
    print(f"🎭 Pi emotion monitor every {EMOTION_POLL_SECONDS}s → Mongo")
    time.sleep(8)
    while True:
        try:
            if not ENABLE_PI_EMOTION:
                time.sleep(5)
                continue
            if not last_active_user:
                time.sleep(5)
                continue

            wav_path = None
            with mic_lock:
                wav_path = _record_emotion_wav(3.0)

            if not wav_path:
                time.sleep(EMOTION_POLL_SECONDS)
                continue

            mood, confidence = "neutral", 0.4
            try:
                with open(wav_path, "rb") as f:
                    files = {"audio": ("audio.wav", f, "audio/wav")}
                    r = requests.post(
                        f"{EMOTION_SERVICE_URL}/predict",
                        files=files,
                        timeout=25,
                    )
                if r.ok:
                    data = r.json() or {}
                    mood = str(data.get("mood") or "neutral").lower().strip()
                    confidence = float(data.get("confidence") or 0.5)
            except Exception as pred_err:
                print(f"⚠️ Emotion predict skipped: {pred_err}")
            finally:
                try:
                    os.remove(wav_path)
                except Exception:
                    pass

            if mood not in ("happy", "sad", "angry", "neutral"):
                mood = "neutral"

            try:
                save_r = requests.post(
                    f"{BACKEND_URL}/api/emotion/save",
                    json={
                        "userId": last_active_user,
                        "emotion": mood,
                        "confidence": confidence,
                    },
                    timeout=8,
                )
                if save_r.ok:
                    print(f"💾 Pi emotion → Mongo: {mood} ({confidence:.2f})")
                else:
                    print(f"⚠️ Emotion save HTTP {save_r.status_code}: {save_r.text[:120]}")
            except Exception as save_err:
                print(f"⚠️ Emotion save failed: {save_err}")

        except Exception as e:
            print(f"❌ Emotion monitor error: {e}")
        time.sleep(EMOTION_POLL_SECONDS)


# ---------------------------------------------------------------------------
# HTTP API
# ---------------------------------------------------------------------------
@app.route("/set-user", methods=["POST"])
def set_active_user():
    global last_active_user, is_online, user_language
    data = request.json or {}
    user_id = data.get("userId")
    if not user_id:
        return jsonify({"status": "error", "message": "User ID required"}), 400
    last_active_user = user_id
    is_online = True
    try:
        user_language = get_companion_language(user_id)
    except Exception:
        user_language = "english"
    print(f"👤 Synced user={user_id} | lang={user_language}")
    threading.Thread(target=perform_sync_for_user, args=(user_id,), daemon=True).start()
    return jsonify(
        {
            "status": "success",
            "activeUser": user_id,
            "language": user_language,
            "sync": "started",
        }
    ), 200


@app.route("/sync-reminders", methods=["POST"])
@app.route("/api/sync-reminders", methods=["POST"])
def sync_reminders():
    global last_active_user
    data = request.json or {}
    user_id = data.get("userId") or last_active_user
    if not user_id:
        return jsonify({"status": "error", "message": "No active user"}), 400
    threading.Thread(target=perform_sync_for_user, args=(user_id,), daemon=True).start()
    return jsonify({"status": "success", "message": "Sync started"}), 200


@app.route("/sync-health-tips", methods=["POST"])
@app.route("/api/sync-health-tips", methods=["POST"])
def sync_health_tips_endpoint():
    data = request.json or {}
    user_id = data.get("userId") or last_active_user
    if not user_id:
        return jsonify({"status": "error", "message": "No userId"}), 400
    try:
        sync_health_tips_from_mongo(collection.database["healthtips"], user_id)
        return jsonify({"status": "success", "user": user_id}), 200
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/add-reminder-offline", methods=["POST"])
@app.route("/api/reminders", methods=["POST"])
def add_reminder_offline():
    data = request.json or {}
    user_id = data.get("userId") or last_active_user
    title = data.get("title")
    description = data.get("description", "")
    date = data.get("date")
    status = data.get("status", "pending")
    mongo_id = data.get("mongoId") or data.get("mongo_id")
    lang_raw = str(data.get("language") or user_language or "english").lower().strip()
    language = "urdu" if lang_raw in ("urdu", "ur") else "english"
    if not all([user_id, title, date]):
        return jsonify({"status": "error", "message": "Missing userId/title/date"}), 400
    try:
        try:
            reminder_id = save_reminder_offline(
                user_id,
                title,
                description,
                date,
                status=status,
                mongo_id=mongo_id,
                language=language,
            )
        except TypeError:
            # Old sqlite_db.py on Pi without language= — still save reminder
            print("⚠️ sqlite_db missing language= — updating Pi copy recommended")
            reminder_id = save_reminder_offline(
                user_id, title, description, date, status=status, mongo_id=mongo_id
            )
        return jsonify(
            {
                "status": "success",
                "reminder_id": reminder_id,
                "language": language,
                "mongoId": mongo_id,
            }
        ), 201
    except Exception as e:
        print(f"❌ Offline reminder save error: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/get-reminders-offline", methods=["GET"])
def get_reminders_offline():
    user_id = request.args.get("userId") or last_active_user
    if not user_id:
        return jsonify({"status": "error", "message": "No user"}), 400
    try:
        return jsonify({"status": "success", "reminders": get_pending_reminders(user_id)}), 200
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/update-reminder-offline/<int:reminder_id>", methods=["PUT"])
def update_reminder_offline(reminder_id):
    status = (request.json or {}).get("status")
    if status not in ["pending", "completed"]:
        return jsonify({"status": "error", "message": "Invalid status"}), 400
    try:
        if status == "completed":
            mark_reminder_completed(reminder_id)
        else:
            update_reminder_status(reminder_id, status)
        return jsonify({"status": "success"}), 200
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/delete-reminder-offline/<int:reminder_id>", methods=["DELETE"])
def delete_reminder_offline(reminder_id):
    try:
        delete_reminder(reminder_id)
        return jsonify({"status": "success"}), 200
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/reminder-history", methods=["GET"])
def get_history():
    user_id = request.args.get("userId") or last_active_user
    limit = int(request.args.get("limit", 50))
    if not user_id:
        return jsonify({"status": "error", "message": "No user"}), 400
    try:
        return jsonify({"status": "success", "history": get_reminder_history(user_id, limit)}), 200
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/health-tips", methods=["GET"])
@app.route("/api/health-tips", methods=["GET"])
def get_offline_health_tips():
    global user_language, last_active_user
    language = (request.args.get("language") or user_language or "english").lower().strip()
    user_id_param = request.args.get("userId") or last_active_user
    try:
        tips = get_all_health_tips(language, user_id_param)
        return jsonify(
            {"status": "success", "tips": tips, "language": language, "user": user_id_param}
        ), 200
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/user-health-tips", methods=["GET"])
@app.route("/api/user-health-tips", methods=["GET"])
def get_user_health_tips():
    user_id = request.args.get("userId") or last_active_user
    if not user_id:
        return jsonify({"status": "error", "message": "No user"}), 400
    try:
        tips = get_user_health_tips_with_status(user_id, "active")
        return jsonify({"status": "success", "tips": tips, "user": user_id}), 200
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/delete-health-tip/<int:tip_id>", methods=["DELETE"])
@app.route("/api/health-tips/<int:tip_id>", methods=["DELETE"])
def delete_health_tip_api(tip_id):
    user_id = request.args.get("userId") or last_active_user
    if not user_id:
        return jsonify({"status": "error", "message": "No user"}), 400
    try:
        if delete_health_tip(tip_id, user_id):
            return jsonify({"status": "success"}), 200
        return jsonify({"status": "error", "message": "Not found"}), 404
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/play-reminder", methods=["POST"])
def play_reminder_explicitly():
    data = request.json or {}
    title = data.get("title", "Notification")
    lang = data.get("language", user_language)
    try:
        speak(generate_reminder_message(title, lang), lang)
        return jsonify({"status": "success"}), 200
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/play-health-tip", methods=["POST"])
def play_health_tip_now():
    data = request.json or {}
    user_id = data.get("userId") or last_active_user
    if not user_id:
        return jsonify({"status": "error", "message": "No active user"}), 400
    tip = get_random_active_health_tip(user_id, user_language)
    if not tip:
        return jsonify({"status": "error", "message": f"No active health tips in {user_language}"}), 404
    text = (tip.get("title") or "").strip()
    lang = tip.get("language") or user_language or "english"
    try:
        speak(text, lang)
        return jsonify({"status": "success", "tip": text, "language": lang}), 200
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/speak", methods=["POST"])
def speak_endpoint():
    data = request.get_json(silent=True) or {}
    text = (data.get("text") or "").strip()
    language = data.get("language") or user_language or "english"
    if not text:
        return jsonify({"status": "error", "message": "text required"}), 400
    try:
        speak(text, language)
        return jsonify({"status": "success"}), 200
    except Exception as exc:
        return jsonify({"status": "error", "message": str(exc)}), 500


@app.route("/sos", methods=["POST", "GET"])
@app.route("/api/sos", methods=["POST", "GET"])
def sos_http_trigger():
    """Manual / app SOS — same path as GPIO button."""
    ok = trigger_emergency_alert()
    if ok:
        return jsonify({"status": "success", "message": "Emergency alert sent"}), 200
    return jsonify(
        {
            "status": "error",
            "message": "Failed to reach backend",
            "tried": EMERGENCY_SERVER_URLS,
            "backend": BACKEND_URL,
        }
    ), 502


@app.route("/api/voice/chat", methods=["POST"])
def voice_chat_endpoint():
    data = request.json or {}
    companion_id = data.get("companion") or data.get("patient_id") or last_active_user
    lang = data.get("language") or user_language or "english"
    timeout = data.get("seconds") or data.get("timeout") or VOICE_CHAT_SECONDS
    turns = data.get("turns")
    if not companion_id:
        return jsonify({"status": "error", "message": "companion id required — login/set-user first"}), 400
    if _voice_is_busy():
        print("⏭️ /api/voice/chat rejected — voice session already active (wake/chat)")
        return jsonify(
            {
                "status": "busy",
                "message": "Pi is already in a voice conversation — try again in a moment",
            }
        ), 409
    print(f"🎙️ Voice chat start user={companion_id} lang={lang} sec={timeout} turns={turns or VOICE_CHAT_TURNS}")
    return jsonify(_run_async(voice_chat_interaction(companion_id, lang, timeout, turns)))


@app.route("/api/emotion/scan", methods=["POST"])
@app.route("/emotion/scan", methods=["POST"])
def emotion_scan_endpoint():
    """
    Record from Pi microphone → classify on :5001 → save Mongo.
    Mobile app should call this instead of using the phone mic.
    """
    data = request.json or {}
    user_id = data.get("userId") or last_active_user
    seconds = float(data.get("seconds") or 3.0)
    if not user_id:
        return jsonify({"status": "error", "message": "userId required — login/set-user first"}), 400

    wav_path = None
    _set_voice_busy(True, "emotion scan")
    try:
        with mic_lock:
            wav_path = _record_emotion_wav(seconds)
        if not wav_path:
            return jsonify({"status": "error", "message": "Pi mic record failed"}), 500

        mood, confidence = "neutral", 0.4
        try:
            with open(wav_path, "rb") as f:
                r = requests.post(
                    f"{EMOTION_SERVICE_URL}/predict",
                    files={"audio": ("audio.wav", f, "audio/wav")},
                    timeout=25,
                )
            if r.ok:
                body = r.json() or {}
                mood = str(body.get("mood") or "neutral").lower().strip()
                confidence = float(body.get("confidence") or 0.5)
        except Exception as pred_err:
            return jsonify({"status": "error", "message": f"predict failed: {pred_err}"}), 502

        if mood not in ("happy", "sad", "angry", "neutral"):
            mood = "neutral"

        save_r = requests.post(
            f"{BACKEND_URL}/api/emotion/save",
            json={"userId": user_id, "emotion": mood, "confidence": confidence},
            timeout=8,
        )
        if not save_r.ok:
            print(f"⚠️ Emotion save HTTP {save_r.status_code}: {save_r.text[:120]}")

        print(f"🎭 App-triggered Pi scan → {mood} ({confidence:.2f})")
        return jsonify(
            {
                "status": "success",
                "emotion": mood,
                "confidence": confidence,
                "userId": user_id,
                "source": "pi_mic",
            }
        ), 200
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500
    finally:
        _set_voice_busy(False, "emotion scan done")
        if wav_path:
            try:
                os.remove(wav_path)
            except Exception:
                pass


@app.route("/api/story", methods=["POST"])
@app.route("/story", methods=["POST"])
def story_endpoint():
    """Generate + speak an emotion-based calming story on the Pi speaker."""
    data = request.json or {}
    emotion = (data.get("emotion") or "neutral").lower().strip()
    language = data.get("language") or user_language or "english"
    speak_it = bool(data.get("speak", True))
    _set_voice_busy(True, "story")
    try:
        user_id = data.get("userId") or last_active_user
        if user_id and not data.get("emotion"):
            try:
                r = requests.get(
                    f"{BACKEND_URL}/api/emotion/latest/{user_id}", timeout=4
                )
                if r.ok:
                    emotion = (
                        ((r.json() or {}).get("emotion") or {}).get("emotion")
                        or emotion
                    )
            except Exception:
                pass

        story = generate_story(emotion=emotion, language=language)
        if speak_it and story:
            _speak_reply(story, language)
        return jsonify(
            {
                "status": "success",
                "story": story,
                "emotion": emotion,
                "language": language,
                "played_on": "pi" if speak_it else None,
            }
        ), 200
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500
    finally:
        _set_voice_busy(False, "story done")


@app.route("/health", methods=["GET"])
def health():
    return jsonify(
        {
            "status": "ok",
            "activeUser": last_active_user,
            "language": user_language,
            "backend": BACKEND_URL,
        }
    ), 200


# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------
def _port_busy(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.3)
        return sock.connect_ex(("127.0.0.1", port)) == 0


if __name__ == "__main__":
    print("🚀 Starting Care Companion IoT services...")
    try:
        from voice.stt.audio_io import mic_device_index, capture_sample_rate

        _mic = mic_device_index()
        _sr = capture_sample_rate(_mic)
        print(
            f"🎤 Mic index={_mic if _mic is not None else 'default'} "
            f"sr={_sr} "
            f"VAD={'on' if USE_VAD else 'off'} "
            f"TTS_stream={'on' if TTS_STREAMING else 'off'}"
        )
    except Exception:
        print(
            f"🎤 Mic index={os.getenv('MIC_DEVICE_INDEX', 'default')} "
            f"sr={os.getenv('MIC_SAMPLE_RATE', 'auto')} "
            f"VAD={'on' if USE_VAD else 'off'} "
            f"TTS_stream={'on' if TTS_STREAMING else 'off'}"
        )

    threading.Thread(target=_warmup_voice_stack, daemon=True).start()

    if _port_busy(5002):
        print("❌ Port 5002 busy. Free it then retry:")
        print("   jobs -l ; kill %1 ; sudo fuser -k 5002/tcp")
        print("   Tip: stop with Ctrl+C — never Ctrl+Z")
        sys.exit(1)

    threading.Thread(target=check_reminders_loop, daemon=True).start()
    print("✅ Reminder worker started")

    threading.Thread(target=play_health_tips_loop, daemon=True).start()
    print(f"✅ Health tips player ({HEALTH_TIPS_MIN_INTERVAL}s–{HEALTH_TIPS_MAX_INTERVAL}s)")

    if ENABLE_SOS:
        if GPIO_AVAILABLE and sys.platform.startswith("linux"):
            threading.Thread(target=start_sos_listener, daemon=True).start()
            print("✅ SOS listener (GPIO 4 polling)")
        elif os.getenv("ENABLE_KEYBOARD_SOS", "1").lower() in ("1", "true", "yes"):
            threading.Thread(target=start_keyboard_sos_listener, daemon=True).start()
            print("✅ SOS keyboard listener (type s + Enter, or POST /sos)")
        else:
            print("⏭️ SOS disabled on this platform (set ENABLE_KEYBOARD_SOS=1)")
    else:
        print("⏭️ SOS listener disabled by ENABLE_SOS=0")

    if ENABLE_WAKE_WORD:
        threading.Thread(target=wake_word_listener, daemon=True).start()
        print("✅ Wake-word listener")
    else:
        print("⏭️ Wake-word listener disabled by ENABLE_WAKE_WORD=0")

    # Emotion Flask (:5001) — needed by phone app via backend proxy (always if file exists)
    start_emotion_server()
    if ENABLE_PI_EMOTION:
        threading.Thread(target=pi_emotion_monitor_loop, daemon=True).start()
        print(f"✅ Pi emotion → Mongo every {EMOTION_POLL_SECONDS}s")
    else:
        print("⏭️ Pi emotion background loop off (ENABLE_PI_EMOTION=0) — live emotion runs during Pi voice chat")

    print(f"🌐 Backend SOS target: {BACKEND_URL}")
    print("📡 /set-user /sync-reminders /sync-health-tips /health-tips")
    print("   /play-health-tip /speak /api/voice/chat /api/emotion/scan /api/story /sos /health")
    print("🌐 Listening 0.0.0.0:5002")

    try:
        app.run(host="0.0.0.0", port=5002, use_reloader=False)
    except KeyboardInterrupt:
        print("\n🛑 Stopping...")
    except OSError as e:
        print(f"❌ Bind failed: {e}")
        print("   sudo fuser -k 5002/tcp")
        sys.exit(1)
