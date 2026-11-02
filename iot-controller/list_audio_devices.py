#!/usr/bin/env python3
"""List sounddevice input/output indices for MIC_DEVICE_INDEX / SPEAKER_DEVICE_INDEX."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from voice.stt.audio_io import list_audio_devices

if __name__ == "__main__":
    list_audio_devices()
