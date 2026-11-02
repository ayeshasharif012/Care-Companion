"""
Emotion-aware voice chat + short calming storytelling for Care Companion.
"""
from __future__ import annotations

import os
import time
from pathlib import Path

try:
    from voice.latency import track
except ImportError:
    from contextlib import contextmanager

    @contextmanager
    def track(_name):
        yield

BACKEND_URL = os.getenv("BACKEND_URL", "http://192.168.1.92:5000").rstrip("/")
EMOTION_SERVICE_URL = os.getenv("EMOTION_SERVICE_URL", "http://127.0.0.1:5001").rstrip("/")

_openai_client = None
_emotion_cache: dict = {}  # user_id -> (emotion, expires_at)
EMOTION_CACHE_TTL = int(os.getenv("EMOTION_CACHE_TTL", "60"))


def _normalize_emotion(raw) -> str:
    mood = str(raw or "neutral").lower().strip()
    return mood if mood in ("happy", "sad", "angry", "neutral") else "neutral"


def predict_emotion_from_audio(audio_file_path: str | None) -> tuple[str, float]:
    """Classify mood from a Pi mic WAV via local emotion service (:5001)."""
    if not audio_file_path or not os.path.isfile(audio_file_path):
        return "neutral", 0.0
    if os.getenv("CHAT_SKIP_EMOTION", "").lower() in ("1", "true", "yes"):
        return "neutral", 0.0
    try:
        import requests

        with track("emotion_predict"):
            with open(audio_file_path, "rb") as f:
                r = requests.post(
                    f"{EMOTION_SERVICE_URL}/predict",
                    files={"audio": ("audio.wav", f, "audio/wav")},
                    timeout=float(os.getenv("EMOTION_PREDICT_TIMEOUT", "20")),
                )
        if r.ok:
            data = r.json() or {}
            mood = _normalize_emotion(data.get("mood") or data.get("emotion"))
            conf = float(data.get("confidence") or 0.0)
            # Mirror service gate: low conf / silent → neutral
            min_conf = float(os.getenv("EMOTION_MIN_CONFIDENCE", "0.45"))
            if conf < min_conf:
                mood = "neutral"
            print(f"🎭 Live Pi mic emotion: {mood} ({conf:.2f})")
            return mood, conf
    except Exception as exc:
        print(f"⚠️ Live emotion predict failed: {exc}")
    return "neutral", 0.0


def save_emotion_to_backend(user_id: str | None, emotion: str, confidence: float = 0.5) -> None:
    """Persist Pi-detected mood so the mobile app can poll /latest."""
    if not user_id or not emotion:
        return
    try:
        import requests

        requests.post(
            f"{BACKEND_URL}/api/emotion/save",
            json={
                "userId": str(user_id),
                "emotion": _normalize_emotion(emotion),
                "confidence": float(confidence or 0.5),
            },
            timeout=6,
        )
        _emotion_cache[str(user_id)] = (
            _normalize_emotion(emotion),
            time.time() + EMOTION_CACHE_TTL,
        )
    except Exception as exc:
        print(f"⚠️ Emotion save failed: {exc}")


def _load_openai_key() -> str | None:
    try:
        from voice.openai_util import load_openai_key

        return load_openai_key()
    except ImportError:
        key = os.getenv("OPENAI_API_KEY", "").strip()
        if key:
            return key
        for env_path in (
            Path(__file__).resolve().parents[2] / ".env",
            Path.home() / ".env",
            Path("/home/carecompanion/.env"),
        ):
            try:
                if not env_path.exists():
                    continue
                for line in env_path.read_text(encoding="utf-8", errors="ignore").splitlines():
                    if line.strip().startswith("OPENAI_API_KEY="):
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
        return _openai_client
    except ImportError:
        pass
    api_key = _load_openai_key()
    if not api_key:
        print("❌ [LLM] OPENAI_API_KEY missing — cannot call ChatGPT")
        return None
    from openai import OpenAI

    _openai_client = OpenAI(api_key=api_key)
    return _openai_client


def _normalize_lang(lang: str) -> str:
    raw = str(lang or "english").lower().strip()
    if raw in ("ur", "urdu") or "urdu" in raw:
        return "urdu"
    return "english"


