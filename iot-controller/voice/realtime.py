"""
Near-realtime conversation pipeline for Care Companion Pi.

Optimizations:
  1. VAD — stop recording on silence (not fixed 3–5s window)
  2. Streaming TTS — start speaker playback before full MP3 download
  3. Skip emotion fetch in realtime mode
  4. Shorter GPT replies (lower max_tokens)
  5. Connection warmup on startup

Target perceived latency: ~2–4s (cloud) or ~1–2s (with cache + VAD)
"""
from __future__ import annotations

import asyncio
import os
import time
from typing import Any, Dict, Optional

try:
    from voice.latency import ACTIVE, track
except ImportError:
    ACTIVE = None

    from contextlib import contextmanager

    @contextmanager
    def track(_name):
        yield


def apply_realtime_env():
    """Enable low-latency defaults (safe to call multiple times)."""
    defaults = {
        "REALTIME_MODE": "1",
        "USE_VAD": "1",
        "CHAT_SKIP_EMOTION": "1",
        "TTS_STREAMING": "1",
        "OPENAI_TTS_SPEED": "1.05",
        "CHAT_MAX_TOKENS": "80",
        "EMOTION_FETCH_TIMEOUT": "0.8",
    }
    for k, v in defaults.items():
        os.environ.setdefault(k, v)


def warmup():
    """Pre-connect OpenAI + optional TTS cache warm."""
    apply_realtime_env()
    t0 = time.perf_counter()
    with track("warmup"):
        try:
            from speech_engine import warmup_tts
            from voice.stt.stt_engine import warmup_stt
            from voice.chat.controller import warmup_chat

            warmup_stt()
            warmup_chat()
            warmup_tts()
        except Exception as exc:
            print(f"⚠️ Warmup partial: {exc}")
    ms = (time.perf_counter() - t0) * 1000
    print(f"⚡ Realtime warmup done ({ms:.0f}ms)")
    return ms


async def turn(
    listen,
    speak,
    chat_controller,
    language: str = "english",
    user_id: Optional[str] = None,
    record_seconds: Optional[float] = None,
) -> Dict[str, Any]:
    """
    One optimized conversation turn.
    Returns dict with timings and text (for profiling).
    """
    timings: Dict[str, float] = {}
    t_turn = time.perf_counter()

    # --- STT ---
    t0 = time.perf_counter()
    result = listen(
        language=language,
        timeout=record_seconds,
        return_audio=True,
        use_vad=os.getenv("USE_VAD", "1").lower() in ("1", "true", "yes"),
    )
    timings["stt_total_ms"] = (time.perf_counter() - t0) * 1000

    if isinstance(result, tuple):
        user_text, audio_path = result
    else:
        user_text, audio_path = result, None

    if not user_text:
        return {
            "ok": False,
            "error": "no_speech",
            "timings": timings,
            "e2e_ms": (time.perf_counter() - t_turn) * 1000,
        }

    print(f"👤 {user_text}")

    # --- GPT ---
    t0 = time.perf_counter()
    reply = await chat_controller(
        patient_id=user_id,
        user_text=user_text,
        language=language,
        audio_file_path=audio_path,
    )
    timings["gpt_ms"] = (time.perf_counter() - t0) * 1000
    print(f"🤖 {reply[:100]}")

    # --- TTS (streaming if enabled) ---
    t0 = time.perf_counter()
    ttfb_ms = None
    try:
        from speech_engine import speak, speak_stream, REALTIME_MODE

        if REALTIME_MODE and os.getenv("TTS_STREAMING", "1") == "1":
            ttfb_ms = speak_stream(reply, language)
        else:
            speak(reply, language)
    except ImportError:
        speak(reply, language)

    timings["tts_ms"] = (time.perf_counter() - t0) * 1000
    if ttfb_ms is not None:
        timings["tts_time_to_first_audio_ms"] = ttfb_ms

    timings["e2e_ms"] = (time.perf_counter() - t_turn) * 1000

    if ACTIVE:
        ACTIVE.record("realtime_e2e", timings["e2e_ms"])
        if ttfb_ms is not None:
            ACTIVE.record("tts_time_to_first_audio", ttfb_ms)

    return {
        "ok": True,
        "user_text": user_text,
        "reply": reply,
        "timings": timings,
        "e2e_ms": timings["e2e_ms"],
    }


async def loop(listen, speak, chat_controller, language="english", user_id=None):
    apply_realtime_env()
    warmup()
    print("\n🚀 Realtime conversation — Ctrl+C to stop\n")
    n = 0
    while True:
        n += 1
        print(f"--- Turn {n} ---")
        out = await turn(listen, speak, chat_controller, language, user_id)
        if out.get("ok"):
            print(f"⚡ E2E {out['e2e_ms']:.0f}ms | TTFB {out['timings'].get('tts_time_to_first_audio_ms', 'n/a')}\n")
        else:
            print(f"⚠️ {out.get('error')} ({out.get('e2e_ms', 0):.0f}ms)\n")
