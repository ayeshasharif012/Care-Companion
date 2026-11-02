#!/usr/bin/env python3
"""
Hardware audio check for Care Companion Pi.

1) Speaker beep  → confirms Bluetooth/HDMI/USB speaker path
2) Mic record    → live meter while you speak / scratch mic
3) Playback      → you hear what was recorded
4) Verdict       → SPEAKER_OK / MIC_FAIL / MIC_OK

Usage:
  source ~/venv/bin/activate
  python3 ~/pi_audio_hw_test.py
"""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path


def load_env() -> None:
    for p in (Path.home() / ".env", Path("/home/carecompanion/.env")):
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


def pick_output(sd):
    raw = os.getenv("SPEAKER_DEVICE_INDEX", "").strip()
    if raw.lstrip("-").isdigit():
        return int(raw)
    devices = sd.query_devices()
    for name in ("pulse", "default", "pipewire"):
        for i, d in enumerate(devices):
            if name in str(d.get("name", "")).lower() and int(d.get("max_output_channels") or 0) > 0:
                return i
    for i, d in enumerate(devices):
        if int(d.get("max_output_channels") or 0) > 0:
            return i
    return None


def main() -> int:
    load_env()
    import numpy as np
    import sounddevice as sd

    mic = int(os.getenv("MIC_DEVICE_INDEX", "1"))
    sr = int(os.getenv("MIC_SAMPLE_RATE", "44100"))
    out = pick_output(sd)

    print("=" * 52)
    print("  Care Companion — AUDIO HARDWARE TEST")
    print("=" * 52)
    print(f"  MIC device     = {mic}")
    print(f"  SPEAKER device = {out}")
    print(f"  Sample rate    = {sr}")
    print("=" * 52)

    # ----- 1) SPEAKER -----
    print("\n[1/3] SPEAKER TEST")
    print("  You should hear 3 beeps on Bluetooth speaker…")
    t = np.linspace(0, 0.25, int(sr * 0.25), endpoint=False)
    beep = (0.35 * np.sin(2 * np.pi * 880 * t)).astype(np.float32)
    silence = np.zeros(int(sr * 0.2), dtype=np.float32)
    tone = np.concatenate([beep, silence, beep, silence, beep])
    try:
        kwargs = dict(samplerate=sr, blocking=True)
        if out is not None:
            kwargs["device"] = out
        sd.play(tone.reshape(-1, 1), **kwargs)
        sd.wait()
        print("  ✅ Speaker play finished.")
        print("  → Agar 3 beeps SUNAI DIE: SPEAKER OK")
        print("  → Agar kuch nahi suna: Bluetooth volume / pairing check karo")
    except Exception as exc:
        print(f"  ❌ Speaker FAILED: {exc}")
        return 1

    time.sleep(0.5)

    # ----- 2) MIC -----
    print("\n[2/3] MIC RECORD (6 seconds)")
    print("  Ab mic pe ZOR SE bolo: Hello hello hello")
    print("  YA mic capsule ko ungli se SCRATCH karo.\n")
    frames = int(6 * sr)
    chunk = int(0.5 * sr)
    parts = []
    max_peak = 0.0
    max_rms = 0.0
    for i in range(frames // chunk):
        audio = sd.rec(
            chunk,
            samplerate=sr,
            channels=1,
            dtype="float32",
            device=mic,
            blocking=True,
        )
        sd.wait()
        arr = np.asarray(audio, dtype=np.float32).flatten()
        peak = float(np.max(np.abs(arr))) if arr.size else 0.0
        rms = float(np.sqrt(np.mean(arr * arr))) if arr.size else 0.0
        max_peak = max(max_peak, peak)
        max_rms = max(max_rms, rms)
        bar = int(min(30, peak * 40))
        flag = " << LOUD" if peak > 0.15 else ""
        print(f"  [{i*0.5:3.1f}s] peak={peak:.3f} rms={rms:.3f} {'█'*bar}{flag}", flush=True)
        parts.append(arr)

    recorded = np.concatenate(parts) if parts else np.zeros(0, dtype=np.float32)
    # Soft gain for playback (but don't explode clicks)
    play = np.clip(recorded * 3.0, -1.0, 1.0)

    # Save wav for aplay
    out_wav = Path.home() / "hw_mic_test.wav"
    try:
        import wave

        pcm = (play * 32767.0).astype(np.int16)
        with wave.open(str(out_wav), "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(sr)
            wf.writeframes(pcm.tobytes())
        print(f"\n  Saved {out_wav}")
    except Exception as exc:
        print(f"  (wav save failed: {exc})")

    # ----- 3) PLAYBACK -----
    print("\n[3/3] PLAYBACK — jo record hua woh speaker pe…")
    try:
        kwargs = dict(samplerate=sr, blocking=True)
        if out is not None:
            kwargs["device"] = out
        sd.play(play.reshape(-1, 1), **kwargs)
        sd.wait()
        print("  ✅ Playback finished.")
    except Exception as exc:
        print(f"  ❌ Playback FAILED: {exc}")
        return 1

    # ----- VERDICT -----
    print("\n" + "=" * 52)
    print("  VERDICT")
    print("=" * 52)
    print(f"  max_peak={max_peak:.3f}  max_rms={max_rms:.3f}")

    # peak=1.0 alone is often a click; need sustained rms
    if max_peak < 0.05 and max_rms < 0.02:
        print("  ❌ MIC FAIL — almost silent (no voice captured)")
        print("  SPEAKER: OK (beeps played)")
        print("  FIX: dusra PC mic / cable / USB sound card try karo")
        print("       Phone headset (TRRS) usually DOES NOT work on this card.")
        return 2

    if max_peak >= 0.95 and max_rms < 0.08:
        print("  ❌ MIC FAIL — only CLICKS/noise spikes, not speech")
        print("  SPEAKER: OK")
        print("  FIX: mic capsule not delivering voice (wrong plug type / dead mic)")
        return 2

    if max_rms < 0.05:
        print("  ❌ MIC WEAK/FAIL — noise only, speech not in signal")
        print("  SPEAKER: OK")
        print("  Agar playback mein apni awaaz NAHI suni → MIC hardware issue")
        return 2

    print("  ✅ Levels look usable.")
    print("  → Agar playback mein APNI AWAZ suni: MIC OK")
    print("  → Agar sirf hiss/click suna: MIC FAIL (software nahi, hardware)")
    print("=" * 52)
    print(f"  Replay anytime:  aplay {out_wav}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
