"""
Care Companion Emotion Service (Raspberry Pi) — port 5001

POST /predict  multipart field `audio` → { mood, confidence }

Primary model:
  ehcalabres/wav2vec2-lg-xlsr-en-speech-emotion-recognition (Hugging Face)

Rules (project spec):
  - Strict 4 emotions only: happy, angry, sad, neutral
  - Silent / empty / low-confidence audio → always neutral (no biased guesses)
  - Never crash — ultimate fallback is neutral
"""
from __future__ import annotations

import os
import tempfile
import traceback
import wave
from pathlib import Path

from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

VALID = {"happy", "sad", "angry", "neutral"}
# Below this score → force neutral (no biased random mood)
MIN_CONFIDENCE = float(os.getenv("EMOTION_MIN_CONFIDENCE", "0.45"))
# RMS below this ≈ silence / near-silence
SILENCE_RMS = float(os.getenv("EMOTION_SILENCE_RMS", "180"))

_classifier = None
_classifier_tried = False


def _load_openai_key() -> str | None:
    key = os.getenv("OPENAI_API_KEY", "").strip()
    if key:
        return key
    for env_path in (
        Path(__file__).resolve().parent / ".env",
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


def _map_label(raw: str) -> str:
    """Map model labels → exactly one of the 4 primary emotions."""
    t = str(raw or "").lower().strip()
    if any(x in t for x in ("happy", "joy", "hap", "excited")):
        return "happy"
    if any(x in t for x in ("sad", "sorrow")):
        return "sad"
    if any(x in t for x in ("ang", "anger", "mad", "frustrat")):
        return "angry"
    # fear/disgust/surprise/calm → neutral (avoid biasing into sad/angry)
    if any(x in t for x in ("neu", "calm", "normal", "fear", "disgust", "surprise")):
        return "neutral"
    return "neutral"


def _audio_is_silent(audio_path: str) -> bool:
    """Return True if file missing, too short, or near-silent (no usable voice)."""
    try:
        path = Path(audio_path)
        if not path.exists() or path.stat().st_size < 44:
            return True

        # Prefer WAV RMS; for other formats try soundfile/numpy if available
        if path.suffix.lower() == ".wav":
            with wave.open(str(path), "rb") as wf:
                n = wf.getnframes()
                if n < int(wf.getframerate() * 0.25):  # < 0.25s
                    return True
                frames = wf.readframes(n)
                width = wf.getsampwidth()
                if width != 2 or not frames:
                    return True
                import array

                samples = array.array("h")
                samples.frombytes(frames)
                if not samples:
                    return True
                # subsample for speed
                step = max(1, len(samples) // 8000)
                acc = 0.0
                count = 0
                for i in range(0, len(samples), step):
                    acc += float(samples[i]) * float(samples[i])
                    count += 1
                rms = (acc / max(count, 1)) ** 0.5
                if rms < SILENCE_RMS:
                    print(f"🔇 Silent/near-silent audio (rms={rms:.1f}) → neutral")
                    return True
                return False

        try:
            import numpy as np
            import soundfile as sf

            data, sr = sf.read(str(path), dtype="float32", always_2d=False)
            if data is None or len(data) < int(sr * 0.25):
                return True
            mono = data if data.ndim == 1 else data.mean(axis=1)
            rms = float(np.sqrt(np.mean(mono**2))) * 32768.0
            if rms < SILENCE_RMS:
                print(f"🔇 Silent/near-silent audio (rms={rms:.1f}) → neutral")
                return True
            return False
        except Exception:
            # Unknown format — let classifier try; confidence gate still applies
            return False
    except Exception as exc:
        print(f"⚠️ Silence check failed ({exc}) — treating as silent → neutral")
        return True


def _apply_gates(mood: str, confidence: float) -> tuple[str, float]:
    """Strict 4-emotion + low-confidence → neutral."""
    mood = mood if mood in VALID else "neutral"
    conf = max(0.0, min(1.0, float(confidence)))
    if conf < MIN_CONFIDENCE:
        print(f"⚖️ Low confidence {conf:.2f} < {MIN_CONFIDENCE} → neutral")
        return "neutral", conf
    return mood, conf


def _get_classifier():
    global _classifier, _classifier_tried
    if _classifier_tried:
        return _classifier
    _classifier_tried = True
    try:
        print("⏳ Loading Hugging Face Emotion Model...")
        from transformers import pipeline

        model_id = os.getenv(
            "EMOTION_MODEL",
            "ehcalabres/wav2vec2-lg-xlsr-en-speech-emotion-recognition",
        )
        _classifier = pipeline(
            "audio-classification",
            model=model_id,
            top_k=1,
        )
        print(f"✅ Emotion model ready: {model_id}")
    except Exception as exc:
        print(f"⚠️ HF emotion model unavailable: {exc}")
        _classifier = None
    return _classifier


def _predict_hf(audio_path: str) -> tuple[str, float] | None:
    clf = _get_classifier()
    if not clf:
        return None
    try:
        results = clf(audio_path)
        if isinstance(results, list) and results:
            top = results[0]
            if isinstance(top, list) and top:
                top = top[0]
            label = _map_label(top.get("label", "neutral"))
            score = float(top.get("score", 0.0))
            return _apply_gates(label, score)
    except Exception as exc:
        print(f"⚠️ HF predict failed: {exc}")
    return None


def _predict_openai(audio_path: str) -> tuple[str, float] | None:
    """Fallback only when HF model missing — still gated to 4 emotions / neutral."""
    api_key = _load_openai_key()
    if not api_key:
        return None
    try:
        from openai import OpenAI

        client = OpenAI(api_key=api_key)
        with open(audio_path, "rb") as f:
            transcript = client.audio.transcriptions.create(
                model="whisper-1",
                file=f,
            )
        text = (transcript.text or "").strip()
        if not text:
            return "neutral", 0.3

        resp = client.chat.completions.create(
            model=os.getenv("OPENAI_CHAT_MODEL", "gpt-4o-mini"),
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Classify the speaker's emotion from this transcript. "
                        "Reply with ONLY one word: happy, sad, angry, or neutral. "
                        "If unclear, reply neutral."
                    ),
                },
                {"role": "user", "content": text},
            ],
            max_tokens=5,
            temperature=0,
        )
        mood = _map_label(resp.choices[0].message.content or "neutral")
        return _apply_gates(mood, 0.7)
    except Exception as exc:
        print(f"⚠️ OpenAI emotion fallback failed: {exc}")
        return None


