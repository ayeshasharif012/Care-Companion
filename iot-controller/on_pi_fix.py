#!/usr/bin/env python3
"""Paste on Pi if scp fails: python3 /home/carecompanion/on_pi_fix.py"""
from pathlib import Path
import re, os
H = Path("/home/carecompanion")
os.chdir(H)

# 1) .env
env = H / ".env"
env.touch()
keys = {"ENABLE_WAKE_WORD":"0","ENABLE_PI_EMOTION":"0","ENABLE_SOS":"0","USE_VAD":"1",
        "VAD_ENERGY_THRESHOLD":"700","VAD_MIN_SPEECH_S":"0.9","STT_MIN_WORDS":"2","STT_REJECT_SINGLE":"1"}
lines, seen = env.read_text(errors="ignore").splitlines(), set()
out = []
for line in lines:
    if "=" in line and not line.strip().startswith("#"):
        k = line.split("=",1)[0].strip()
        if k in keys:
            out.append(f"{k}={keys[k]}"); seen.add(k); continue
    out.append(line)
for k,v in keys.items():
    if k not in seen: out.append(f"{k}={v}")
env.write_text("\n".join(out)+"\n")
print("✅ .env")

# 2) vad.py
(H/"voice/stt").mkdir(parents=True, exist_ok=True)
(H/"voice/stt/vad.py").write_text('''import os
STT_MIN_WORDS=int(os.getenv("STT_MIN_WORDS","2"))
STT_REJECT_SINGLE=os.getenv("STT_REJECT_SINGLE","1").lower() in ("1","true","yes")
_BAD={"you","You","thanks for watching!","Thanks for watching!","thank you for watching!","Thank you for watching!","thank you.","Thank you.",""}
def is_hallucination(text):
    s=(text or "").strip()
    if s in _BAD or s.lower() in {x.lower() for x in _BAD}: return True
    if STT_REJECT_SINGLE:
        w=[x for x in s.split() if x.strip(".,!?;:")]
        if len(w)<STT_MIN_WORDS: return True
    return False
def record_until_silence(max_seconds=8.0, sample_rate=16000):
    import tempfile,wave,sounddevice as sd
    print(f"🎙️ VAD (max {max_seconds}s)")
    frames=int(max_seconds*sample_rate)
    a=sd.rec(frames,samplerate=sample_rate,channels=1,dtype="int16"); sd.wait()
    fd,p=tempfile.mkstemp(suffix=".wav"); os.close(fd)
    with wave.open(p,"wb") as wf:
        wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(sample_rate); wf.writeframes(a.tobytes())
    return p, len(a)/sample_rate
''', newline="\n")
print("✅ vad.py")

# 3) stt_engine patch
p = H/"voice/stt/stt_engine.py"
if p.exists():
    t = p.read_text(errors="ignore")
    if "_is_real_speech" not in t:
        t = t.replace("def listen(", '''
def _is_real_speech(text):
    try:
        from voice.stt.vad import is_hallucination
        return not is_hallucination(text)
    except ImportError:
        return len((text or "").split()) >= 2

def listen(''', 1)
    if "STT rejected" not in t:
        t = re.sub(r"text = _transcribe\(audio_path, language\)\n    if not text:",
            "text = _transcribe(audio_path, language)\n    if not text or not _is_real_speech(text):\n        if text:\n            print(f\"🚫 STT rejected: '{text.strip()}'\")", t, count=1)
    p.write_text(t, newline="\n")
    print("✅ stt_engine.py")
else:
    print("❌ Missing voice/stt/stt_engine.py — run deploy_to_pi.cmd from Windows")

# 4) main.py patch
m = H/"main.py"
if m.exists():
    t = m.read_text(errors="ignore")
    c = False
    if "ENABLE_WAKE_WORD" not in t:
        t = t.replace('EMOTION_SERVICE_URL = os.getenv("EMOTION_SERVICE_URL"',
            'ENABLE_WAKE_WORD=os.getenv("ENABLE_WAKE_WORD","0").lower() in ("1","true","yes")\n'
            'ENABLE_SOS=os.getenv("ENABLE_SOS","0").lower() in ("1","true","yes")\n'
            'ENABLE_PI_EMOTION=os.getenv("ENABLE_PI_EMOTION","0").lower() in ("1","true","yes")\n\n'
            'EMOTION_SERVICE_URL = os.getenv("EMOTION_SERVICE_URL"', 1); c=True
    if "if ENABLE_WAKE_WORD:" not in t:
        t = t.replace("    threading.Thread(target=wake_word_listener, daemon=True).start()\n    print(\"✅ Wake-word listener\")",
            "    if ENABLE_WAKE_WORD:\n        threading.Thread(target=wake_word_listener, daemon=True).start()\n        print(\"✅ Wake-word listener\")\n    else:\n        print(\"⏭️ Wake-word disabled\")", 1); c=True
    if c: m.write_text(t, newline="\n"); print("✅ main.py")
    else: print("✅ main.py already OK")

print("\nRun: python3 test_conversation.py  (say 2+ words)")
