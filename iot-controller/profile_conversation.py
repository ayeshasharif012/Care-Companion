#!/usr/bin/env python3
"""
Profile active-conversation latency (p50 / p95 / p99) on the Pi.

Measures each stage:
  mic_record → whisper_stt → emotion_fetch → gpt_chat → tts_generate → tts_playback

Usage:
  python profile_conversation.py --turns 10 --seconds 3
  python profile_conversation.py --turns 5 --skip-live   # API-only, no mic
  python profile_conversation.py --turns 10 --out latency_report.json

Typical p95 bottlenecks (Pi → cloud):
  • mic_record     = fixed (seconds arg) — biggest easy win: lower --seconds
  • whisper_stt    = 800–2500ms (network + audio upload)
  • emotion_fetch  = 0–4000ms (HTTP to Windows backend) — disable with --fast
  • gpt_chat       = 400–1500ms
  • tts_generate   = 600–2000ms (cache miss)
  • tts_playback   = audio duration (not API latency)
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from voice.latency import ACTIVE, LatencyTracker  # noqa: E402


def _load_dotenv():
    for p in (ROOT / ".env", Path.home() / ".env", Path("/home/carecompanion/.env")):
        if not p.exists():
            continue
        for line in p.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = line.strip()
            if line and "=" in line and not line.startswith("#"):
                k, _, v = line.partition("=")
                if k.strip() and k.strip() not in os.environ:
                    os.environ[k.strip()] = v.strip().strip('"').strip("'")
        return


async def profile_one_turn_live(listen, speak, chat_controller, lang, seconds, user_id, tracker):
    """Full pipeline with mic (real-world latency)."""
    tracker.start_turn()
    t_all = time.perf_counter()

    result = listen(language=lang, timeout=seconds, return_audio=True)
    user_text = result[0] if isinstance(result, tuple) else result
    audio_path = result[1] if isinstance(result, tuple) else None

    if not user_text:
        tracker.end_turn()
        print("  ⚠️ turn skipped — no speech")
        return False

    print(f"  [DETECTED] {user_text[:60]}")

    t0 = time.perf_counter()
    reply = await chat_controller(
        patient_id=user_id,
        user_text=user_text,
        language=lang,
        audio_file_path=audio_path,
    )
    tracker.record("gpt_chat_total", (time.perf_counter() - t0) * 1000)
    print(f"  [AI] {reply[:60]}...")

    # TTS split: generate vs play (instrumented in speech_engine if ACTIVE set)
    t0 = time.perf_counter()
    speak(reply, lang)
    tracker.record("tts_total", (time.perf_counter() - t0) * 1000)

    tracker.end_turn()
    e2e = (time.perf_counter() - t_all) * 1000
    print(f"  [E2E] {e2e:.0f}ms")
    return True


async def profile_one_turn_synthetic(chat_controller, speak, lang, user_id, tracker, phrase: str):
    """No mic — isolate API latency (STT simulated)."""
    tracker.start_turn()

    tracker.record("mic_record", 0.0)
    tracker.record("whisper_stt", 0.0)

    t0 = time.perf_counter()
    reply = await chat_controller(
        patient_id=user_id,
        user_text=phrase,
        language=lang,
    )
    tracker.record("gpt_chat_total", (time.perf_counter() - t0) * 1000)

    t0 = time.perf_counter()
    speak(reply, lang)
    tracker.record("tts_total", (time.perf_counter() - t0) * 1000)

    tracker.end_turn()
    print(f"  [SYNTH] phrase={phrase!r} e2e_stages_done")
    return True


def _import_modules():
    from voice.stt.stt_engine import listen
    from voice.chat.controller import chat_controller

    try:
        from voice.tts.tts_engine import speak
    except Exception:
        from speech_engine import speak

    return listen, speak, chat_controller


async def main_async(args):
    global ACTIVE
    tracker = LatencyTracker()
    ACTIVE = tracker

    if args.fast:
        os.environ["CHAT_SKIP_EMOTION"] = "1"
        print("⚡ Fast mode: skipping emotion HTTP fetch")

    listen, speak, chat_controller = _import_modules()
    phrases = [
        "Hello, how are you?",
        "What time is it?",
        "Tell me something nice.",
        "I'm feeling a bit tired today.",
        "Can you help me?",
    ]

    print(f"\nProfiling {args.turns} turns | lang={args.lang} | record={args.seconds}s\n")

    for i in range(args.turns):
        print(f"--- Turn {i + 1}/{args.turns} ---")
        if args.skip_live:
            phrase = phrases[i % len(phrases)]
            await profile_one_turn_synthetic(
                chat_controller, speak, args.lang, args.user_id, tracker, phrase
            )
        else:
            ok = await profile_one_turn_live(
                listen, speak, chat_controller, args.lang, args.seconds, args.user_id, tracker
            )
            if not ok and not args.skip_live:
                continue

    ACTIVE = None
    tracker.print_report("Active Conversation Latency (p95 focus)")

    s = tracker.summary()
    if s.get("total_ms"):
        p95 = s["total_ms"]["p95_ms"]
        print("DIAGNOSIS (p95 end-to-end):")
        if p95 > 8000:
            print("  🔴 Very high (>8s). Check: mic_record seconds, Pi→internet, emotion fetch.")
        elif p95 > 5000:
            print("  🟠 High (>5s). Lower --seconds, use --fast, warm TTS cache.")
        else:
            print("  🟢 Acceptable for cloud STT/TTS on Pi.")

        stages = s.get("stages", {})
        if stages:
            worst = max(stages.items(), key=lambda x: x[1]["p95_ms"])
            print(f"  Slowest stage (p95): {worst[0]} = {worst[1]['p95_ms']}ms")

    if args.out:
        tracker.save_json(args.out)
        print(f"Saved: {args.out}")


def main():
    parser = argparse.ArgumentParser(description="Profile conversation p95 latency on Pi")
    parser.add_argument("--turns", type=int, default=5, help="Number of measured turns")
    parser.add_argument("--seconds", type=float, default=3.0, help="Mic record length (lower=faster)")
    parser.add_argument("--lang", default="english", choices=["english", "urdu"])
    parser.add_argument("--user-id", default=os.getenv("TEST_USER_ID"))
    parser.add_argument("--fast", action="store_true", help="Skip emotion HTTP fetch")
    parser.add_argument("--skip-live", action="store_true", help="Synthetic turns (no mic)")
    parser.add_argument("--out", default="", help="Save JSON report path")
    args = parser.parse_args()

    _load_dotenv()
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
