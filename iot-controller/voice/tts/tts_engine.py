"""
TTS engine — calm ChatGPT-like voice via speech_engine (OpenAI nova).
"""
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[2]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from speech_engine import (  # noqa: E402
    speak,
    speak_stream,
    warmup_tts,
    AUDIO_DIR,
    OPENAI_VOICE,
    REALTIME_MODE,
)

__all__ = ["speak", "speak_stream", "warmup_tts", "AUDIO_DIR", "OPENAI_VOICE", "REALTIME_MODE"]
