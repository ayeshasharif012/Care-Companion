#!/bin/bash
# Run ON THE PI (after SSH):  bash /home/carecompanion/pi_quick_fix.sh
# Stops false STT like "Thanks for watching!" / "you" from wake-word loop noise.
set -e
cd /home/carecompanion

echo "=== Care Companion Pi mic noise fix ==="

# 1) Quiet mode env (wake-word / emotion / SOS off during voice testing)
grep -q "ENABLE_WAKE_WORD" .env 2>/dev/null || cat >> .env << 'EOF'

# Mic noise fix — disable always-on listeners during testing
ENABLE_WAKE_WORD=0
ENABLE_PI_EMOTION=0
ENABLE_SOS=0
USE_VAD=1
VAD_ENERGY_THRESHOLD=600
VAD_MIN_SPEECH_S=0.8
VAD_SILENCE_S=0.9
VAD_DYNAMIC_THRESHOLD=1
STT_MIN_WORDS=2
STT_REJECT_SINGLE=1
RECORD_MAX_SECONDS=6
EOF
echo "✅ .env updated"

# 2) Ensure voice/stt exists
mkdir -p voice/stt voice/tts voice/chat

# 3) Hallucination filter helper (if vad.py missing is_hallucination)
if [ ! -f voice/stt/vad.py ] || ! grep -q is_hallucination voice/stt/vad.py 2>/dev/null; then
  echo "⚠️ voice/stt/vad.py needs update — copy from Windows with scp (see below)"
fi

# 4) Patch stt_engine.py to reject hallucinations if not already patched
python3 << 'PY'
from pathlib import Path
p = Path("/home/carecompanion/voice/stt/stt_engine.py")
if not p.exists():
    print("❌ Missing voice/stt/stt_engine.py — scp from Windows PC")
    raise SystemExit(1)
text = p.read_text(encoding="utf-8")
if "_is_real_speech" in text and "is_hallucination" in text:
    print("✅ stt_engine.py already has hallucination filter")
else:
    insert = '''
def _is_real_speech(text: str) -> bool:
    try:
        from voice.stt.vad import is_hallucination
        return not is_hallucination(text)
    except ImportError:
        bad = {"you", "You", "Thanks for watching!", "Thank you.", ""}
        s = (text or "").strip()
        if s in bad:
            return False
        words = [w for w in s.split() if w.strip(".,!?;:")]
        return len(words) >= 2

'''
    if "def listen(" in text:
        text = text.replace("def listen(", insert + "def listen(", 1)
        old = '''    text = _transcribe(audio_path, language)
    if not text:
        print("ℹ️ No speech transcribed")'''
        new = '''    text = _transcribe(audio_path, language)
    if not text or not _is_real_speech(text):
        if text:
            print(f"🚫 STT rejected (noise/hallucination): '{text.strip()}'")
        else:
            print("ℹ️ No speech transcribed")'''
        if old in text:
            text = text.replace(old, new, 1)
            p.write_text(text, encoding="utf-8")
            print("✅ Patched stt_engine.py with hallucination filter")
        else:
            print("⚠️ Could not auto-patch listen() — copy fresh stt_engine.py from PC")
    else:
        print("⚠️ listen() not found in stt_engine.py")
PY

# 5) Patch main.py ENABLE_* flags if missing
python3 << 'PY'
from pathlib import Path
p = Path("/home/carecompanion/main.py")
if not p.exists():
    print("❌ main.py not found")
    raise SystemExit(1)
t = p.read_text(encoding="utf-8")
if "ENABLE_WAKE_WORD" in t:
    print("✅ main.py already has ENABLE_WAKE_WORD flags")
else:
    needle = 'EMOTION_SERVICE_URL = os.getenv("EMOTION_SERVICE_URL"'
    insert = '''ENABLE_WAKE_WORD = os.getenv("ENABLE_WAKE_WORD", "0").lower() in ("1", "true", "yes")
ENABLE_SOS = os.getenv("ENABLE_SOS", "0").lower() in ("1", "true", "yes")
ENABLE_PI_EMOTION = os.getenv("ENABLE_PI_EMOTION", "0").lower() in ("1", "true", "yes")
WAKE_RECORD_SECONDS = float(os.getenv("WAKE_RECORD_SECONDS", "4"))
WAKE_TRIGGER_COOLDOWN = float(os.getenv("WAKE_TRIGGER_COOLDOWN", "12"))

'''
    if needle in t:
        t = t.replace(needle, insert + needle, 1)
        # wrap SOS startup
        t = t.replace(
            "threading.Thread(target=start_sos_listener, daemon=True).start()\n    print(\"✅ SOS listener",
            "if ENABLE_SOS:\n        threading.Thread(target=start_sos_listener, daemon=True).start()\n        print(\"✅ SOS listener",
        )
        t = t.replace(
            "threading.Thread(target=wake_word_listener, daemon=True).start()\n    print(\"✅ Wake-word listener\")",
            "if ENABLE_WAKE_WORD:\n        threading.Thread(target=wake_word_listener, daemon=True).start()\n        print(\"✅ Wake-word listener\")\n    else:\n        print(\"⏭️ Wake-word disabled (ENABLE_WAKE_WORD=0)\")",
        )
        t = t.replace(
            "threading.Thread(target=pi_emotion_monitor_loop, daemon=True).start()\n    print(f\"✅ Pi emotion",
            "if ENABLE_PI_EMOTION:\n        threading.Thread(target=pi_emotion_monitor_loop, daemon=True).start()\n        print(f\"✅ Pi emotion",
        )
        p.write_text(t, encoding="utf-8")
        print("✅ Patched main.py with ENABLE_* flags (defaults OFF)")
    else:
        print("⚠️ Could not auto-patch main.py — copy fresh main.py from Windows PC")
PY

echo ""
echo "=== Next steps ==="
echo "1. Copy updated files from Windows (when SSH works):"
echo "   scp iot-controller/main.py carecompanion@carecompanion:/home/carecompanion/"
echo "   scp -r iot-controller/voice carecompanion@carecompanion:/home/carecompanion/"
echo "2. Test conversation ONLY (no background mic loop):"
echo "   python test_conversation.py"
echo "3. Full app (quiet mode):"
echo "   python main.py"
echo "   → should show: Wake-word disabled, Pi emotion disabled"
