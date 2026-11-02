#!/usr/bin/env python3
"""Run ON THE PI:  python3 /home/carecompanion/pi_fix_now.py
Fixes false STT + disables noisy background mic loops. No bash/CRLF issues.
"""
from __future__ import annotations

import os
import re
from pathlib import Path

HOME = Path("/home/carecompanion")


def load_env_file():
    """Rewrite critical keys; keep LAST value wins; drop broken lines."""
    env_path = HOME / ".env"
    env_path.touch(exist_ok=True)
    raw_lines = env_path.read_text(encoding="utf-8", errors="ignore").splitlines()

    # Parse existing KEY=VAL (last wins)
    existing = {}
    other = []
    for line in raw_lines:
        s = line.strip().replace("\r", "")
        if not s or s.startswith("#"):
            other.append(line)
            continue
        if "=" not in s:
            other.append(f"# BROKEN_REMOVED: {s}")
            continue
        k, _, v = s.partition("=")
        k, v = k.strip(), v.strip().strip('"').strip("'")
        if not k or " " in k or not k.replace("_", "").isalnum():
            other.append(f"# BROKEN_REMOVED: {s}")
            continue
        existing[k] = v

    # Force these (fix wake/STT hallucinations + backend)
    forced = {
        "ENABLE_WAKE_WORD": "1",
        "ENABLE_PI_EMOTION": "0",
        "ENABLE_SOS": "1",
        "USE_VAD": "0",
        "MIC_DEVICE_INDEX": "1",
        "MIC_SAMPLE_RATE": "44100",
        "MIC_GAIN": "5.0",
        "MIC_NORM_PEAK": "12000",
        "VOICE_CHAT_SECONDS": "5",
        "RECORD_MAX_SECONDS": "5",
        "TTS_STREAMING": "1",
        "TTS_VOLUME": "100",
        "CHAT_SKIP_EMOTION": "0",
        "CHAT_MAX_TOKENS": "80",
        "BACKEND_URL": existing.get("BACKEND_URL")
        if str(existing.get("BACKEND_URL", "")).startswith("http://100.")
        else "http://100.94.54.17:5000",
        # Fixed capture is more reliable on DX-001 than VAD alone
        "VAD_ENERGY_THRESHOLD": "400",
        "VAD_MIN_SPEECH_S": "2.0",
        "VAD_MIN_KEEP_S": "2.5",
        "VAD_SILENCE_S": "1.4",
        "VAD_DYNAMIC_THRESHOLD": "1",
        "VAD_THRESHOLD_CAP": "12000",
        "VAD_DYNAMIC_MULTIPLIER": "1.15",
        "VAD_NOISE_MARGIN": "1.12",
        "VAD_NOISE_PAD": "280",
        "VAD_NOISE_FLOOR_CHUNKS": "8",
        "VAD_FALLBACK_FIXED": "1",
        "MIC_HIGHPASS_HZ": "280",
        "MIC_DESPIKE": "14000",
        "STT_MIN_SPEECH_PEAK": "900",
        "STT_MIN_SPEECH_RMS": "200",
        "STT_CHUNK_RMS": "280",
        "STT_FORCE_SEND": "1",
        "WHISPER_TEMPERATURE": "0",
        "WHISPER_NO_SPEECH_THRESHOLD": "0.85",
        "STT_SILENCE_PEAK": "400",
        "STT_SILENCE_RMS": "120",
        "STT_MIN_WORDS": "2",
        "STT_REJECT_SINGLE": "1",
    }
    existing.update(forced)

    # Preserve secrets / other keys
    out = ["# Care Companion Pi .env (auto-cleaned)", ""]
    # Important secrets first if present
    for k in ("OPENAI_API_KEY", "MONGO_URI", "JWT_SECRET"):
        if k in existing:
            out.append(f"{k}={existing.pop(k)}")
    out.append("")
    for k in sorted(forced.keys()):
        out.append(f"{k}={existing.pop(k)}")
    out.append("")
    for k in sorted(existing.keys()):
        out.append(f"{k}={existing[k]}")

    env_path.write_text("\n".join(out) + "\n", encoding="utf-8", newline="\n")
    print("✅ .env cleaned + USE_VAD=0 (fixed metered capture), Mic~62%, AGC off")
    print("   (broken lines removed — was causing dotenv parse error)")