def predict_file(audio_path: str) -> dict:
    # Spec: no voice / silent → strict neutral (no biased prediction)
    if _audio_is_silent(audio_path):
        return {"mood": "neutral", "confidence": 0.0, "reason": "silent_or_empty"}

    result = _predict_hf(audio_path)
    if not result:
        result = _predict_openai(audio_path)
    if not result:
        result = ("neutral", 0.0)

    mood, confidence = _apply_gates(result[0], result[1])
    return {"mood": mood, "confidence": float(confidence)}


@app.route("/health", methods=["GET"])
def health():
    return jsonify(
        {
            "status": "ok",
            "service": "emotion",
            "port": 5001,
            "model": os.getenv(
                "EMOTION_MODEL",
                "ehcalabres/wav2vec2-lg-xlsr-en-speech-emotion-recognition",
            ),
            "emotions": sorted(VALID),
            "min_confidence": MIN_CONFIDENCE,
        }
    ), 200


@app.route("/predict", methods=["POST"])
def predict():
    tmp_path = None
    try:
        if "audio" not in request.files:
            return jsonify(
                {"message": "audio file required", "mood": "neutral", "confidence": 0}
            ), 400

        audio = request.files["audio"]
        suffix = Path(audio.filename or "audio.wav").suffix or ".wav"
        fd, tmp_path = tempfile.mkstemp(suffix=suffix)
        os.close(fd)
        audio.save(tmp_path)

        out = predict_file(tmp_path)
        print(f"🎭 Emotion: {out['mood']} ({out['confidence']:.2f})")
        return jsonify(out), 200
    except Exception as exc:
        traceback.print_exc()
        # Spec: never biased crash output — always neutral
        return jsonify({"mood": "neutral", "confidence": 0.0, "error": str(exc)}), 200
    finally:
        if tmp_path:
            try:
                os.remove(tmp_path)
            except Exception:
                pass


if __name__ == "__main__":
    print("🎭 Emotion service starting on :5001")
    print(f"   Model: ehcalabres/wav2vec2-lg-xlsr-en-speech-emotion-recognition")
    print(f"   Emotions: {sorted(VALID)} | min_conf={MIN_CONFIDENCE}")
    _get_classifier()
    app.run(host="0.0.0.0", port=5001, use_reloader=False)
