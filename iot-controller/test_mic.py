#!/usr/bin/env python3
"""Pi microphone check — run: python3 ~/test_mic.py

USB mics on Pi usually need 44100/48000 — NEVER 16000.
"""
from __future__ import annotations

import os
import sys
import tempfile
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _load_dotenv():
    for p in (ROOT / ".env", Path("/home/carecompanion/.env"), Path.home() / ".env"):
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


def pick_usb_mic(devices) -> int | None:
    for i, d in enumerate(devices):
        name = str(d.get("name", "")).lower()
        if d.get("max_input_channels", 0) > 0 and "usb" in name:
            return i
    for i, d in enumerate(devices):
        if d.get("max_input_channels", 0) > 0:
            return i
    return None


def record_try_rates(mic_idx: int, seconds: float, preferred: int):
    """Try sample rates USB mics actually accept."""
    import numpy as np
    import sounddevice as sd

    # Prefer 44100/48000 — 16000 almost always fails on USB Audio Device
    candidates = []
    for r in (preferred, 44100, 48000, 32000, 16000):
        if r and r not in candidates:
            candidates.append(int(r))

    last_err = None
    for sr in candidates:
        frames = int(seconds * sr)
        try:
            print(f"  trying sr={sr} ...", end=" ", flush=True)
            audio = sd.rec(
                frames,
                samplerate=sr,
                channels=1,
                dtype="int16",
                device=mic_idx,
                blocking=True,
            )
            sd.wait()
            print("OK")
            return np.asarray(audio).flatten(), sr
        except Exception as exc:
            print(f"FAIL ({exc})")
            last_err = exc
    raise RuntimeError(f"No working sample rate for device {mic_idx}: {last_err}")


def main():
    _load_dotenv()
    import numpy as np
    import sounddevice as sd

    print("=== Care Companion — Mic Check ===\n")
    devices = sd.query_devices()
    default_in, default_out = sd.default.device

    print("All devices:")
    for i, d in enumerate(devices):
        mark = ""
        if i == default_in:
            mark += " [DEFAULT IN]"
        if i == default_out:
            mark += " [DEFAULT OUT]"
        print(
            f"  {i}: {d['name']} — in={d['max_input_channels']}, "
            f"out={d['max_output_channels']} default_sr={d.get('default_samplerate')}{mark}"
        )

    env_idx = os.getenv("MIC_DEVICE_INDEX", "").strip()
    if env_idx.lstrip("-").isdigit():
        mic_idx = int(env_idx)
        # ALSA card 3 ≠ PortAudio index — pulse/pipewire at [3] is silent
        name = str(devices[mic_idx].get("name", "")).lower() if mic_idx < len(devices) else ""
        in_ch = int(devices[mic_idx].get("max_input_channels") or 0) if mic_idx < len(devices) else 0
        if in_ch < 1 or any(x in name for x in ("pulse", "pipewire", "default")):
            usb = pick_usb_mic(devices)
            print(
                f"\n⚠️ .env MIC_DEVICE_INDEX={mic_idx} ({name or 'invalid'}) is not USB hw → "
                f"using [{usb}] instead"
            )
            mic_idx = usb
        else:
            print(f"\nUsing MIC_DEVICE_INDEX={mic_idx} from .env")
    else:
        mic_idx = pick_usb_mic(devices)
        print(f"\nAuto-selected mic index: {mic_idx}")

    if mic_idx is None:
        print("ERROR: No input device found")
        sys.exit(1)

    mic = devices[mic_idx]
    print(f"Recording from: [{mic_idx}] {mic['name']}")

    env_sr = os.getenv("MIC_SAMPLE_RATE", "").strip()
    preferred = int(env_sr) if env_sr.isdigit() else int(float(mic.get("default_samplerate") or 44100))
    # Never prefer 16000 for USB — it causes Invalid sample rate on many dongles
    if preferred == 16000 and "usb" in str(mic.get("name", "")).lower():
        preferred = 44100
        print("Note: forcing preferred sr=44100 for USB mic (16000 rejected by hardware)")

    seconds = float(os.getenv("MIC_TEST_SECONDS", "4"))
    print(f"\n>>> Speak LOUDLY into the USB mic for {seconds:.0f}s NOW <<<\n")

    audio, sr = record_try_rates(mic_idx, seconds, preferred)
    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    rms = float(np.sqrt(np.mean(audio.astype(np.float32) ** 2))) if audio.size else 0.0
    print(f"\nResult: sr={sr}  peak={peak:.0f}  rms={rms:.0f}")

    if peak < 300:
        print("FAIL: Almost silent — wrong mic, muted, or not speaking")
    elif peak < 1500:
        print("WARNING: Quiet — speak closer / louder. Peak should be 2000+")
    else:
        print("OK: Mic is picking up sound")

    fd, wav_path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    with wave.open(wav_path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(audio.tobytes())
    print(f"Saved: {wav_path}")

    if os.getenv("OPENAI_API_KEY") and peak >= 400:
        print("\nSending to Whisper...")
        try:
            from openai import OpenAI

            client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
            with open(wav_path, "rb") as f:
                r = client.audio.transcriptions.create(
                    model="whisper-1",
                    file=f,
                    language="en",
                    temperature=0,
                )
            text = (r.text or "").strip()
            print(f"Whisper heard: >>> {text or '(empty)'} <<<")
        except Exception as exc:
            print(f"Whisper failed: {exc}")
    elif peak < 400:
        print("\nSkipping Whisper (peak too low)")

    print("\nAdd/keep in ~/.env:")
    print(f"  MIC_DEVICE_INDEX={mic_idx}")
    print(f"  MIC_SAMPLE_RATE={sr}")
    print("  USE_VAD=1")
    print("  MIC_GAIN=3.0")
    if peak < 1500:
        print("\n⚠️ Peak low — hold USB mic ~10cm from mouth and speak louder.")


if __name__ == "__main__":
    main()
