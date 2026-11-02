"""
Care Companion speech engine — calm ChatGPT-like voice (OpenAI TTS `nova`).
Near-realtime: streaming TTS pipes audio to speaker while downloading.
"""
from __future__ import annotations

import hashlib
import os
import subprocess
import sys
import time
from pathlib import Path

try:
    from voice.latency import track
except ImportError:
    from contextlib import contextmanager

    @contextmanager
    def track(_name):
        yield

AUDIO_DIR = Path(__file__).resolve().parent / "voice-cache"
AUDIO_DIR.mkdir(parents=True, exist_ok=True)

SINK_ID = os.getenv("TTS_SINK_ID", "89")
# mpg123 gain 0–100 (default ~80). Raise for louder Pi speaker.
TTS_VOLUME = int(os.getenv("TTS_VOLUME", "100"))
OPENAI_VOICE = os.getenv("OPENAI_TTS_VOICE", "nova")
OPENAI_TTS_MODEL = os.getenv("OPENAI_TTS_MODEL", "tts-1")
OPENAI_TTS_SPEED = float(os.getenv("OPENAI_TTS_SPEED", "0.92"))
REALTIME_MODE = os.getenv("REALTIME_MODE", "0").lower() in ("1", "true", "yes")
IS_WINDOWS = sys.platform == "win32"
USE_PYGAME = os.getenv(
    "TTS_USE_PYGAME",
    "1" if IS_WINDOWS else "0",
).lower() in ("1", "true", "yes")
TTS_STREAMING = os.getenv("TTS_STREAMING", "0").lower() in ("1", "true", "yes")

_openai_client = None


def _normalize_lang(lang: str) -> str:
    raw = str(lang or "english").lower().strip()
    if raw in ("ur", "urdu") or "urdu" in raw:
        return "urdu"
    return "english"


def _lang_code(lang: str) -> str:
    return "ur" if _normalize_lang(lang) == "urdu" else "en"


def _cache_path(text: str, lang: str) -> Path:
    digest = hashlib.sha1(f"{OPENAI_VOICE}|{lang}|{text}".encode("utf-8")).hexdigest()[:16]
    return AUDIO_DIR / f"{digest}_{_lang_code(lang)}.mp3"


def _load_openai_key() -> str | None:
    try:
        from voice.openai_util import load_openai_key

        return load_openai_key()
    except ImportError:
        key = os.getenv("OPENAI_API_KEY", "").strip()
        if key:
            return key
        for env_path in (
            Path(__file__).resolve().parent / ".env",
            Path.home() / ".env",
            Path("/home/carecompanion/.env"),
            Path("/home/carecompanion/Care-companion/backend/.env"),
        ):
            try:
                if not env_path.exists():
                    continue
                for line in env_path.read_text(encoding="utf-8", errors="ignore").splitlines():
                    line = line.strip()
                    if line.startswith("OPENAI_API_KEY="):
                        val = line.split("=", 1)[1].strip().strip('"').strip("'")
                        if val:
                            os.environ["OPENAI_API_KEY"] = val
                            return val
            except Exception:
                continue
        return None


def _get_openai_client():
    global _openai_client
    if _openai_client is not None:
        return _openai_client
    try:
        from voice.openai_util import get_openai_client

        _openai_client = get_openai_client()
        if _openai_client:
            return _openai_client
    except ImportError:
        pass
    api_key = _load_openai_key()
    if not api_key:
        print("❌ [TTS] OPENAI_API_KEY missing — TTS will try gTTS fallback")
        return None
    from openai import OpenAI

    _openai_client = OpenAI(api_key=api_key)
    return _openai_client