VAD_PY = r'''"""VAD + hallucination filter."""
from __future__ import annotations
import os, tempfile, wave
from typing import Optional, Tuple

SAMPLE_RATE = int(os.getenv("VAD_SAMPLE_RATE", "16000"))
CHUNK_MS = int(os.getenv("VAD_CHUNK_MS", "100"))
MIN_SPEECH_S = float(os.getenv("VAD_MIN_SPEECH_S", "0.9"))
SILENCE_S = float(os.getenv("VAD_SILENCE_S", "0.9"))
ENERGY_THRESHOLD = float(os.getenv("VAD_ENERGY_THRESHOLD", "700"))
DYNAMIC_THRESHOLD = os.getenv("VAD_DYNAMIC_THRESHOLD", "1").lower() in ("1", "true", "yes")
NOISE_FLOOR_CHUNKS = int(os.getenv("VAD_NOISE_FLOOR_CHUNKS", "8"))
STT_MIN_WORDS = int(os.getenv("STT_MIN_WORDS", "2"))
STT_REJECT_SINGLE = os.getenv("STT_REJECT_SINGLE", "1").lower() in ("1", "true", "yes")
_HALLUCINATIONS = {"you", "You", "you.", "You.", "thanks for watching!", "Thanks for watching!",
    "thank you for watching!", "Thank you for watching!", "thank you.", "Thank you.", ""}

def _rms(raw: bytes) -> float:
    import numpy as np
    arr = np.frombuffer(raw, dtype=np.int16).astype(np.float32)
    return float(np.sqrt(np.mean(arr * arr))) if arr.size else 0.0

def is_hallucination(text: str) -> bool:
    s = (text or "").strip()
    if s in _HALLUCINATIONS or s.lower() in {x.lower() for x in _HALLUCINATIONS}:
        return True
    if STT_REJECT_SINGLE:
        words = [w for w in s.split() if w.strip(".,!?;:")]
        if len(words) < STT_MIN_WORDS:
            return True
    return False

def _measure_noise_floor(sample_rate: int) -> float:
    import numpy as np, sounddevice as sd
    chunk_frames = int(sample_rate * CHUNK_MS / 1000)
    energies = []
    for _ in range(NOISE_FLOOR_CHUNKS):
        chunk = sd.rec(chunk_frames, samplerate=sample_rate, channels=1, dtype="int16", blocking=True)
        sd.wait()
        energies.append(_rms(chunk.tobytes()))
    return float(np.mean(energies)) if energies else 0.0

def record_until_silence(max_seconds: float = 8.0, sample_rate: int = SAMPLE_RATE):
    import sounddevice as sd
    chunk_frames = int(sample_rate * CHUNK_MS / 1000)
    max_chunks = int(max_seconds * 1000 / CHUNK_MS)
    min_speech_chunks = max(1, int(MIN_SPEECH_S * 1000 / CHUNK_MS))
    silence_chunks_needed = max(1, int(SILENCE_S * 1000 / CHUNK_MS))
    threshold = ENERGY_THRESHOLD
    if DYNAMIC_THRESHOLD:
        floor = _measure_noise_floor(sample_rate)
        if floor > 0:
            threshold = max(ENERGY_THRESHOLD, floor * 3.5)
            print(f"🔇 noise floor={floor:.0f} threshold={threshold:.0f}")
    print(f"🎙️ VAD (max {max_seconds:.1f}s) — speak 2+ words clearly")
    buffers, speech_started, silent_run, speech_chunks = [], False, 0, 0
    for _ in range(max_chunks):
        chunk = sd.rec(chunk_frames, samplerate=sample_rate, channels=1, dtype="int16", blocking=True)
        sd.wait()
        raw = chunk.tobytes()
        energy = _rms(raw)
        if energy >= threshold:
            speech_started, silent_run = True, 0
            speech_chunks += 1
            buffers.append(raw)
        elif speech_started:
            buffers.append(raw)
            silent_run += 1
            if silent_run >= silence_chunks_needed and speech_chunks >= min_speech_chunks:
                break
    if not buffers or speech_chunks < min_speech_chunks:
        return None, 0.0
    audio = b"".join(buffers)
    fd, path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    with wave.open(path, "wb") as wf:
        wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(sample_rate); wf.writeframes(audio)
    return path, len(audio) / (sample_rate * 2)
'''


