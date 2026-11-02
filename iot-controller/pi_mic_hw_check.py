#!/usr/bin/env python3
"""Mic hardware check — same capture path as test_conversation."""
from __future__ import annotations

import os
import sys
from pathlib import Path


def load_env():
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


def main():
    load_env()
    import numpy as np
    import sounddevice as sd

    print("=== Devices ===")
    for i, d in enumerate(sd.query_devices()):
        if int(d["max_input_channels"] or 0) > 0:
            print(f"  [{i}] {d['name']} in={d['max_input_channels']}")

    raw = os.getenv("MIC_DEVICE_INDEX", "1").strip()
    dev = int(raw) if raw.lstrip("-").isdigit() else 1
    # Prefer real USB hw if env points at pulse/pipewire (common: card 3 → index 3)
    try:
        info = sd.query_devices(dev)
        name = str(info.get("name", "")).lower()
        in_ch = int(info.get("max_input_channels") or 0)
        if in_ch < 1 or any(x in name for x in ("pulse", "pipewire", "default")):
            for i, d in enumerate(sd.query_devices()):
                n = str(d.get("name", "")).lower()
                if int(d.get("max_input_channels") or 0) > 0 and "usb" in n:
                    print(f"\n⚠️ MIC_DEVICE_INDEX={dev} ({name}) silent → using USB [{i}]")
                    dev = i
                    break
    except Exception:
        pass
    sr = int(os.getenv("MIC_SAMPLE_RATE", "44100"))
    print(f"\nUsing device={dev} sr={sr}")
    print("Stay quiet 2s, then speak LOUD for 6s into the mic capsule:")
    print("  Hello hello hello how are you today\n")

    # Same style as working STT path (chunk + wait) — not one giant blocking rec
    chunk_s = 0.5
    chunk_frames = int(chunk_s * sr)
    n = 16  # 8 seconds
    voice = 0
    click = 0
    print("time   peak    rms    note")
    for i in range(n):
        kwargs = dict(
            frames=chunk_frames,
            samplerate=sr,
            channels=1,
            dtype="int16",
            blocking=True,
            device=dev,
        )
        audio = sd.rec(**kwargs)
        sd.wait()
        arr = np.asarray(audio, dtype=np.float32).flatten()
        if arr.size:
            arr -= float(np.mean(arr))
        peak = float(np.max(np.abs(arr))) if arr.size else 0.0
        rms = float(np.sqrt(np.mean(arr * arr))) if arr.size else 0.0
        t = i * chunk_s
        note = ""
        if rms >= 450 or (peak >= 2500 and rms >= 350):
            note = "VOICE?"
            voice += 1
        elif peak >= 8000 and rms < 400:
            note = "CLICK only"
            click += 1
        print(f"{t:4.1f}s {peak:7.0f} {rms:6.0f}  {note}")

    print("")
    if voice >= 3:
        print(f"✅ Mic hears voice ({voice} chunks). Run: python3 ~/test_conversation.py")
        return 0

    print("❌ No sustained voice on this capture.")
    if click:
        print(f"   Saw {click} CLICK spikes — cable noise, not speech.")
    print("")
    print("Most common on this USB card:")
    print("  1) Headset TRRS plug (phone headset) in mic jack → often SILENT/clicks")
    print("     Need a simple mono PC mic (single ring TS/TRS), not phone headset.")
    print("  2) Mic capsule 2–5 cm from mouth, speak the whole 6s")
    print("  3) alsamixer -c 3 → F4 → Mic Capture ~70% unmute")
    print("  4) Unplug/replug USB sound card, then retry")
    return 1


if __name__ == "__main__":
    sys.exit(main())
