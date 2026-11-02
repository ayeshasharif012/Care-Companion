#!/usr/bin/env python3
"""
Compare conversation latency MODES for near-realtime tuning.

Modes profiled:
  baseline   — fixed mic window, cloud whisper, blocking TTS, emotion fetch
  fast       — shorter window, skip emotion, reused clients
  vad        — voice-activity stop (variable mic time)
  realtime   — VAD + streaming TTS + skip emotion + warmup

Also measures:
  • OpenAI network RTT (lightweight ping)
  • TTS cache hit vs miss
  • Time-to-first-audio (TTFB) with streaming TTS
  • Per-stage p50/p95

Usage:
  python profile_realtime.py --turns 5
  python profile_realtime.py --turns 5 --modes baseline,realtime
  python profile_realtime.py --network-only
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
import time
from pathlib import Path
from typing import Dict, List

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from voice.latency import ACTIVE, LatencyTracker, percentile  # noqa: E402

MODES = {
    "baseline": {
        "USE_VAD": "0",
        "CHAT_SKIP_EMOTION": "0",
        "TTS_STREAMING": "0",
        "REALTIME_MODE": "0",
        "RECORD_MAX_SECONDS": "5",
        "CHAT_MAX_TOKENS": "220",
    },
    "fast": {
        "USE_VAD": "0",
        "CHAT_SKIP_EMOTION": "1",
        "TTS_STREAMING": "0",
        "REALTIME_MODE": "0",
        "RECORD_MAX_SECONDS": "3",
        "CHAT_MAX_TOKENS": "120",
    },
    "vad": {
        "USE_VAD": "1",
        "CHAT_SKIP_EMOTION": "1",
        "TTS_STREAMING": "0",
        "REALTIME_MODE": "1",
        "RECORD_MAX_SECONDS": "8",
        "CHAT_MAX_TOKENS": "80",
    },
    "realtime": {
        "USE_VAD": "1",
        "CHAT_SKIP_EMOTION": "1",
        "TTS_STREAMING": "1",
        "REALTIME_MODE": "1",
        "RECORD_MAX_SECONDS": "8",
        "CHAT_MAX_TOKENS": "80",
        "OPENAI_TTS_SPEED": "1.05",
    },
}

PHRASES = [
    "Hello, how are you today?",
    "What is the weather like?",
    "Tell me a short joke.",
    "I need a reminder for medicine.",
    "Thank you, goodbye.",
]


def _load_dotenv():
    for p in (ROOT / ".env", Path.home() / ".env", Path("/home/carecompanion/.env")):
        if not p.exists():
            continue
        for line in p.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = line.strip()
            if line and "=" in line and not line.startswith("#"):
                k, _, v = line.partition("=")
                os.environ[k.strip()] = v.strip().strip('"').strip("'")
        return


def apply_mode(name: str):
    for k, v in MODES[name].items():
        os.environ[k] = v
    print(f"\n{'='*54}\n  MODE: {name.upper()}\n{'='*54}")
    for k, v in MODES[name].items():
        print(f"  {k}={v}")


def measure_openai_rtt(n: int = 3) -> Dict[str, float]:
    """Minimal API latency sample (chat 1 token)."""
    times: List[float] = []
    try:
        from voice.chat.controller import _get_openai_client

        client = _get_openai_client()
        if not client:
            return {"error": 1}
        for _ in range(n):
            t0 = time.perf_counter()
            client.chat.completions.create(
                model=os.getenv("OPENAI_CHAT_MODEL", "gpt-4o-mini"),
                messages=[{"role": "user", "content": "hi"}],
                max_tokens=1,
            )
            times.append((time.perf_counter() - t0) * 1000)
    except Exception as exc:
        print(f"  ⚠️ OpenAI RTT failed: {exc}")
        return {}
    return {
        "p50_ms": percentile(times, 50),
        "p95_ms": percentile(times, 95),
        "mean_ms": sum(times) / len(times),
    }


def measure_backend_rtt(url: str, n: int = 3) -> Dict[str, float]:
    import requests

    times = []
    for _ in range(n):
        t0 = time.perf_counter()
        try:
            requests.get(f"{url.rstrip('/')}/health", timeout=2)
            times.append((time.perf_counter() - t0) * 1000)
        except Exception:
            times.append(2000.0)
    if not times:
        return {}
    return {"p50_ms": percentile(times, 50), "p95_ms": percentile(times, 95)}


async def profile_mode(mode_name: str, turns: int, skip_live: bool) -> dict:
    apply_mode(mode_name)
    tracker = LatencyTracker()
    global ACTIVE
    ACTIVE = tracker

    # Reload modules sensitive to env (import fresh handlers)
    from voice.chat.controller import chat_controller
    from voice.stt.stt_engine import listen

    try:
        from speech_engine import speak
    except ImportError:
        from voice.tts.tts_engine import speak

    from voice.realtime import turn, warmup

    if mode_name == "realtime":
        warmup()

    e2e_list: List[float] = []
    ttfb_list: List[float] = []

    for i in range(turns):
        print(f"  turn {i+1}/{turns}")
        if skip_live:
            tracker.start_turn()
            t0 = time.perf_counter()
            reply = await chat_controller(None, PHRASES[i % len(PHRASES)], "english")
            tracker.record("gpt_chat", (time.perf_counter() - t0) * 1000)
            t0 = time.perf_counter()
            if os.getenv("TTS_STREAMING") == "1":
                from speech_engine import speak_stream

                ttfb = speak_stream(reply, "english")
                if ttfb:
                    ttfb_list.append(ttfb)
            else:
                speak(reply, "english")
            tracker.record("tts_total", (time.perf_counter() - t0) * 1000)
            tracker.end_turn()
            e2e_list.append((time.perf_counter() - t0) * 1000)
        else:
            out = await turn(listen, speak, chat_controller, "english", None, None)
            if out.get("ok"):
                e2e_list.append(out["e2e_ms"])
                ttfb = out.get("timings", {}).get("tts_time_to_first_audio_ms")
                if ttfb:
                    ttfb_list.append(ttfb)
            tracker.end_turn()

    ACTIVE = None
    summary = tracker.summary()
    summary["mode"] = mode_name
    summary["e2e_samples"] = e2e_list
    if ttfb_list:
        summary["tts_time_to_first_audio"] = {
            "p50_ms": round(percentile(ttfb_list, 50), 1),
            "p95_ms": round(percentile(ttfb_list, 95), 1),
        }
    return summary


def print_comparison(results: List[dict]):
    print("\n" + "=" * 70)
    print("  MODE COMPARISON (p95 end-to-end & optimizations)")
    print("=" * 70)
    print(f"  {'MODE':<12} {'E2E p95':>10} {'mic p95':>10} {'STT p95':>10} {'GPT p95':>10} {'TTS gen':>10} {'TTFB p95':>10}")
    print("-" * 70)
    for r in results:
        mode = r.get("mode", "?")
        total = r.get("total_ms", {})
        stages = r.get("stages", {})
        ttfb = r.get("tts_time_to_first_audio", {})
        print(
            f"  {mode:<12} "
            f"{total.get('p95_ms', 0):>9.0f}ms "
            f"{stages.get('mic_record', {}).get('p95_ms', 0):>9.0f}ms "
            f"{stages.get('whisper_stt', {}).get('p95_ms', 0):>9.0f}ms "
            f"{stages.get('gpt_chat', {}).get('p95_ms', 0):>9.0f}ms "
            f"{stages.get('tts_generate', {}).get('p95_ms', 0):>9.0f}ms "
            f"{ttfb.get('p95_ms', 0):>9.0f}ms"
        )
    print("=" * 70)

    best = min(results, key=lambda x: x.get("total_ms", {}).get("p95_ms", 99999))
    print(f"\n  ✅ Best p95 E2E: {best['mode']} ({best.get('total_ms', {}).get('p95_ms', 0):.0f}ms)")

    print("\n  NEAR-REALTIME TARGETS:")
    print("    • Perceived reply start (TTFB)     < 1500ms  ← streaming TTS")
    print("    • User stop-speaking → text (VAD+STT) < 2000ms")
    print("    • Full turn (before playback ends) < 4000ms")
    print("\n  NEXT STEPS if still slow:")
    print("    1. pip install faster-whisper  + USE_LOCAL_STT=1  (drop cloud STT RTT)")
    print("    2. CHAT_SKIP_EMOTION=1  (already in realtime mode)")
    print("    3. Shorter replies: CHAT_MAX_TOKENS=60")
    print("    4. Use wired speaker not Bluetooth (TTS_PLAYBACK)")


async def main_async(args):
    _load_dotenv()

    if args.network_only:
        print("\n--- Network RTT ---")
        oai = measure_openai_rtt()
        print(f"  OpenAI chat ping: p50={oai.get('p50_ms', '?'):.0f}ms p95={oai.get('p95_ms', '?'):.0f}ms")
        be = measure_backend_rtt(os.getenv("BACKEND_URL", "http://192.168.1.92:5000"))
        print(f"  Backend /health:  p50={be.get('p50_ms', '?'):.0f}ms p95={be.get('p95_ms', '?'):.0f}ms")
        return

    modes = [m.strip() for m in args.modes.split(",") if m.strip()]
    results = []
    for mode in modes:
        if mode not in MODES:
            print(f"Unknown mode: {mode}")
            continue
        print(f"\nProfiling mode '{mode}' ({args.turns} turns)...")
        results.append(await profile_mode(mode, args.turns, args.skip_live))

    print_comparison(results)

    if args.out:
        import json

        Path(args.out).write_text(json.dumps(results, indent=2), encoding="utf-8")
        print(f"\nSaved {args.out}")


def main():
    parser = argparse.ArgumentParser(description="Profile realtime optimization modes")
    parser.add_argument("--turns", type=int, default=3)
    parser.add_argument("--modes", default="baseline,fast,vad,realtime")
    parser.add_argument("--skip-live", action="store_true", help="Synthetic (no mic)")
    parser.add_argument("--network-only", action="store_true")
    parser.add_argument("--out", default="")
    args = parser.parse_args()
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