def write_vad():
    p = HOME / "voice" / "stt" / "vad.py"
    p.parent.mkdir(parents=True, exist_ok=True)
    existing = p.read_text(encoding="utf-8", errors="ignore") if p.exists() else ""
    # Never overwrite Windows-deployed modern VAD (has live meter / NOISE_MARGIN)
    if "NOISE_MARGIN" in existing or "Speak a FULL sentence NOW" in existing or "peak_energy" in existing:
        print("✅ voice/stt/vad.py already modern (skip overwrite)")
        return
    if "اردو رسم" in existing and "is_hallucination" in existing and "THRESHOLD_CAP" in existing:
        print("✅ voice/stt/vad.py already has hallucination filter (skip overwrite)")
        return
    print("⚠️ vad.py looks old — scp voice/stt/vad.py from Windows (not rewriting embedded old copy)")


def patch_stt_engine():
    p = HOME / "voice" / "stt" / "stt_engine.py"
    if not p.exists():
        print("❌ Missing voice/stt/stt_engine.py — copy voice/ folder from Windows PC")
        return False
    t = p.read_text(encoding="utf-8", errors="ignore")
    # Already has modern pipeline from Windows deploy — do not rewrite
    if "_normalize_int16" in t or "Normalize peak" in t or "Whisper raw text" in t:
        print("✅ stt_engine.py already up to date (skip patch)")
        return True
    # Kill long Urdu Whisper prompt that gets echoed as fake STT
    t2 = t.replace(
        'kwargs["prompt"] = "یہ اردو گفتگو ہے۔ صرف اردو رسم الخط میں لکھیں۔"',
        'kwargs["prompt"] = "اردو۔"',
    )
    if t2 != t:
        t = t2
        print("✅ Removed long Urdu Whisper prompt")
    if "_is_real_speech" not in t:
        block = '''
def _is_real_speech(text: str) -> bool:
    try:
        from voice.stt.vad import is_hallucination
        return not is_hallucination(text)
    except ImportError:
        return len((text or "").split()) >= 2

'''
        t = t.replace("def listen(", block + "def listen(", 1)
    if "STT rejected" not in t:
        t = re.sub(
            r"text = _transcribe\(audio_path, language\)\n    if not text:",
            "text = _transcribe(audio_path, language)\n"
            "    if not text or not _is_real_speech(text):\n"
            "        if text:\n"
            '            print(f"🚫 STT rejected: \'{text.strip()}\'")',
            t,
            count=1,
        )
    p.write_text(t, encoding="utf-8", newline="\n")
    print("✅ stt_engine.py patched")
    return True


def patch_main():
    p = HOME / "main.py"
    t = p.read_text(encoding="utf-8", errors="ignore")
    changed = False

    if "_load_dotenv" not in t:
        insert = '''
def _load_dotenv():
    from pathlib import Path
    for env_path in (Path(__file__).resolve().parent / ".env", Path("/home/carecompanion/.env")):
        if not env_path.exists():
            continue
        for line in env_path.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                k, v = k.strip(), v.strip().strip('"').strip("'")
                if k and k not in os.environ:
                    os.environ[k] = v
        break

_load_dotenv()

'''
        if "from database import collection" in t:
            t = t.replace("from database import collection", insert + "from database import collection", 1)
            changed = True

    if "ENABLE_WAKE_WORD" not in t:
        t = t.replace(
            'EMOTION_SERVICE_URL = os.getenv("EMOTION_SERVICE_URL"',
            'ENABLE_WAKE_WORD = os.getenv("ENABLE_WAKE_WORD", "0").lower() in ("1", "true", "yes")\n'
            'ENABLE_SOS = os.getenv("ENABLE_SOS", "0").lower() in ("1", "true", "yes")\n'
            'ENABLE_PI_EMOTION = os.getenv("ENABLE_PI_EMOTION", "0").lower() in ("1", "true", "yes")\n\n'
            'EMOTION_SERVICE_URL = os.getenv("EMOTION_SERVICE_URL"',
            1,
        )
        changed = True

    if "if ENABLE_SOS:" not in t and "start_sos_listener" in t:
        t = t.replace(
            "    threading.Thread(target=start_sos_listener, daemon=True).start()\n    print(\"✅ SOS listener",
            "    if ENABLE_SOS:\n        threading.Thread(target=start_sos_listener, daemon=True).start()\n        print(\"✅ SOS listener",
            1,
        )
        t = t.replace(
            "    threading.Thread(target=wake_word_listener, daemon=True).start()\n    print(\"✅ Wake-word listener\")",
            "    if ENABLE_WAKE_WORD:\n        threading.Thread(target=wake_word_listener, daemon=True).start()\n        print(\"✅ Wake-word listener\")\n    else:\n        print(\"⏭️ Wake-word disabled (ENABLE_WAKE_WORD=0)\")",
            1,
        )
        t = t.replace(
            "    threading.Thread(target=pi_emotion_monitor_loop, daemon=True).start()\n    print(f\"✅ Pi emotion",
            "    if ENABLE_PI_EMOTION:\n        threading.Thread(target=pi_emotion_monitor_loop, daemon=True).start()\n        print(f\"✅ Pi emotion",
            1,
        )
        changed = True

    if changed:
        p.write_text(t, encoding="utf-8", newline="\n")
        print("✅ main.py patched")
    else:
        print("✅ main.py already OK")
    return True


