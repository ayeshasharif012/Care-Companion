#!/usr/bin/env python3
"""
Near-realtime companion conversation (optimized Pi pipeline).

  python realtime_conversation.py
  python realtime_conversation.py --lang urdu
  python realtime_conversation.py --local-stt   # faster-whisper on Pi (optional)

Uses: VAD mic stop + streaming TTS + skip emotion + warmup
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _load_dotenv():
    for p in (ROOT / ".env", Path.home() / ".env", Path("/home/carecompanion/.env")):
        if not p.exists():
            continue
        for line in p.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = line.strip()
            if line and "=" in line and not line.startswith("#"):
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
        return


async def main():
    parser = argparse.ArgumentParser(description="Near-realtime Pi conversation")
    parser.add_argument("--lang", default="english", choices=["english", "urdu"])
    parser.add_argument("--user-id", default=os.getenv("TEST_USER_ID"))
    parser.add_argument("--local-stt", action="store_true", help="Use faster-whisper on Pi")
    args = parser.parse_args()

    _load_dotenv()
    if args.local_stt:
        os.environ["USE_LOCAL_STT"] = "1"

    from voice.realtime import apply_realtime_env, loop, warmup
    from voice.chat.controller import chat_controller
    from voice.stt.stt_engine import listen

    try:
        from speech_engine import speak
    except ImportError:
        from voice.tts.tts_engine import speak

    apply_realtime_env()
    warmup()

    try:
        await loop(listen, speak, chat_controller, args.lang, args.user_id)
    except KeyboardInterrupt:
        print("\n👋 Stopped.")


if __name__ == "__main__":
    asyncio.run(main())
