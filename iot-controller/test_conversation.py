#!/usr/bin/env python3
"""
Standalone Pi conversation test — mic detect → log → AI reply → speaker.

Run on Raspberry Pi:

  python test_conversation.py              # one turn
  python test_conversation.py --loop       # continuous (say "quit" to stop)
  python test_conversation.py --stt-only
  python test_conversation.py --tts-only "Hello from Care Companion"
  python test_conversation.py --lang urdu --seconds 6

Logs show:
  [MIC]       → microphone recording
  [DETECTED]  → what AI heard from your voice
  [AI]        → AI thinking
  [RESPONSE]  → AI text reply
  [SPEAKER]   → playing on Pi speaker
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# ---------------------------------------------------------------------------
# Logging — everything visible in terminal (+ optional file)
# ---------------------------------------------------------------------------
LOG = logging.getLogger("conversation_test")


def setup_logging(log_file: str | None = None):
    LOG.setLevel(logging.INFO)
    fmt = logging.Formatter(
        "%(asctime)s | %(message)s",
        datefmt="%H:%M:%S",
    )
    console = logging.StreamHandler(sys.stdout)
    console.setFormatter(fmt)
    LOG.addHandler(console)

    if log_file:
        fh = logging.FileHandler(log_file, encoding="utf-8")
        fh.setFormatter(fmt)
        LOG.addHandler(fh)
        LOG.info("Log file: %s", log_file)


def log_section(title: str):
    line = "─" * 52
    LOG.info(line)
    LOG.info("  %s", title)
    LOG.info(line)


def _load_dotenv():
    for env_path in (
        ROOT / ".env",
        Path.home() / ".env",
        Path("/home/carecompanion/.env"),
    ):
        if not env_path.exists():
            continue
        # Last value wins (duplicates common on Pi .env)
        parsed = {}
        for line in env_path.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = line.strip().replace("\r", "")
            if line and not line.startswith("#") and "=" in line:
                key, _, val = line.partition("=")
                key = key.strip()
                val = val.strip().strip('"').strip("'")
                if key:
                    parsed[key] = val
        for key, val in parsed.items():
            os.environ[key] = val
        LOG.info("[INIT] Loaded env from %s (USE_VAD=%s)", env_path, os.getenv("USE_VAD"))
        return
    LOG.info("[INIT] No .env file — using environment variables only")


def _beep():
    """Short beep so user knows when to speak."""
    try:
        import numpy as np
        import sounddevice as sd

        sr = 16000
        t = np.linspace(0, 0.25, int(sr * 0.25), False)
        tone = (0.25 * np.sin(2 * np.pi * 880 * t)).astype(np.float32)
        sd.play(tone, sr)
        sd.wait()
    except Exception:
        LOG.info("[MIC] (beep skipped — speak now)")


def _import_voice():
    listen = None
    speak = None
    chat_controller = None
    voice = "nova"

    try:
        from voice.stt.stt_engine import listen
        LOG.info("[INIT] STT engine loaded (Whisper)")
    except Exception as exc:
        LOG.error("[INIT] STT import failed: %s", exc)

    try:
        from voice.tts.tts_engine import speak, OPENAI_VOICE
        voice = OPENAI_VOICE
        LOG.info("[INIT] TTS engine loaded (voice=%s)", voice)
    except Exception:
        try:
            from speech_engine import speak, OPENAI_VOICE
            voice = OPENAI_VOICE
            LOG.info("[INIT] TTS loaded from speech_engine (voice=%s)", voice)
        except Exception as exc:
            LOG.error("[INIT] TTS import failed: %s", exc)

    try:
        from voice.chat.controller import chat_controller
        LOG.info("[INIT] AI chat controller loaded")
    except Exception as exc:
        LOG.warning("[INIT] chat_controller unavailable: %s — echo fallback", exc)

        async def chat_controller(patient_id, user_text, language="english", **kwargs):
            return f"You said: {user_text}"

    return listen, speak, chat_controller, voice


def _is_bad_stt(text: str | None) -> bool:
    """Reject Whisper hallucinations and single-word false positives."""
    if not text or not str(text).strip():
        return True
    try:
        from voice.stt.vad import is_hallucination
        return is_hallucination(text)
    except ImportError:
        s = str(text).strip()
        bad = {
            "you", "You", "you.", "You.",
            "thanks for watching!", "Thanks for watching!",
            "thank you for watching!", "Thank you for watching!",
            "thank you.", "Thank you.", "thank you", "Thank you",
        }
        if s in bad or s.lower() in {x.lower() for x in bad}:
            return True
        words = [w for w in s.split() if w.strip(".,!?;:")]
        return len(words) < int(os.getenv("STT_MIN_WORDS", "2"))


def listen_and_log(listen, language: str, seconds: float, use_vad: bool | None = None) -> tuple[str | None, str | None]:
    """
    Record mic → STT → log detected voice text.
    Returns (detected_text, audio_path).
    """
    max_tries = int(os.getenv("STT_RETRY_COUNT", "2")) + 1

    for attempt in range(1, max_tries + 1):
        log_section("STEP 1 — MICROPHONE")
        if attempt == 1:
            LOG.info("[MIC] Recording %.1fs from Pi microphone...", seconds)
            LOG.info("[MIC] Speak a FULL sentence (2+ words) after the beep")
        else:
            LOG.warning("[MIC] Retry %d/%d — speak clearly: e.g. 'Hello how are you'", attempt, max_tries)
        _beep()

        try:
            result = listen(language=language, timeout=seconds, return_audio=True, use_vad=use_vad)
            if isinstance(result, tuple):
                user_text, audio_path = result
            else:
                user_text, audio_path = result, None

            if user_text and _is_bad_stt(user_text):
                LOG.warning("[DETECTED] Rejected noise/hallucination: '%s'", user_text.strip())
                user_text = None

            if user_text:
                log_section("STEP 2 — DETECTED VOICE (STT)")
                LOG.info("[DETECTED] Microphone heard you say:")
                LOG.info("[DETECTED] >>> %s <<<", user_text)
                if audio_path:
                    LOG.info("[DETECTED] Audio file: %s", audio_path)
                return user_text, audio_path

            if attempt < max_tries:
                LOG.warning("[DETECTED] No valid speech — trying again...")
                continue

            LOG.warning("[DETECTED] No voice detected — mic silent or STT failed")
            return None, audio_path
        except Exception as exc:
            LOG.error("[MIC] Listen error: %s", exc)
            return None, None

    return None, None


async def ai_reply_and_log(chat_controller, user_text: str, language: str, user_id, audio_path):
    """Get AI response and log it."""
    log_section("STEP 3 — AI RESPONSE")
    LOG.info("[AI] Processing detected text...")
    LOG.info("[AI] Input: %s", user_text)

    reply = await chat_controller(
        patient_id=user_id,
        user_text=user_text,
        language=language,
        audio_file_path=audio_path,
    )

    LOG.info("[RESPONSE] AI reply:")
    LOG.info("[RESPONSE] >>> %s <<<", reply)
    return reply


def speak_on_speaker(speak, text: str, language: str, voice: str) -> bool:
    """Play AI text on Pi speaker and log status."""
    log_section("STEP 4 — SPEAKER (TTS)")
    LOG.info("[SPEAKER] Playing AI response on speaker (voice=%s)...", voice)
    LOG.info("[SPEAKER] Text: %s", text[:200] + ("..." if len(text) > 200 else ""))

    try:
        speak(text, language)
        LOG.info("[SPEAKER] ✅ Playback finished")
        return True
    except Exception as exc:
        LOG.error("[SPEAKER] ❌ Playback failed: %s", exc)
        return False


def test_tts(speak, text: str, language: str, voice: str) -> bool:
    log_section("TTS ONLY TEST")
    LOG.info("[SPEAKER] Testing speaker output...")
    return speak_on_speaker(speak, text, language, voice)


def test_stt(listen, language: str, seconds: float) -> str | None:
    text, _ = listen_and_log(listen, language, seconds)
    return text


async def one_conversation_turn(
    listen,
    speak,
    chat_controller,
    language: str,
    seconds: float,
    user_id: str | None,
    voice: str,
    use_vad: bool | None = None,
) -> tuple[bool, str | None]:
    """One full cycle: mic → detect → AI → speaker. Returns (ok, detected_text)."""
    log_section(f"NEW TURN — {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    user_text, audio_path = listen_and_log(listen, language, seconds, use_vad=use_vad)

    if not user_text:
        fallback = (
            "I did not hear anything. Please try again."
            if language == "english"
            else "مجھے کچھ سنائی نہیں دیا۔ براہ کرم دوبارہ بولیں۔"
        )
        LOG.warning("[DETECTED] Empty — speaking fallback on speaker")
        speak_on_speaker(speak, fallback, language, voice)
        return False, None

    # Exit words
    lower = user_text.lower().strip()
    if lower in ("quit", "exit", "stop", "bye", "goodbye", "ختم"):
        goodbye = (
            "Goodbye! Take care."
            if language == "english"
            else "الوداع! اپنا خیال رکھیں۔"
        )
        LOG.info("[AI] User said goodbye — ending conversation")
        speak_on_speaker(speak, goodbye, language, voice)
        return False, user_text

    reply = await ai_reply_and_log(
        chat_controller, user_text, language, user_id, audio_path
    )
    ok = speak_on_speaker(speak, reply, language, voice)

    log_section("TURN COMPLETE")
    LOG.info("[SUMMARY] You said : %s", user_text)
    LOG.info("[SUMMARY] AI said  : %s", reply)
    LOG.info("[SUMMARY] Speaker  : %s", "OK" if ok else "FAILED")

    return ok, user_text


async def conversation_loop(args, listen, speak, chat_controller, voice):
    log_section("CONVERSATION LOOP START")
    LOG.info("[LOOP] Say 'quit' or 'exit' to stop | Ctrl+C also works")

    greeting = (
        "Hello! I am Care Companion. Speak after the beep and I will reply on the speaker."
        if args.lang == "english"
        else "السلام علیکم! میں Care Companion ہوں۔ بِپ کے بعد بولیں، میں جواب سناؤں گا۔"
    )
    speak_on_speaker(speak, greeting, args.lang, voice)

    turn = 0
    while True:
        turn += 1
        LOG.info("[LOOP] Turn #%d", turn)
        ok, detected = await one_conversation_turn(
            listen,
            speak,
            chat_controller,
            args.lang,
            args.seconds,
            args.user_id,
            voice,
            use_vad=False if args.no_vad else None,
        )
        if detected and detected.lower().strip() in (
            "quit", "exit", "stop", "bye", "goodbye", "ختم"
        ):
            LOG.info("[LOOP] Stopped by user voice command")
            break
        if not ok and not detected:
            continue


def main():
    parser = argparse.ArgumentParser(
        description="Pi mic → detect voice → log → AI response → speaker"
    )
    parser.add_argument("--lang", choices=["english", "urdu"], default="english")
    parser.add_argument("--seconds", type=float, default=6.0)
    parser.add_argument("--no-vad", action="store_true", help="Use fixed mic recording (easier in noisy rooms)")
    parser.add_argument("--user-id", default=os.getenv("TEST_USER_ID"))
    parser.add_argument("--stt-only", action="store_true")
    parser.add_argument("--tts-only", metavar="TEXT")
    parser.add_argument(
        "--realtime",
        action="store_true",
        help="Use near-realtime pipeline (VAD + streaming TTS)",
    )
    parser.add_argument(
        "--profile",
        action="store_true",
        help="Run p95 latency profiler (same as profile_conversation.py)",
    )
    parser.add_argument("--loop", action="store_true")
    parser.add_argument(
        "--log-file",
        default=os.getenv("CONV_TEST_LOG"),
        help="Optional log file path (e.g. /home/carecompanion/conversation.log)",
    )
    args = parser.parse_args()

    setup_logging(args.log_file)

    log_section("Care Companion — Conversation Test")
    _load_dotenv()
    if args.no_vad:
        os.environ["USE_VAD"] = "0"
    listen, speak, chat_controller, voice = _import_voice()

    if speak is None:
        LOG.error("[INIT] TTS required — install speech_engine / voice.tts")
        sys.exit(1)

    LOG.info("[INIT] Language=%s | Record=%ss | Voice=%s", args.lang, args.seconds, voice)
    if not os.getenv("OPENAI_API_KEY"):
        LOG.warning("[INIT] OPENAI_API_KEY missing — STT/TTS may fail or use gTTS fallback")

    if args.tts_only:
        ok = test_tts(speak, args.tts_only, args.lang, voice)
        sys.exit(0 if ok else 1)

    if args.stt_only:
        if listen is None:
            LOG.error("[INIT] STT not available")
            sys.exit(1)
        text = test_stt(listen, args.lang, args.seconds)
        sys.exit(0 if text else 1)

    if listen is None:
        LOG.error("[INIT] STT not available for conversation")
        sys.exit(1)

    if args.realtime:
        import subprocess

        cmd = [
            sys.executable,
            str(ROOT / "realtime_conversation.py"),
            "--lang",
            args.lang,
        ]
        if args.user_id:
            cmd.extend(["--user-id", args.user_id])
        subprocess.run(cmd)
        return

    if args.profile:
        import subprocess

        script = ROOT / (
            "profile_realtime.py" if os.getenv("PROFILE_REALTIME") else "profile_conversation.py"
        )
        cmd = [
            sys.executable,
            str(script),
            "--turns",
            "5",
            "--lang",
            args.lang,
        ]
        if script.name == "profile_conversation.py":
            cmd.extend(["--seconds", str(args.seconds)])
        if args.user_id:
            cmd.extend(["--user-id", args.user_id])
        if os.getenv("CHAT_SKIP_EMOTION"):
            cmd.append("--fast")
        subprocess.run(cmd)
        return

    if args.loop:
        try:
            asyncio.run(conversation_loop(args, listen, speak, chat_controller, voice))
        except KeyboardInterrupt:
            LOG.info("[LOOP] Stopped by Ctrl+C")
        return

    ok, _ = asyncio.run(
        one_conversation_turn(
            listen, speak, chat_controller, args.lang, args.seconds, args.user_id, voice,
            use_vad=False if args.no_vad else None,
        )
    )
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