def write_test_mic():
    """Always rewrite test_mic.py — old copy used sr=16000 and crashed USB mic."""
    path = HOME / "test_mic.py"
    path.write_text(
        r'''#!/usr/bin/env python3
"""USB mic check — tries 44100/48000 (never assumes 16000)."""
from __future__ import annotations
import os, sys, tempfile, wave
from pathlib import Path

def _load_dotenv():
    for p in (Path("/home/carecompanion/.env"), Path.home() / ".env"):
        if not p.exists():
            continue
        for line in p.read_text(errors="ignore").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                k, v = k.strip(), v.strip().strip('"').strip("'")
                if k and k not in os.environ:
                    os.environ[k] = v
        break

def main():
    _load_dotenv()
    import numpy as np
    import sounddevice as sd

    print("=== Care Companion — Mic Check ===\n")
    devices = sd.query_devices()
    for i, d in enumerate(devices):
        print(f"  {i}: {d['name']} in={d['max_input_channels']} sr={d.get('default_samplerate')}")

    env_idx = os.getenv("MIC_DEVICE_INDEX", "1").strip()
    mic_idx = int(env_idx) if env_idx.lstrip("-").isdigit() else 1
    print(f"\nUsing device={mic_idx}")
    seconds = float(os.getenv("MIC_TEST_SECONDS", "4"))
    preferred = int(os.getenv("MIC_SAMPLE_RATE", "44100") or "44100")
    rates = []
    for r in (preferred, 44100, 48000, 32000):
        if r not in rates:
            rates.append(r)

    print(f"\n>>> Speak LOUDLY for {seconds:.0f}s NOW <<<\n")
    audio, sr, last_err = None, None, None
    for rate in rates:
        frames = int(seconds * rate)
        try:
            print(f"  trying sr={rate} ...", end=" ", flush=True)
            audio = sd.rec(frames, samplerate=rate, channels=1, dtype="int16",
                           device=mic_idx, blocking=True)
            sd.wait()
            audio = np.asarray(audio).flatten()
            sr = rate
            print("OK")
            break
        except Exception as exc:
            print(f"FAIL ({exc})")
            last_err = exc
    if audio is None:
        raise SystemExit(f"No working sample rate: {last_err}")

    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    rms = float(np.sqrt(np.mean(audio.astype(np.float32) ** 2))) if audio.size else 0.0
    print(f"\nResult: sr={sr} peak={peak:.0f} rms={rms:.0f}")
    if peak < 300:
        print("FAIL: almost silent")
    elif peak < 1500:
        print("WARNING: quiet — speak closer (want peak 2000+)")
    else:
        print("OK: mic hearing you")

    fd, wav_path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    with wave.open(wav_path, "wb") as wf:
        wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(sr)
        wf.writeframes(audio.tobytes())
    print(f"Saved: {wav_path}")

    if os.getenv("OPENAI_API_KEY") and peak >= 400:
        try:
            from openai import OpenAI
            client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
            with open(wav_path, "rb") as f:
                r = client.audio.transcriptions.create(model="whisper-1", file=f, language="en", temperature=0)
            print(f"Whisper: >>> {(r.text or '').strip() or '(empty)'} <<<")
        except Exception as exc:
            print(f"Whisper failed: {exc}")

    print(f"\nKeep in .env:\n  MIC_DEVICE_INDEX={mic_idx}\n  MIC_SAMPLE_RATE={sr}\n  USE_VAD=1\n  MIC_GAIN=3.0")

if __name__ == "__main__":
    main()
''',
        encoding="utf-8",
        newline="\n",
    )
    os.chmod(path, 0o755)
    print("✅ test_mic.py rewritten (USB-safe sample rates)")


