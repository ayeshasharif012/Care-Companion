#!/usr/bin/env python3
"""Optional USB mic helper — never wipe modern audio_io.py."""
from pathlib import Path

HOME = Path("/home/carecompanion")
STT = HOME / "voice" / "stt"
STT.mkdir(parents=True, exist_ok=True)
AUDIO_IO = STT / "audio_io.py"

FULL_AUDIO_IO = r'''"""Pi mic capture — USB mics need 44100/48000, not 16000."""
from __future__ import annotations
import os
import wave

WHISPER_SAMPLE_RATE = 16000


def mic_device_index():
    raw = os.getenv("MIC_DEVICE_INDEX", "").strip()
    return int(raw) if raw.lstrip("-").isdigit() else None


def capture_sample_rate(device=None):
    env = os.getenv("MIC_SAMPLE_RATE", "").strip()
    if env.isdigit():
        return int(env)
    dev = device if device is not None else mic_device_index()
    if dev is not None:
        try:
            import sounddevice as sd
            rate = int(float(sd.query_devices(dev).get("default_samplerate") or 0))
            if rate > 0:
                return rate
        except Exception:
            pass
    if mic_device_index() is not None:
        return 44100
    return WHISPER_SAMPLE_RATE


def resample_to_whisper(audio_int16, orig_sr):
    import numpy as np
    if orig_sr == WHISPER_SAMPLE_RATE:
        return audio_int16
    audio = np.asarray(audio_int16, dtype=np.float32).flatten()
    if audio.size == 0:
        return audio.astype(np.int16)
    duration = len(audio) / orig_sr
    target_len = max(1, int(duration * WHISPER_SAMPLE_RATE))
    x_old = np.linspace(0, duration, num=len(audio), endpoint=False)
    x_new = np.linspace(0, duration, num=target_len, endpoint=False)
    return np.interp(x_new, x_old, audio).astype(np.int16)


def save_wav(path, audio_int16, sample_rate):
    final = resample_to_whisper(audio_int16, sample_rate)
    with wave.open(path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(WHISPER_SAMPLE_RATE)
        wf.writeframes(final.tobytes())
    return WHISPER_SAMPLE_RATE


def normalize_int16(audio, target_peak=None, max_boost=None):
    """DC-remove + peak-normalize. Tames clipping and boosts quiet USB mics."""
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


def highpass_int16(audio, sample_rate, cutoff_hz=None):
    """Strip USB rumble/DC before STT."""
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
'''

existing = AUDIO_IO.read_text(encoding="utf-8", errors="ignore") if AUDIO_IO.exists() else ""
if "def highpass_int16" in existing and "def normalize_int16" in existing:
    print("OK audio_io.py already has normalize_int16 + highpass_int16 (not overwritten)")
else:
    AUDIO_IO.write_text(FULL_AUDIO_IO, encoding="utf-8", newline="\n")
    print("OK audio_io.py written (normalize_int16 + highpass_int16)")

print("OK .env (left to pi_fix_now)")
print("\nTest now:")
print("  python3 /home/carecompanion/test_conversation.py --seconds 5")
