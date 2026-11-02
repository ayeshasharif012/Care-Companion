#!/usr/bin/env python3
"""Diagnose which USB mic input is live + capture levels."""
from __future__ import annotations

import os
import subprocess
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

    print("=== Care Companion — Mic Diagnose ===\n")
    print("PortAudio devices:")
    for i, d in enumerate(sd.query_devices()):
        print(
            f"  [{i}] {d['name']!r}  in={d['max_input_channels']} "
            f"out={d['max_output_channels']} sr={d.get('default_samplerate')}"
        )

    print("\narecord -l:")
    try:
        print(subprocess.check_output(["arecord", "-l"], text=True, errors="ignore"))
    except Exception as e:
        print(f"  (failed: {e})")

    print("amixer capture (cards 0-5):")
    for card in range(6):
        try:
            out = subprocess.check_output(
                ["amixer", "-c", str(card), "sget", "Capture"],
                text=True,
                stderr=subprocess.DEVNULL,
                errors="ignore",
            )
            print(f"\n--- card {card} Capture ---")
            print(out.strip())
        except Exception:
            pass
        try:
            out = subprocess.check_output(
                ["amixer", "-c", str(card), "sget", "Mic"],
                text=True,
                stderr=subprocess.DEVNULL,
                errors="ignore",
            )
            print(f"\n--- card {card} Mic ---")
            print(out.strip())
        except Exception:
            pass

    mic_env = os.getenv("MIC_DEVICE_INDEX", "1")
    print(f"\n.env MIC_DEVICE_INDEX={mic_env} MIC_SAMPLE_RATE={os.getenv('MIC_SAMPLE_RATE')}")
    print(f"VAD_ENERGY_THRESHOLD={os.getenv('VAD_ENERGY_THRESHOLD')} USE_VAD={os.getenv('USE_VAD')}")
    if mic_env.strip().isdigit():
        idx = int(mic_env.strip())
        try:
            name = str(sd.query_devices(idx).get("name", ""))
            if any(x in name.lower() for x in ("pulse", "pipewire", "default")):
                print(
                    f"⚠️ WARNING: MIC_DEVICE_INDEX={idx} is '{name}' (often silent). "
                    "Use the USB hw index (usually 1), not arecord card number."
                )
        except Exception:
            pass

    # Probe every input-capable device for 2s peak/rms
    print("\n=== 2s level probe (stay quiet, then SPEAK loudly into DX-001) ===")
    print("Recording each input device for 2.5s...\n")
    for i, d in enumerate(sd.query_devices()):
        if int(d["max_input_channels"] or 0) < 1:
            continue
        sr = int(float(d.get("default_samplerate") or 44100))
        for try_sr in (sr, 44100, 48000, 16000):
            try:
                audio = sd.rec(
                    int(2.5 * try_sr),
                    samplerate=try_sr,
                    channels=1,
                    dtype="int16",
                    device=i,
                    blocking=True,
                )
                arr = np.asarray(audio, dtype=np.float32).flatten()
                peak = float(np.max(np.abs(arr))) if arr.size else 0
                rms = float(np.sqrt(np.mean(arr * arr))) if arr.size else 0
                flag = ""
                if peak > 5000:
                    flag = " << LOUD / likely LIVE mic"
                elif peak > 1500:
                    flag = " << some signal"
                elif peak < 200:
                    flag = " (near silent)"
                print(
                    f"  device={i} sr={try_sr} peak={peak:.0f} rms={rms:.0f}  "
                    f"{d['name']!r}{flag}"
                )
                break
            except Exception as e:
                last = str(e)
                continue
        else:
            print(f"  device={i} FAILED: {last}")

    print(
        "\nTip: red LED on cheap USB cards often = recording/activity.\n"
        "If peak stays <1500 while you shout into the mic jack, wrong jack\n"
        "or Capture muted — plug mic into PINK / MIC hole, not green headphone."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
