#!/usr/bin/env python3
"""
Restore mic settings that used to work on DX-001 USB card,
then optional live mic→speaker loop.

  source ~/venv/bin/activate
  python3 ~/pi_restore_mic.py          # restore ALSA + .env only
  python3 ~/pi_restore_mic.py --loop   # restore + live listen
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

HOME = Path.home()


def run(cmd):
    try:
        subprocess.run(cmd, check=False, capture_output=True, text=True)
    except Exception:
        pass


def restore_alsa():
    # Higher capture like when levels were strong earlier today
    run(["amixer", "-c", "3", "sset", "Auto Gain Control", "off"])
    run(["amixer", "-c", "3", "sset", "Mic", "80%", "unmute"])
    print("✅ ALSA card3: Mic Capture ~80%, unmuted, AGC OFF")


def patch_env():
    env = HOME / ".env"
    lines = env.read_text(errors="ignore").splitlines() if env.exists() else []
    want = {
        "MIC_DEVICE_INDEX": "1",
        "MIC_SAMPLE_RATE": "44100",
        "USE_VAD": "0",
        "MIC_GAIN": "3.0",
        "MIC_NORM_PEAK": "10000",
        "MIC_HIGHPASS_HZ": "80",
        "MIC_DESPIKE": "20000",
        "STT_CHUNK_RMS": "250",
        "STT_FORCE_SEND": "1",
        "STT_MIN_SPEECH_PEAK": "800",
    }
    seen = set()
    out = []
    for line in lines:
        if "=" in line and not line.strip().startswith("#"):
            k = line.split("=", 1)[0].strip()
            if k in want:
                out.append(f"{k}={want[k]}")
                seen.add(k)
                continue
        out.append(line)
    for k, v in want.items():
        if k not in seen:
            out.append(f"{k}={v}")
    env.write_text("\n".join(out) + "\n", encoding="utf-8")
    print("✅ .env mic settings restored (higher gain / softer filters)")


def live_loop():
    # Ensure env for this process
    os.environ.setdefault("MIC_DEVICE_INDEX", "1")
    os.environ.setdefault("MIC_SAMPLE_RATE", "44100")
    import numpy as np
    import sounddevice as sd

    mic = int(os.getenv("MIC_DEVICE_INDEX", "1"))
    sr = int(os.getenv("MIC_SAMPLE_RATE", "44100"))
    # Prefer pulse for BT speaker
    out_dev = None
    for i, d in enumerate(sd.query_devices()):
        name = str(d.get("name", "")).lower()
        if "pulse" in name and int(d.get("max_output_channels") or 0) > 0:
            out_dev = i
            break
    gain = 4.0
    chunk = int(0.04 * sr)
    print("\n🔊 LIVE mic → speaker (gain=4). Speak close to mic.")
    print("   Ctrl+C to stop.\n")
    with sd.InputStream(device=mic, channels=1, samplerate=sr, dtype="float32", blocksize=chunk) as inn, \
         sd.OutputStream(device=out_dev, channels=1, samplerate=sr, dtype="float32", blocksize=chunk) as ostream:
        n = 0
        while True:
            data, _ = inn.read(chunk)
            arr = np.asarray(data, dtype=np.float32).flatten()
            peak = float(np.max(np.abs(arr))) if arr.size else 0.0
            # Soft limit clicks but keep speech
            arr = np.clip(arr * gain, -0.95, 0.95)
            ostream.write(arr.reshape(-1, 1))
            n += 1
            if n % 25 == 0:
                bar = int(min(30, peak * 50))
                print(f"  mic={peak:.3f} {'█' * bar}", flush=True)


def main():
    print("=== Restore mic (previous working-style settings) ===\n")
    # Reseat tip
    print("TIP: USB sound card + mic jack UNPLUG → 3 sec → PLUG again firmly.\n")
    restore_alsa()
    patch_env()
    if "--loop" in sys.argv:
        try:
            live_loop()
        except KeyboardInterrupt:
            print("\nStopped.")
    else:
        print("\nNext:")
        print("  1) Unplug/replug USB card + mic jack")
        print("  2) python3 ~/pi_restore_mic.py --loop")
        print("     (bolte hi speaker pe apni awaaz sunni chahiye)")
        print("  3) Agar loop OK: python3 ~/test_conversation.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
