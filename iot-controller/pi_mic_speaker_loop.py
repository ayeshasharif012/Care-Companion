#!/usr/bin/env python3
"""
Mic → Speaker loopback test (Raspberry Pi).

Speak into the USB mic; hear yourself on the speaker (Bluetooth / HDMI / USB).

Usage:
  source ~/venv/bin/activate
  python3 ~/pi_mic_speaker_loop.py           # live loop (Ctrl+C to stop)
  python3 ~/pi_mic_speaker_loop.py --once 5  # record 5s then play back
"""
from __future__ import annotations

import argparse
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


def pick_output_device(sd) -> int | None:
    """Prefer pulse/default for Bluetooth speaker; else first output device."""
    raw = os.getenv("SPEAKER_DEVICE_INDEX", "").strip()
    if raw.lstrip("-").isdigit():
        return int(raw)
    devices = sd.query_devices()
    # Prefer pulse / default (BT usually routes here on Pi)
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

    parser = argparse.ArgumentParser(description="Mic to speaker loopback")
    parser.add_argument(
        "--once",
        type=float,
        default=0,
        metavar="SEC",
        help="Record SEC seconds then play (instead of live loop)",
    )
    parser.add_argument("--gain", type=float, default=float(os.getenv("LOOP_GAIN", "2.5")))
    args = parser.parse_args()

    mic = int(os.getenv("MIC_DEVICE_INDEX", "1"))
    sr = int(os.getenv("MIC_SAMPLE_RATE", "44100"))
    out = pick_output_device(sd)
    gain = max(0.1, min(8.0, float(args.gain)))

    print("=== Mic → Speaker Loopback ===\n")
    print("Input devices:")
    for i, d in enumerate(sd.query_devices()):
        if int(d.get("max_input_channels") or 0) > 0:
            mark = " ← MIC" if i == mic else ""
            print(f"  [{i}] {d['name']}{mark}")
    print("\nOutput devices:")
    for i, d in enumerate(sd.query_devices()):
        if int(d.get("max_output_channels") or 0) > 0:
            mark = " ← SPEAKER" if out is not None and i == out else ""
            print(f"  [{i}] {d['name']}{mark}")
    print(f"\nUsing mic={mic} speaker={out} sr={sr} gain={gain}")
    print("Bluetooth speaker: volume up, connected.\n")

    if args.once and args.once > 0:
        sec = float(args.once)
        print(f"Recording {sec:.0f}s — SPEAK NOW into the mic…")
        frames = int(sec * sr)
        audio = sd.rec(
            frames,
            samplerate=sr,
            channels=1,
            dtype="float32",
            device=mic,
            blocking=True,
        )
        sd.wait()
        arr = np.asarray(audio, dtype=np.float32).flatten()
        peak = float(np.max(np.abs(arr))) if arr.size else 0.0
        print(f"Recorded peak={peak:.3f}. Playing on speaker…")
        if peak < 0.01:
            print("⚠️ Almost silent — mic not picking up. Check jack/cable/mic type.")
        arr = np.clip(arr * gain, -1.0, 1.0)
        kwargs = dict(samplerate=sr, blocking=True)
        if out is not None:
            kwargs["device"] = out
        sd.play(arr.reshape(-1, 1), **kwargs)
        sd.wait()
        print("Done. Did you hear your voice?")
        return 0

    # Live loopback
    chunk = int(0.05 * sr)  # 50ms
    print("LIVE loopback ON — speak into mic, listen on speaker.")
    print("Press Ctrl+C to stop.\n")
    try:
        with sd.InputStream(
            device=mic,
            channels=1,
            samplerate=sr,
            dtype="float32",
            blocksize=chunk,
        ) as inn, sd.OutputStream(
            device=out,
            channels=1,
            samplerate=sr,
            dtype="float32",
            blocksize=chunk,
        ) as outn:
            t0 = time.time()
            n = 0
            while True:
                data, overflowed = inn.read(chunk)
                if overflowed:
                    print("⚠️ input overflow", flush=True)
                arr = np.asarray(data, dtype=np.float32).flatten()
                peak = float(np.max(np.abs(arr))) if arr.size else 0.0
                arr = np.clip(arr * gain, -1.0, 1.0)
                outn.write(arr.reshape(-1, 1))
                n += 1
                if n % 20 == 0:  # ~1s
                    bar = int(min(30, peak * 60))
                    print(
                        f"  level={peak:.3f} {'█' * bar}{'░' * (30 - bar)}",
                        flush=True,
                    )
                if time.time() - t0 > 600:
                    print("Auto-stop after 10 min.")
                    break
    except KeyboardInterrupt:
        print("\nStopped.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
