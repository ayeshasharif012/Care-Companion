"""
Speech-to-text for Care Companion (Raspberry Pi mic).

Modes (env):
  USE_VAD=1              — stop recording on silence (near-realtime)
  USE_LOCAL_STT=1        — faster-whisper on Pi (no cloud upload)
  default                — OpenAI Whisper API

Anti-hallucination:
  - Never send silent/near-silent audio to Whisper
  - temperature=0, high no_speech_threshold (local)
  - verbose_json no_speech_prob gate (API)
  - Reject YouTube outro / prompt-echo phrases
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path

from voice.stt.audio_io import WHISPER_SAMPLE_RATE

try:
    from voice.latency import track
except ImportError:
    from contextlib import contextmanager

    @contextmanager
    def track(_name):
        yield

_openai_client = None
_local_whisper = None

DEFAULT_RECORD_SECONDS = float(os.getenv("RECORD_MAX_SECONDS", "6"))
USE_VAD = os.getenv("USE_VAD", "1").lower() in ("1", "true", "yes")
USE_LOCAL_STT = os.getenv("USE_LOCAL_STT", "0").lower() in ("1", "true", "yes")
LOCAL_WHISPER_MODEL = os.getenv("LOCAL_WHISPER_MODEL", "tiny")

# Whisper decoding — allow quieter USB mics; still reject pure silence
WHISPER_TEMPERATURE = float(os.getenv("WHISPER_TEMPERATURE", "0"))
WHISPER_NO_SPEECH_THRESHOLD = float(os.getenv("WHISPER_NO_SPEECH_THRESHOLD", "0.78"))
WHISPER_LOGPROB_THRESHOLD = float(os.getenv("WHISPER_LOGPROB_THRESHOLD", "-1.0"))
WHISPER_COMPRESSION_RATIO_THRESHOLD = float(
    os.getenv("WHISPER_COMPRESSION_RATIO_THRESHOLD", "2.4")
)
# Soft digital gain when USB mic peak is low (helps Whisper hear real speech)
MIC_GAIN = float(os.getenv("MIC_GAIN", "2.0"))
MIC_GAIN_PEAK_TARGET = float(os.getenv("MIC_GAIN_PEAK_TARGET", "8000"))

NO_SPEECH = "No speech"


def _mic_device():
    """Input device index — uses audio_io (auto-fixes ALSA card# vs PortAudio index)."""
    from voice.stt.audio_io import mic_device_index

    return mic_device_index()


def _normalize_lang(lang: str) -> str:
    raw = str(lang or "english").lower().strip()
    if raw in ("ur", "urdu") or "urdu" in raw:
        return "urdu"
    return "english"


def _whisper_lang(lang: str) -> str:
    return "ur" if _normalize_lang(lang) == "urdu" else "en"


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
        return None
    from openai import OpenAI

    _openai_client = OpenAI(api_key=api_key)
    return _openai_client


def _get_local_whisper():
    global _local_whisper
    if _local_whisper is not None:
        return _local_whisper
    try:
        from faster_whisper import WhisperModel

        print(f"⏳ Loading local Whisper ({LOCAL_WHISPER_MODEL})...")
        _local_whisper = WhisperModel(
            LOCAL_WHISPER_MODEL,
            device="cpu",
            compute_type="int8",
        )
        print("✅ Local Whisper ready")
        return _local_whisper
    except Exception as exc:
        print(f"⚠️ Local STT unavailable: {exc}")
        return None


def warmup_stt():
    """Pre-load clients/models for lower first-turn latency."""
    if USE_LOCAL_STT:
        _get_local_whisper()
    else:
        _get_openai_client()


def _normalize_int16(audio):
    try:
        from voice.stt.audio_io import normalize_int16

        return normalize_int16(audio)
    except ImportError:
        # Fallback if Pi audio_io is stale
        import numpy as np

        arr = np.asarray(audio, dtype=np.float32).flatten()
        if arr.size == 0:
            return arr.astype(np.int16)
        arr -= float(np.mean(arr))
        peak = float(np.max(np.abs(arr)))
        if peak < 1.0:
            return arr.astype(np.int16)
        target = float(os.getenv("MIC_NORM_PEAK", "10000"))
        boost_cap = float(os.getenv("MIC_GAIN", "3.0"))
        scale = min(boost_cap, target / peak)
        out = np.clip(arr * scale, -32767, 32767)
        print(f"🎚️ Normalize(fallback) peak {peak:.0f} → {float(np.max(np.abs(out))):.0f}")
        return out.astype(np.int16)


def _amplify_int16(audio, gain: float | None = None):
    """Legacy name — always normalize (boost quiet / tame clipping)."""
    return _normalize_int16(audio)


def _vad_enabled() -> bool:
    """Re-read env each call (module import time can be wrong)."""
    return os.getenv("USE_VAD", "1").lower().strip() in ("1", "true", "yes")


def _record_wav_fixed(seconds: float, sample_rate: int = WHISPER_SAMPLE_RATE) -> str | None:
    try:
        import numpy as np
        import sounddevice as sd
        from voice.stt.audio_io import capture_sample_rate, save_wav

        try:
            from voice.stt.audio_io import highpass_int16
        except ImportError:
            highpass_int16 = None
        from voice.stt.vad import SILENCE_PEAK, SILENCE_RMS

        # Quiet DX-001 @ Mic 55–65%: speech often rms~280–400
        min_speech_peak = float(os.getenv("STT_MIN_SPEECH_PEAK", "900"))
        min_chunk_rms = float(os.getenv("STT_CHUNK_RMS", "280"))

        dev = _mic_device()
        cap_sr = capture_sample_rate(dev)
        chunk_s = 0.5
        n_chunks = max(1, int(round(float(seconds) / chunk_s)))
        chunk_frames = int(chunk_s * cap_sr)
        print(
            f"🎙️ Recording {n_chunks * chunk_s:.1f}s FIXED (device={dev}, sr={cap_sr})"
        )
        print("   >>> SPEAK NOW for the FULL 5–6s — Hello how are you today <<<")
        parts = []
        rms_list = []
        speechish_chunks = 0
        with track("mic_record"):
            for i in range(n_chunks):
                kwargs = dict(
                    frames=chunk_frames,
                    samplerate=cap_sr,
                    channels=1,
                    dtype="int16",
                    blocking=True,
                )
                if dev is not None:
                    kwargs["device"] = dev
                audio = sd.rec(**kwargs)
                sd.wait()
                chunk = np.asarray(audio, dtype=np.float32).flatten()
                chunk -= float(np.mean(chunk)) if chunk.size else 0.0
                peak = float(np.max(np.abs(chunk))) if chunk.size else 0.0
                rms = float(np.sqrt(np.mean(chunk * chunk))) if chunk.size else 0.0
                rms_list.append(rms)
                chunk = np.clip(chunk, -14000, 14000)
                is_click = peak >= 8000 and rms < 400
                is_speechish = (not is_click) and (
                    rms >= min_chunk_rms
                    or (peak >= min_speech_peak and rms >= 200)
                )
                if is_speechish:
                    speechish_chunks += 1
                bar = int(min(20, max(peak / 2000.0, rms / 400.0) * 10))
                flag = ""
                if is_speechish:
                    flag = " << VOICE"
                elif is_click:
                    flag = " << CLICK/noise (not voice)"
                print(
                    f"   [{i*chunk_s:4.1f}s] peak={peak:6.0f} rms={rms:5.0f} "
                    f"{'█' * bar}{'░' * (20 - bar)}{flag}",
                    flush=True,
                )
                parts.append(chunk.astype(np.int16))

        audio = np.concatenate(parts) if parts else np.zeros(0, dtype=np.int16)
        try:
            from voice.stt.audio_io import despike_int16

            audio = despike_int16(audio)
        except Exception:
            audio = np.clip(audio.astype(np.float32), -14000, 14000).astype(np.int16)
        if highpass_int16 is not None:
            try:
                audio = highpass_int16(audio, cap_sr)
            except Exception:
                pass
        peak = float(np.max(np.abs(audio))) if audio.size else 0.0
        rms = float(np.sqrt(np.mean(audio.astype(np.float32) ** 2))) if audio.size else 0.0
        rms_arr = np.asarray(rms_list, dtype=np.float32)
        max_rms = float(np.max(rms_arr)) if rms_arr.size else 0.0
        rms_std = float(np.std(rms_arr)) if rms_arr.size else 0.0
        print(
            f"📊 Mic total peak={peak:.0f} rms={rms:.0f} "
            f"voice_chunks={speechish_chunks}/{n_chunks} "
            f"max_rms={max_rms:.0f} rms_std={rms_std:.0f}"
        )

        soft_ok = speechish_chunks >= 2 or max_rms >= min_chunk_rms
        force = os.getenv("STT_FORCE_SEND", "1").lower() in ("1", "true", "yes")

        def _save_dbg(arr, label: str) -> None:
            try:
                import shutil
                from pathlib import Path

                normed = _normalize_int16(arr)
                fd, tmp = tempfile.mkstemp(suffix=".wav")
                os.close(fd)
                save_wav(tmp, normed, cap_sr)
                dbg = Path.home() / "last_mic.wav"
                shutil.copyfile(tmp, dbg)
                print(f"💾 Saved {dbg} ({label}) — play: aplay {dbg}")
                try:
                    os.remove(tmp)
                except Exception:
                    pass
            except Exception as exc:
                print(f"⚠️ last_mic.wav save failed: {exc}")

        if not soft_ok and not force:
            _save_dbg(audio, "rejected")
            print(
                "🔇 No sustained voice. Speak CLOSE (2–5cm) for the FULL meter.\n"
                "   alsamixer -c 3 → Mic ~65%. Then: aplay ~/last_mic.wav"
            )
            return None

        if not soft_ok and force:
            print("⚠️ Soft levels — still sending to Whisper (STT_FORCE_SEND=1)")

        if peak < SILENCE_PEAK and rms < SILENCE_RMS and not force:
            _save_dbg(audio, "too-quiet")
            print(f"🔇 Too quiet → {NO_SPEECH}")
            return None

        audio = _normalize_int16(audio)
        fd, path = tempfile.mkstemp(suffix=".wav")
        os.close(fd)
        save_wav(path, audio, cap_sr)
        try:
            import shutil
            from pathlib import Path

            dbg = Path.home() / "last_mic.wav"
            shutil.copyfile(path, dbg)
            print(f"💾 Saved {dbg} — play: aplay {dbg}")
        except Exception:
            pass
        return path
    except Exception as exc:
        print(f"⚠️ Mic record failed: {exc}")
        return None


def _capture_audio(seconds: float, use_vad) -> str | None:
    """
    Capture mic audio. On silence / no speech → return None (do NOT fall back to
    a fixed silent recording — that causes Whisper YouTube hallucinations).
    use_vad: True/False/None — None re-reads USE_VAD from env (default on).
    """
    max_s = max(float(seconds), 4.0)
    if use_vad is None:
        vad_on = _vad_enabled()
    else:
        vad_on = bool(use_vad)

    print(f"🎛️ Capture mode: {'VAD' if vad_on else 'fixed'} (USE_VAD={os.getenv('USE_VAD')!r})")
    if vad_on:
        try:
            from voice.stt.vad import record_until_silence

            path, _dur = record_until_silence(max_seconds=max_s)
            if path:
                return path
            print(f"ℹ️ VAD: {NO_SPEECH}")
            # Always fall back to metered fixed record for DX-001
            if os.getenv("VAD_FALLBACK_FIXED", "1").lower() in ("1", "true", "yes"):
                print("🔄 Fixed metered fallback — watch the peak meter while you speak…")
                return _record_wav_fixed(min(max_s, 5.0))
            return None
        except Exception as exc:
            print(f"⚠️ VAD failed, fixed record fallback: {exc}")
            return _record_wav_fixed(max_s)
    return _record_wav_fixed(max_s)


def _transcribe_local(audio_path: str, language: str) -> str:
    model = _get_local_whisper()
    if not model:
        return ""
    try:
        with track("local_stt"):
            segments, info = model.transcribe(
                audio_path,
                language=_whisper_lang(language),
                beam_size=1,
                best_of=1,
                temperature=WHISPER_TEMPERATURE,
                vad_filter=True,
                condition_on_previous_text=False,
                no_speech_threshold=WHISPER_NO_SPEECH_THRESHOLD,
                compression_ratio_threshold=WHISPER_COMPRESSION_RATIO_THRESHOLD,
                log_prob_threshold=WHISPER_LOGPROB_THRESHOLD,
            )
            # If model thinks the whole clip is non-speech, abort
            try:
                if getattr(info, "language_probability", 1.0) is not None:
                    pass
            except Exception:
                pass

            parts = []
            for s in segments:
                # Per-segment no-speech / weak confidence
                nsp = float(getattr(s, "no_speech_prob", 0.0) or 0.0)
                if nsp >= WHISPER_NO_SPEECH_THRESHOLD:
                    continue
                t = (s.text or "").strip()
                if t:
                    parts.append(t)
            text = " ".join(parts).strip()
        if not text:
            return NO_SPEECH
        return text
    except Exception as exc:
        print(f"⚠️ Local STT failed: {exc}")
        return ""


def _transcribe_openai(audio_path: str, language: str) -> str:
    client = _get_openai_client()
    if not client:
        print("❌ [STT] OPENAI_API_KEY missing — cannot run Whisper")
        return ""

    def _once(lang_code: str | None, use_verbose: bool) -> str:
        with open(audio_path, "rb") as f:
            kwargs = {
                "model": "whisper-1",
                "file": f,
                "temperature": WHISPER_TEMPERATURE,
            }
            if lang_code:
                kwargs["language"] = lang_code
            if use_verbose:
                kwargs["response_format"] = "verbose_json"
            result = client.audio.transcriptions.create(**kwargs)

        text = (getattr(result, "text", None) or "").strip()
        print(f"📝 [STT] Whisper raw text: {text[:160]!r}")

        if not use_verbose:
            return text

        segments = getattr(result, "segments", None) or []
        if not segments:
            return text

        probs = []
        kept = []
        for seg in segments:
            if isinstance(seg, dict):
                nsp = float(seg.get("no_speech_prob") or 0.0)
                avg_lp = float(seg.get("avg_logprob") or 0.0)
                seg_text = (seg.get("text") or "").strip()
            else:
                nsp = float(getattr(seg, "no_speech_prob", 0.0) or 0.0)
                avg_lp = float(getattr(seg, "avg_logprob", 0.0) or 0.0)
                seg_text = (getattr(seg, "text", None) or "").strip()
            probs.append(nsp)
            # Soft gate: only drop clearly empty segments
            if nsp >= 0.9:
                continue
            if avg_lp < -1.2:
                continue
            if seg_text:
                kept.append(seg_text)
        if probs:
            avg_nsp = sum(probs) / len(probs)
            print(f"📝 [STT] no_speech_prob avg={avg_nsp:.2f} segments={len(segments)} kept={len(kept)}")
            # High no_speech → treat as silence even if tiny hallucinated text slipped through
            if avg_nsp >= 0.85:
                return NO_SPEECH
            if avg_nsp >= 0.9 and not kept and not text:
                return NO_SPEECH
        if kept:
            return " ".join(kept).strip()
        return text

    try:
        lang = _whisper_lang(language)
        print(f"📝 [STT] Sending mic audio to OpenAI Whisper (lang={lang})...")
        with track("whisper_stt"):
            text = _once(lang, use_verbose=True)

        # Retry without language only on hard empty — skip when verbose already
        # decided no-speech (language-free retry invents YouTube outros).
        if text == NO_SPEECH:
            print(f"ℹ️ [STT] Whisper returned empty/no-speech → {NO_SPEECH}")
            return NO_SPEECH
        if (not text) and os.path.getsize(audio_path) > 1000:
            print("🔄 [STT] Empty — retry Whisper without language lock...")
            with track("whisper_stt_retry"):
                text2 = _once(None, use_verbose=False)
            bad = (
                "thank you for watching!",
                "thanks for watching!",
                "you",
                "ご視聴",
                "視頻",
                "有難う",
            )
            low = (text2 or "").lower()
            if text2 and not any(b in low or b in (text2 or "") for b in bad):
                # Also reject CJK-only YouTube outros
                import re

                if not re.search(r"[\u3040-\u30ff\u4e00-\u9fff]", text2):
                    text = text2
                else:
                    print(f"🚫 [STT] Retry hallucination ignored: {text2[:60]!r}")
                    text = NO_SPEECH
            elif text2:
                print(f"🚫 [STT] Retry hallucination ignored: {text2[:60]!r}")
                text = NO_SPEECH

        if not text or text == NO_SPEECH:
            print(f"ℹ️ [STT] Whisper returned empty/no-speech → {NO_SPEECH}")
            return NO_SPEECH
        print(f"✅ [STT] Whisper transcription OK: {text[:120]!r}")
        return text
    except Exception as exc:
        print(f"⚠️ [STT] Whisper verbose failed ({exc}); retrying text mode")
        try:
            text = _once(_whisper_lang(language), use_verbose=False)
            if text:
                print(f"✅ [STT] Whisper transcription OK: {text[:120]!r}")
            return text or NO_SPEECH
        except Exception as exc2:
            print(f"❌ [STT] Whisper failed: {exc2}")
            return ""


def _transcribe(audio_path: str, language: str) -> str:
    # Do NOT silent-gate here after we already checked mic levels —
    # clipped/normalized speech was wrongly dropped as "silent" before.
    if USE_LOCAL_STT:
        text = _transcribe_local(audio_path, language)
        if text and text != NO_SPEECH:
            return text
        if text == NO_SPEECH:
            return NO_SPEECH
    return _transcribe_openai(audio_path, language)


def _is_real_speech(text: str) -> bool:
    """Filter Whisper hallucinations and no-speech markers."""
    stripped = (text or "").strip()
    if not stripped or stripped.lower() in ("no speech", "no_speech"):
        return False
    try:
        from voice.stt.vad import is_hallucination

        return not is_hallucination(stripped)
    except ImportError:
        bad = {
            "you",
            "You",
            "Thanks for watching!",
            "thanks for watching!",
            "Thank you for watching!",
            "Thank you.",
            "Thank you",
            ".",
            "..",
            "...",
            "",
        }
        if stripped in bad:
            return False
        words = [w for w in stripped.split() if w.strip(".,!?;:")]
        return len(words) >= 2


def listen(language="english", timeout=None, return_audio=False, use_vad=None):
    """
    Listen on mic → transcribe.
    Silence / hallucinations → None (logged as "No speech").
    use_vad: True/False/None (None = env USE_VAD, default on)
    """
    seconds = float(timeout if timeout is not None else DEFAULT_RECORD_SECONDS)
    # Re-read env every call — import-time USE_VAD is often stale/wrong
    if use_vad is None:
        vad = _vad_enabled()
    else:
        vad = bool(use_vad)

    audio_path = _capture_audio(seconds, vad)
    if not audio_path:
        print(f"ℹ️ {NO_SPEECH}")
        return (None, None) if return_audio else None

    text = _transcribe(audio_path, language)

    if not text or text.strip().lower() == NO_SPEECH.lower() or not _is_real_speech(text):
        if text and text.strip().lower() != NO_SPEECH.lower():
            print(f"🚫 STT rejected (hallucination/noise): '{text.strip()}'")
        else:
            print(f"ℹ️ {NO_SPEECH}")
        if return_audio:
            return None, audio_path
        try:
            os.remove(audio_path)
        except Exception:
            pass
        return None

    print(f"📝 [STT] Whisper success: {text[:80]}")
    if return_audio:
        return text, audio_path
    try:
        os.remove(audio_path)
    except Exception:
        pass
    return text