def tune_alsa_mic():
    """DX-001: Mic ~62%, AGC OFF (AGC raises rumble and false peaks)."""
    import subprocess

    cmds = [
        ["amixer", "-c", "3", "sset", "Auto Gain Control", "off"],
        ["amixer", "-c", "3", "sset", "Mic", "65%", "unmute"],
    ]
    for cmd in cmds:
        try:
            subprocess.run(cmd, check=False, capture_output=True, text=True)
        except Exception:
            pass
    print("✅ ALSA card3: Mic ~65% unmute, Auto Gain Control OFF")


def main():
    print("=== Pi fix (Python) ===")
    os.chdir(HOME)
    load_env_file()
    tune_alsa_mic()
    write_vad()
    write_test_mic()
    # Do NOT run old pi_mic_fix first — it used to wipe normalize_int16 + set USE_VAD=0
    mic_fix = HOME / "pi_mic_fix.py"
    if mic_fix.exists():
        import runpy

        runpy.run_path(str(mic_fix), run_name="__main__")
    # Re-apply env AFTER mic_fix so USE_VAD=1 always wins
    load_env_file()
    # Ensure audio_io has normalize even if mic_fix was old
    ensure_audio_io_normalize()
    patch_stt_engine()
    patch_main()
    print("\nDone. Now run ONE command at a time:")
    print("  python3 /home/carecompanion/test_conversation.py")
    print("  (expect: USE_VAD=0, live peak meter, then Whisper text)")
    print("  python3 /home/carecompanion/main.py")


def ensure_audio_io_normalize():
    path = HOME / "voice" / "stt" / "audio_io.py"
    if not path.exists():
        print("⚠️ missing voice/stt/audio_io.py — scp voice/ from Windows")
        return
    text = path.read_text(encoding="utf-8", errors="ignore")
    changed = False
    if "def normalize_int16" not in text:
        text = text.rstrip() + """


def normalize_int16(audio, target_peak=None, max_boost=None):
    import numpy as np
    arr = np.asarray(audio, dtype=np.float32).flatten()
    if arr.size == 0:
        return arr.astype(np.int16)
    arr -= float(np.mean(arr))
    peak = float(np.max(np.abs(arr)))
    if peak < 1.0:
        return arr.astype(np.int16)
    target = float(target_peak if target_peak is not None else os.getenv("MIC_NORM_PEAK", "10000"))
    boost_cap = float(max_boost if max_boost is not None else os.getenv("MIC_GAIN", "3.0"))
    scale = target / peak
    if scale > boost_cap:
        scale = boost_cap
    out = np.clip(arr * scale, -32767, 32767)
    print(f"🎚️ Normalize peak {peak:.0f} → {float(np.max(np.abs(out))):.0f} (x{scale:.2f})")
    return out.astype(np.int16)
"""
        changed = True
        print("✅ audio_io.py — added normalize_int16")
    if "def highpass_int16" not in text:
        text = text.rstrip() + """


def highpass_int16(audio, sample_rate, cutoff_hz=None):
    import numpy as np
    arr = np.asarray(audio, dtype=np.float32).flatten()
    if arr.size < 8:
        return arr.astype(np.int16)
    cut = float(cutoff_hz if cutoff_hz is not None else os.getenv("MIC_HIGHPASS_HZ", "120"))
    if cut <= 0 or sample_rate <= 0:
        return arr.astype(np.int16)
    rc = 1.0 / (2.0 * np.pi * cut)
    dt = 1.0 / float(sample_rate)
    alpha = rc / (rc + dt)
    y = np.empty_like(arr)
    y[0] = 0.0
    prev_y = 0.0
    prev_x = float(arr[0])
    for i in range(1, arr.size):
        x = float(arr[i])
        prev_y = alpha * (prev_y + x - prev_x)
        y[i] = prev_y
        prev_x = x
    return np.clip(y, -32767, 32767).astype(np.int16)
"""
        changed = True
        print("✅ audio_io.py — added highpass_int16")
    if changed:
        path.write_text(text, encoding="utf-8", newline="\n")
    else:
        print("OK audio_io.py has normalize_int16 + highpass_int16")


if __name__ == "__main__":
    main()
