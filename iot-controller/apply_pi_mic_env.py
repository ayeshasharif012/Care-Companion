#!/usr/bin/env python3
"""
Lock Pi ~/.env to YOUR USB PnP mic (PortAudio index 1) + conversation-friendly settings.

Hardware (confirmed on CareCompanion):
  arecord -l  → card 3: USB PnP Sound Device
  sounddevice → [1] USB PnP Sound Device: Audio (hw:3,0)   ← USE THIS
  sounddevice → [3] pulse                                 ← NEVER (silent)

Run on Pi:
  python3 ~/apply_pi_mic_env.py
  python3 main.py
"""
from __future__ import annotations

import os
import re
from pathlib import Path

ENV_PATH = Path.home() / ".env"

# Confirmed live mic + lower latency conversation profile
PI_MIC = {
    "MIC_DEVICE_INDEX": "1",
    "MIC_SAMPLE_RATE": "44100",
    "MIC_GAIN": "1.5",
    "USE_VAD": "1",
    "VAD_ENERGY_THRESHOLD": "500",
    "VAD_MIN_SPEECH_S": "0.6",
    "VAD_MIN_KEEP_S": "1.2",
    "VAD_SILENCE_S": "1.0",
    "RECORD_MAX_SECONDS": "5",
    "VOICE_CHAT_SECONDS": "5",
    "VOICE_CHAT_TURNS": "3",
    "STT_FORCE_SEND": "0",
    "STT_MIN_SPEECH_PEAK": "900",
    "CHAT_SKIP_EMOTION": "0",
    "EMOTION_PREDICT_TIMEOUT": "8",
    "HEALTH_TIPS_MIN_INTERVAL": "180",
    "HEALTH_TIPS_MAX_INTERVAL": "300",
}


def _upsert(text: str, key: str, value: str) -> str:
    line = f"{key}={value}"
    pat = re.compile(rf"^{re.escape(key)}=.*$", re.M)
    if pat.search(text):
        return pat.sub(line, text)
    if text and not text.endswith("\n"):
        text += "\n"
    return text + line + "\n"


def apply(env_path: Path = ENV_PATH) -> Path:
    text = env_path.read_text(encoding="utf-8", errors="ignore") if env_path.exists() else ""
    for k, v in PI_MIC.items():
        text = _upsert(text, k, v)
    env_path.write_text(text, encoding="utf-8")
    for k, v in PI_MIC.items():
        os.environ[k] = v
    return env_path


def main():
    path = apply()
    print("✅ Pi mic + conversation profile →", path)
    for k, v in PI_MIC.items():
        print(f"   {k}={v}")
    print()
    print("USB mic = PortAudio [1]. Health tips paused during chat.")
    print("Next: python3 main.py  → say 'hello care companion'")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