def _fetch_latest_emotion(user_id: str) -> str:
    if not user_id:
        return "neutral"
    if os.getenv("CHAT_SKIP_EMOTION", "").lower() in ("1", "true", "yes"):
        return "neutral"

    uid = str(user_id)
    now = time.time()
    cached = _emotion_cache.get(uid)
    if cached and cached[1] > now:
        return cached[0]

    try:
        import requests

        with track("emotion_fetch"):
            r = requests.get(
                f"{BACKEND_URL}/api/emotion/latest/{uid}",
                timeout=float(os.getenv("EMOTION_FETCH_TIMEOUT", "1.5")),
            )
        if r.ok:
            data = r.json() or {}
            emo = (data.get("emotion") or {}).get("emotion") or data.get("emotion") or "neutral"
            mood = str(emo).lower().strip()
            _emotion_cache[uid] = (mood, now + EMOTION_CACHE_TTL)
            return mood
    except Exception:
        pass
    return "neutral"


def _tone_for_emotion(emotion: str) -> str:
    """Dynamic storytelling / reply tone per project spec."""
    e = _normalize_emotion(emotion)
    if e == "happy":
        return (
            "Tone: cheerful, warm, and upbeat. Keep the story light and positive "
            "so the listener's joy is gently celebrated."
        )
    if e in ("sad", "angry"):
        return (
            "Tone: calm, soothing, and empathetic. Soft pacing, gentle imagery, "
            "help the listener feel safe and relaxed. Do not lecture or scold."
        )
    return (
        "Tone: clear, friendly, standard conversational storytelling — "
        "neither overly excited nor overly solemn."
    )


def _wants_story(user_text: str) -> bool:
    low = (user_text or "").lower()
    return any(
        w in low
        for w in (
            "story",
            "kahani",
            "کہانی",
            "sunao",
            "tell me a story",
            "storytelling",
            "sunaao",
            "suna do",
        )
    )


def _fallback_reply(user_text: str, emotion: str, language: str) -> str:
    is_urdu = _normalize_lang(language) == "urdu"
    emotion = _normalize_emotion(emotion)
    if _wants_story(user_text) or emotion in ("sad", "angry", "happy", "neutral"):
        # Prefer emotion-matched short story when story requested OR mood needs support
        if _wants_story(user_text) or emotion in ("sad", "angry"):
            if emotion == "happy":
                if is_urdu:
                    return (
                        "آئیے ایک خوشگوار چھوٹی سی کہانی سنتے ہیں۔ "
                        "ایک روشن صبح باغ میں پرندے گائے، دھوپ نرم تھی، اور دل ہلکا سا مسکرایا۔ "
                        "آپ کی خوشی قیمتی ہے — میں آپ کے ساتھ خوش ہوں۔"
                    )
                return (
                    "Here is a cheerful little story. "
                    "A bright morning filled the garden with soft light and birdsong, "
                    "and a warm smile settled easily. Your joy matters — I'm happy with you."
                )
            if emotion == "angry":
                if is_urdu:
                    return (
                        "میں ایک پرسکون کہانی سناتا ہوں۔ "
                        "ایک بے چین دریا جھیل تک پہنچ کر آہستہ ہو گیا، اور کنارے نے خاموشی سے سنا۔ "
                        "آپ کے جذبات اہم ہیں — سکون آہستہ واپس آ سکتا ہے۔"
                    )
                return (
                    "Here is a calm story. "
                    "A restless river slowed as it reached a quiet lake, and the shore listened "
                    "without judgment. Your feelings matter — peace can return gently."
                )
            # sad (and default soothing story)
            if is_urdu:
                return (
                    "میں آپ کے لیے ایک چھوٹی سی پرسکون کہانی سناتا ہوں۔ "
                    "ایک نرم ہوا باغ میں چلی، پتے مسکرائے، اور دل کو سکون مل گیا۔ "
                    "آپ محفوظ ہیں، اور میں آپ کے ساتھ ہوں۔"
                )
            return (
                "Here is a short calming story for you. "
                "A gentle breeze moved through a quiet garden, the leaves smiled, "
                "and peace settled softly. You are safe, and I am here with you."
            )
    if is_urdu:
        return "میں یہاں ہوں۔ آہستہ سانس لیں، سب ٹھیک ہو جائے گا۔ آپ کچھ اور پوچھ سکتے ہیں۔"
    return "I'm here with you. Take a slow breath — you're doing fine. You can ask me anything."


def warmup_chat():
    """Pre-connect OpenAI chat client."""
    _get_openai_client()


