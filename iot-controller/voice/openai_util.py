"""
Shared OpenAI client for Care Companion Pi stack (STT / LLM / TTS).
Loads OPENAI_API_KEY from process env or /home/carecompanion/.env.
"""
from __future__ import annotations

import os
from pathlib import Path

_client = None
_key_logged = False


def load_openai_key() -> str | None:
    """Return OpenAI API key; also sets os.environ['OPENAI_API_KEY'] when found in .env."""
    key = (os.getenv("OPENAI_API_KEY") or "").strip()
    if key:
        return key

    for env_path in (
        Path(__file__).resolve().parents[1] / ".env",  # iot-controller/.env
        Path.home() / ".env",
        Path("/home/carecompanion/.env"),
        Path("/home/carecompanion/Care-companion/backend/.env"),
    ):
        try:
            if not env_path.exists():
                continue
            for line in env_path.read_text(encoding="utf-8", errors="ignore").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                if k.strip() != "OPENAI_API_KEY":
                    continue
                val = v.strip().strip('"').strip("'")
                if val:
                    os.environ["OPENAI_API_KEY"] = val
                    return val
        except Exception:
            continue
    return None


def mask_key(key: str | None) -> str:
    if not key:
        return "(missing)"
    if len(key) < 12:
        return "***"
    return f"{key[:7]}...{key[-4:]}"


def log_openai_key_status(once: bool = True) -> bool:
    """Print whether ChatGPT/OpenAI key is available. Returns True if key present."""
    global _key_logged
    key = load_openai_key()
    ok = bool(key)
    if once and _key_logged:
        return ok
    _key_logged = True
    if ok:
        print(f"🔑 OpenAI API key loaded: {mask_key(key)} (ChatGPT STT/LLM/TTS)")
    else:
        print(
            "❌ OPENAI_API_KEY missing — add it to /home/carecompanion/.env "
            "then restart main.py (STT/LLM/TTS will fail or use weak fallbacks)"
        )
    return ok


def get_openai_client():
    """Singleton OpenAI client using .env key."""
    global _client
    if _client is not None:
        return _client
    api_key = load_openai_key()
    if not api_key:
        return None
    from openai import OpenAI

    _client = OpenAI(api_key=api_key)
    return _client