def warmup_tts():
    """Pre-connect OpenAI for TTS + raise system playback volume."""
    _get_openai_client()
    try:
        # Pulse / ALSA volume boost (best-effort)
        subprocess.run(
            ["pactl", "set-sink-volume", "@DEFAULT_SINK@", "100%"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=3,
        )
        subprocess.run(
            ["amixer", "-q", "sset", "Master", "100%"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=3,
        )
        print(f"🔊 TTS volume={TTS_VOLUME}% (mpg123 -g)")
    except Exception:
        pass


def _mpg123_cmd() -> list:
    cmd = ["mpg123", "-q"]
    vol = max(0, min(100, TTS_VOLUME))
    cmd.extend(["-g", str(vol)])
    if SINK_ID:
        cmd.extend(["-a", str(SINK_ID)])
    return cmd


def _generate_openai(text: str, lang: str, file_path: Path) -> bool:
    client = _get_openai_client()
    if not client:
        return False
    try:
        with track("tts_generate"):
            response = client.audio.speech.create(
                model=OPENAI_TTS_MODEL,
                voice=OPENAI_VOICE,
                input=text,
                speed=OPENAI_TTS_SPEED,
            )
            file_path.write_bytes(response.content)
        return file_path.exists() and file_path.stat().st_size > 500
    except Exception as exc:
        print(f"⚠️ OpenAI TTS failed: {exc}")
        return False


def _generate_gtts(text: str, lang: str, file_path: Path) -> bool:
    try:
        from gtts import gTTS

        with track("tts_generate"):
            tts = gTTS(text=text, lang=_lang_code(lang), slow=False)
            tts.save(str(file_path))
        return file_path.exists() and file_path.stat().st_size > 200
    except Exception as exc:
        print(f"❌ gTTS fallback failed: {exc}")
        return False


def speak_stream(text: str, lang: str = "english") -> float | None:
    """
    Stream TTS to speaker — returns time-to-first-audio (ms) or None.
    Falls back to blocking speak() on failure.
    """
    text = (text or "").strip()
    if not text:
        print("⚠️ [TTS] Empty text — nothing to speak")
        return None
    language = _normalize_lang(lang)
    print(f"🔊 [TTS] Playing on speaker (stream/{OPENAI_VOICE}/{language}): {text[:80]!r}")
    file_path = _cache_path(text, language)

    if USE_PYGAME or IS_WINDOWS:
        speak(text, lang)
        return None

    # Cache hit — instant path
    if file_path.exists():
        t0 = time.perf_counter()
        ok = _play_mp3(file_path)
        print(f"✅ [TTS] Playback done (cache) ok={ok}")
        return (time.perf_counter() - t0) * 1000

    client = _get_openai_client()
    if not client:
        print("⚠️ [TTS] No OpenAI client — falling back to blocking/gTTS speak()")
        speak(text, lang)
        return None

    t_start = time.perf_counter()
    ttfb_ms = None

    try:
        with track("tts_stream"):
            with client.audio.speech.with_streaming_response.create(
                model=OPENAI_TTS_MODEL,
                voice=OPENAI_VOICE,
                input=text,
                speed=OPENAI_TTS_SPEED,
            ) as response:
                # Stream to file + speaker via mpg123 stdin
                cmd = _mpg123_cmd() + ["-"]
                proc = subprocess.Popen(
                    cmd,
                    stdin=subprocess.PIPE,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                chunks = []
                for chunk in response.iter_bytes(chunk_size=4096):
                    if chunk:
                        if ttfb_ms is None:
                            ttfb_ms = (time.perf_counter() - t_start) * 1000
                            print(f"⚡ [TTS] Speaker started (TTFB {ttfb_ms:.0f}ms)")
                        chunks.append(chunk)
                        try:
                            proc.stdin.write(chunk)
                            proc.stdin.flush()
                        except BrokenPipeError:
                            break
                try:
                    if proc.stdin:
                        proc.stdin.close()
                    proc.wait(timeout=120)
                except Exception:
                    proc.kill()

                if chunks:
                    file_path.write_bytes(b"".join(chunks))

        with track("tts_playback"):
            pass  # playback happened during stream

        print(f"✅ [TTS] Stream speak complete ({OPENAI_VOICE}): {text[:40]}...")
        return ttfb_ms
    except Exception as exc:
        print(f"⚠️ [TTS] Stream failed ({exc}), blocking fallback")
        speak(text, lang)
        return None


def _play_pygame(file_path: Path) -> bool:
    try:
        import pygame

        pygame.mixer.init()
        pygame.mixer.music.load(str(file_path))
        pygame.mixer.music.play()
        while pygame.mixer.music.get_busy():
            time.sleep(0.1)
        return True
    except Exception as exc:
        print(f"❌ [TTS] pygame playback failed: {exc}")
        return False


def _play_mp3(file_path: Path) -> bool:
    with track("tts_playback"):
        if USE_PYGAME or IS_WINDOWS:
            return _play_pygame(file_path)

        for attempt in range(3):
            try:
                cmd = _mpg123_cmd() + [str(file_path)]
                subprocess.run(
                    cmd,
                    check=True,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                return True
            except FileNotFoundError:
                return _play_pygame(file_path)
            except subprocess.CalledProcessError:
                print(f"⚠️ [TTS] Playback attempt {attempt + 1} failed")
                time.sleep(0.8 if REALTIME_MODE else 1.5)
    return False


def speak(text, lang="english"):
    """Speak text — uses stream mode automatically in REALTIME_MODE."""
    if REALTIME_MODE and TTS_STREAMING:
        speak_stream(text, lang)
        return
    try:
        text = (text or "").strip()
        if not text:
            print("⚠️ [TTS] Empty text — nothing to speak")
            return
        language = _normalize_lang(lang)
        print(f"🔊 [TTS] Playing on speaker ({OPENAI_VOICE}/{language}): {text[:80]!r}")
        file_path = _cache_path(text, language)

        if not file_path.exists():
            print("🔊 [TTS] Generating audio via OpenAI TTS...")
            ok = _generate_openai(text, language, file_path)
            if not ok:
                print("⚠️ [TTS] OpenAI TTS failed — trying gTTS fallback")
                ok = _generate_gtts(text, language, file_path)
            if not ok:
                print("❌ [TTS] could not generate audio")
                return

        if _play_mp3(file_path):
            print(f"✅ [TTS] Spoke successfully: {text[:40]}...")
        else:
            print(f"❌ [TTS] Playback failed: {file_path}")
    except Exception as e:
        print(f"❌ [TTS] Error in speech engine: {e}")