async def chat_controller(
    patient_id,
    user_text,
    language="english",
    audio_file_path=None,
    emotion_override=None,
    return_meta=False,
):
    """
    Supportive reply (and optional mini-story) using emotion from the same Pi mic clip.
    Prefer live audio → :5001/predict; fall back to Mongo latest. Always returns text.
    """
    emotion = "neutral"
    confidence = 0.0
    try:
        language = _normalize_lang(language)
        uid = str(patient_id) if patient_id else ""

        if emotion_override:
            emotion = _normalize_emotion(emotion_override)
            confidence = 0.9
        elif audio_file_path:
            emotion, confidence = predict_emotion_from_audio(audio_file_path)
            if uid:
                save_emotion_to_backend(uid, emotion, confidence)
        else:
            emotion = _normalize_emotion(_fetch_latest_emotion(uid))

        api_key = _load_openai_key()
        if not api_key:
            print("❌ [LLM] OPENAI_API_KEY missing — using offline fallback reply")
            text = _fallback_reply(user_text, emotion, language)
            return {"reply": text, "emotion": emotion, "confidence": confidence} if return_meta else text

        client = _get_openai_client()
        if not client:
            print("❌ [LLM] OpenAI client init failed — using offline fallback reply")
            text = _fallback_reply(user_text, emotion, language)
            return {"reply": text, "emotion": emotion, "confidence": confidence} if return_meta else text

        lang_name = "Urdu" if language == "urdu" else "English"
        wants_story = _wants_story(user_text)
        tone = _tone_for_emotion(emotion)
        model = os.getenv("OPENAI_CHAT_MODEL", "gpt-4o-mini")

        # Spec: detect emotion from current audio first, then adapt story/reply tone
        if wants_story or emotion in ("sad", "angry"):
            system = (
                f"You are Care Companion, a caregiver voice assistant on a home speaker. "
                f"Speak ONLY in {lang_name}. "
                f"Detected mood from the listener's voice: {emotion}. {tone} "
                f"Tell a short 4–6 sentence story matched to that tone. "
                f"Warm, simple words for an elderly listener. No medical advice. "
                f"End with one gentle supportive line."
            )
            max_tokens = int(os.getenv("CHAT_STORY_MAX_TOKENS", "180"))
        elif emotion == "happy":
            system = (
                f"You are Care Companion on a home speaker. Speak ONLY in {lang_name}. "
                f"Detected mood: happy. {tone} "
                f"Reply in 1–3 short cheerful sentences, or if they ask for a story, "
                f"tell a brief upbeat 4–6 sentence story. No medical advice."
            )
            max_tokens = int(os.getenv("CHAT_MAX_TOKENS", "120"))
        else:
            system = (
                f"You are Care Companion, a warm voice caregiver on a home speaker. "
                f"Speak ONLY in {lang_name}. Detected mood: neutral. {tone} "
                f"Have a supportive conversation in 1–3 short sentences. "
                f"Be present, clear, and kind. No medical advice."
            )
            max_tokens = int(os.getenv("CHAT_MAX_TOKENS", "120"))

        print(f"🧠 [LLM] Sending to OpenAI ChatGPT ({model}) lang={language} emotion={emotion}...")
        print(f"🧠 [LLM] User text: {str(user_text)[:120]!r}")
        with track("gpt_chat"):
            resp = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user_text or "Hello"},
                ],
                max_tokens=max_tokens,
                temperature=0.7,
            )
        text = (resp.choices[0].message.content or "").strip()
        text = text or _fallback_reply(user_text, emotion, language)
        print(f"✅ [LLM] OpenAI response received ({len(text)} chars): {text[:120]!r}")
        return {"reply": text, "emotion": emotion, "confidence": confidence} if return_meta else text
    except Exception as exc:
        print(f"❌ chat_controller error: {exc}")
        text = _fallback_reply(user_text or "", emotion or "neutral", language)
        return {"reply": text, "emotion": emotion or "neutral", "confidence": confidence} if return_meta else text


def generate_story(emotion="neutral", language="english") -> str:
    """Sync helper — story tone follows detected emotion (happy/sad/angry/neutral)."""
    import asyncio

    emotion = _normalize_emotion(emotion)
    if emotion == "happy":
        prompt = "Please tell me a cheerful short story."
    elif emotion in ("sad", "angry"):
        prompt = "Please tell me a calm soothing story."
    else:
        prompt = "Please tell me a short friendly story."
    try:
        loop = asyncio.new_event_loop()
        try:
            return loop.run_until_complete(
                chat_controller(
                    None,
                    prompt,
                    language=language,
                    audio_file_path=None,
                    emotion_override=emotion,
                )
            )
        finally:
            loop.close()
    except Exception:
        return _fallback_reply(prompt, emotion, language)
