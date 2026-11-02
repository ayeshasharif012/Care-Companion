"""
Voice Activity Detection — stop mic capture when user stops speaking.

Tuning (.env):
  VAD_ENERGY_THRESHOLD   default 1200 — absolute min; dynamic uses noise floor
  VAD_MIN_SPEECH_S       default 0.7  — min real speech before accept
  VAD_SILENCE_S          default 1.2  — pause after speech (Urdu-friendly)
  VAD_NOISE_MARGIN       default 2.5  — threshold >= floor * margin + pad
  MIC_DEVICE_INDEX       e.g. 1 for USB mic
  MIC_SAMPLE_RATE        e.g. 44100 when USB rejects 16000
"""
from __future__ import annotations

import os
import re
import tempfile
from typing import Optional, Tuple

from voice.stt.audio_io import WHISPER_SAMPLE_RATE, capture_sample_rate, mic_device_index, save_wav

try:
    from voice.latency import track
except ImportError:
    from contextlib import contextmanager

    @contextmanager
    def track(_name):
        yield

SAMPLE_RATE = WHISPER_SAMPLE_RATE
CHUNK_MS = int(os.getenv("VAD_CHUNK_MS", "100"))
MAX_RECORD_S = float(os.getenv("RECORD_MAX_SECONDS", "8"))
# Slightly longer silence window so Urdu phrases are not cut mid-pause
MIN_SPEECH_S = float(os.getenv("VAD_MIN_SPEECH_S", "0.6"))
SILENCE_S = float(os.getenv("VAD_SILENCE_S", "1.0"))
ENERGY_THRESHOLD = float(os.getenv("VAD_ENERGY_THRESHOLD", "500"))
DYNAMIC_THRESHOLD = os.getenv("VAD_DYNAMIC_THRESHOLD", "1").lower() in ("1", "true", "yes")
NOISE_FLOOR_CHUNKS = int(os.getenv("VAD_NOISE_FLOOR_CHUNKS", "8"))
# Cap must stay ABOVE noisy USB sound-card floors (DX-001 / USB Audio often ~2000–4000)
THRESHOLD_CAP = float(os.getenv("VAD_THRESHOLD_CAP", "12000"))
DYNAMIC_MULTIPLIER = float(os.getenv("VAD_DYNAMIC_MULTIPLIER", "1.15"))
# Never set listen threshold below noise_floor * this (fixes VAD always-on bug)
NOISE_MARGIN = float(os.getenv("VAD_NOISE_MARGIN", "1.12"))
# Extra headroom above floor (absolute) — speech on DX-001 often only +300–800 RMS
NOISE_PAD = float(os.getenv("VAD_NOISE_PAD", "280"))
# After speech starts, keep at least this many seconds before silence can stop
MIN_KEEP_S = float(os.getenv("VAD_MIN_KEEP_S", "1.2"))

# Peak/RMS gates — quiet USB mics often sit ~300–800 peak; don't reject too early
SILENCE_PEAK = float(os.getenv("STT_SILENCE_PEAK", "250"))
SILENCE_RMS = float(os.getenv("STT_SILENCE_RMS", "80"))

STT_MIN_WORDS = int(os.getenv("STT_MIN_WORDS", "2"))
STT_REJECT_SINGLE = os.getenv("STT_REJECT_SINGLE", "1").lower() in ("1", "true", "yes")

NO_SPEECH = "No speech"

# Known Whisper hallucinations (YouTube outros, empty-room ghosts, prompt echo)
_WHISPER_HALLUCINATIONS = {
    "you",
    "You",
    "Thank you.",
    "Thank you",
    "Thank you!",
    "Thanks.",
    "Thanks",
    "Thanks for watching!",
    "Thanks for watching",
    "Thanks for watching.",
    "thanks for watching!",
    "thanks for watching",
    "Thank you for watching!",
    "Thank you for watching",
    "Thank you for watching.",
    "Thanks for watching. Please subscribe.",
    "Please subscribe",
    "please subscribe",
    "Subscribe",
    "Subscribe.",
    "subscribe.",
    "Like and subscribe",
    "like and subscribe",
    "Don't forget to subscribe",
    "See you next time",
    "see you next time",
    "Bye.",
    "bye.",
    "Bye!",
    "Goodbye",
    "goodbye",
    "MBC",
    "字幕",
    "字幕by",
    ".",
    "..",
    "...",
    "…",
    "-",
    "",
    "♪",
    "♫",
    "(silence)",
    "[silence]",
    "[BLANK_AUDIO]",
    "blank audio",
    "Silence.",
    "silence",
    NO_SPEECH.lower(),
    "no speech",
    "No speech.",
    # Whisper echoes Urdu prompt when mic is quiet
    "اردو گفتگو ہے۔ صرف اردو رسم الخط میں لکھیں۔",
    "اردو گفتگو ہے۔ صرف اردو رسم خط میں لکھیں۔",
    "اردو گفتگو",
    "اردو گفتگو۔",
    "اردو۔",
    "یہ اردو گفتگو ہے۔ صرف اردو رسم الخط میں لکھیں۔",
}

_HALLUCINATION_SUBSTR = (
    "اردو رسم",
    "صرف اردو",
    "گفتگو ہے۔ صرف",
    "اردو گفتگو",
    "thanks for watching",
    "thank you for watching",
    "ご視聴",
    "視聴ありがとう",
    "ありがとうございました",
    "視頻",
    "有難う",
    "please subscribe",
    "like and subscribe",
    "don't forget to subscribe",
    "see you next time",
    "welcome back to my channel",
    "make sure to subscribe",
    "work of fiction",
    "subs by",
    "zeoranger",
    "transcribed by",
    "translated by",
    "mytrendyphone",
    "字幕",
    "amara.org",
    "www.",
    "http",
    "i'm a bird",
    "you're a bird",
    "it's a pig",
    "fellow birdies",
    "fried chicken",
    "department of state",
)

# Regex: pure punctuation / music notes only
_ONLY_NOISE_RE = re.compile(r"^[\s\W\d♪♫\[\]\(\)\.\,\!\?\-…]+$", re.UNICODE)


def is_hallucination(text: str) -> bool:
    """Return True if STT text is a known Whisper false-positive / no-speech artifact."""
    stripped = (text or "").strip()
    if not stripped:
        return True
    if stripped.lower() in ("no speech", "no_speech", "nospeech"):
        return True
    if stripped in _WHISPER_HALLUCINATIONS:
        return True
    lower = stripped.lower()
    if lower in {h.lower() for h in _WHISPER_HALLUCINATIONS}:
        return True
    for frag in _HALLUCINATION_SUBSTR:
        if frag in stripped or frag in lower:
            return True
    if _ONLY_NOISE_RE.match(stripped):
        return True
    # Repeated single token (a a a / perfect. perfect.)
    words = [w.strip(".,!?;:\"'").lower() for w in stripped.split() if w.strip(".,!?;:\"'")]
    if len(words) >= 4 and len(set(words)) <= 2:
        return True
    # Pure digits countdown
    if words and all(w.isdigit() for w in words):
        return True
    # Short English filler words alone
    if lower in {"uh", "um", "ah", "oh", "hmm", "mm", "mhm", "yeah", "ok", "okay"}:
        return True

    # Urdu/Arabic script: allow a single meaningful token (short replies)
    has_arabic = bool(re.search(r"[\u0600-\u06FF]", stripped))
    words_raw = [w for w in stripped.split() if w.strip(".,!?;:\"'")]
    if STT_REJECT_SINGLE and not has_arabic:
        if len(words_raw) < STT_MIN_WORDS:
            return True
    elif has_arabic:
        compact = re.sub(r"\s+", "", stripped)
        if len(compact) < 2:
            return True
    return False


def wav_is_silent(path: str) -> bool:
    """True if WAV is missing, too short, or near-silent (do not send to Whisper)."""
    try:
        import wave
        import array

        if not path or not os.path.isfile(path):
            return True
        with wave.open(path, "rb") as wf:
            n = wf.getnframes()
            sr = wf.getframerate() or WHISPER_SAMPLE_RATE
            if n < int(sr * 0.2):
                return True
            frames = wf.readframes(n)
            if wf.getsampwidth() != 2 or not frames:
                return True
            samples = array.array("h")
            samples.frombytes(frames)
            if not samples:
                return True
            step = max(1, len(samples) // 12000)
            peak = 0
            acc = 0.0
            count = 0
            for i in range(0, len(samples), step):
                v = abs(int(samples[i]))
                if v > peak:
                    peak = v
                acc += float(samples[i]) * float(samples[i])
                count += 1
            rms = (acc / max(count, 1)) ** 0.5
            if peak < SILENCE_PEAK or rms < SILENCE_RMS:
                print(f"🔇 Silent/low audio (peak={peak}, rms={rms:.0f}) → {NO_SPEECH}")
                return True
            return False
    except Exception as exc:
        print(f"⚠️ Silence check failed ({exc}) → treat as {NO_SPEECH}")
        return True


def _rms(raw: bytes) -> float:
    import numpy as np

    arr = np.frombuffer(raw, dtype=np.int16).astype(np.float32)
    if arr.size == 0:
        return 0.0
    arr -= float(np.mean(arr))
    # Simple differentiator ≈ high-pass — cuts USB rumble that inflates RMS
    if arr.size > 2:
        arr = np.diff(arr, prepend=arr[0])
    return float(np.sqrt(np.mean(arr * arr)))


def _peak(raw: bytes) -> float:
    import numpy as np

    arr = np.frombuffer(raw, dtype=np.int16).astype(np.float32)
    if arr.size == 0:
        return 0.0
    arr -= float(np.mean(arr))
    return float(np.max(np.abs(arr)))


def _measure_noise_floor(capture_sr: int, mic_dev: int | None) -> float:
    """Record a few chunks and return mean RMS (background noise)."""
    try:
        import numpy as np
        import sounddevice as sd

        chunk_frames = int(capture_sr * CHUNK_MS / 1000)
        energies = []
        for _ in range(NOISE_FLOOR_CHUNKS):
            kwargs = dict(
                frames=chunk_frames,
                samplerate=capture_sr,
                channels=1,
                dtype="int16",
                blocking=True,
            )
            if mic_dev is not None:
                kwargs["device"] = mic_dev
            chunk = sd.rec(**kwargs)
            sd.wait()
            energies.append(_rms(chunk.tobytes()))
        # Use median — USB spikes inflate mean
        return float(np.median(energies)) if energies else 0.0
    except Exception:
        return 0.0


def record_until_silence(
    max_seconds: float = MAX_RECORD_S,
    sample_rate: int = SAMPLE_RATE,
) -> Tuple[Optional[str], float]:
    """
    Record from mic (device + rate from MIC_DEVICE_INDEX / MIC_SAMPLE_RATE).
    Stop after sustained silence following enough speech.
    Returns (wav_path, seconds) or (None, 0) when no speech / silence.
    """
    import numpy as np
    import sounddevice as sd

    mic_dev = mic_device_index()
    capture_sr = capture_sample_rate(mic_dev)

    chunk_frames = int(capture_sr * CHUNK_MS / 1000)
    max_chunks = int(max_seconds * 1000 / CHUNK_MS)
    min_speech_chunks = max(1, int(MIN_SPEECH_S * 1000 / CHUNK_MS))
    silence_chunks_needed = max(1, int(SILENCE_S * 1000 / CHUNK_MS))
    # Lead-in: wait for speech without starting the max clock too aggressively
    pre_roll_chunks = int(float(os.getenv("VAD_PREROLL_S", "0.3")) * 1000 / CHUNK_MS)
    # Need N consecutive chunks above threshold (rejects USB click spikes)
    start_streak = max(1, int(os.getenv("VAD_START_STREAK", "2")))

    threshold = ENERGY_THRESHOLD
    noise_floor = 0.0
    if DYNAMIC_THRESHOLD:
        noise_floor = _measure_noise_floor(capture_sr, mic_dev)
        if noise_floor > 0:
            relative = max(
                noise_floor * DYNAMIC_MULTIPLIER,
                noise_floor * NOISE_MARGIN + NOISE_PAD,
            )
            # Noisy USB: speech often sits only slightly above floor — use absolute pad
            if noise_floor >= 1200:
                relative = min(relative, noise_floor + max(NOISE_PAD, 350))
            threshold = max(ENERGY_THRESHOLD, relative)
            threshold = min(threshold, THRESHOLD_CAP)
            min_ok = noise_floor * NOISE_MARGIN + NOISE_PAD
            if noise_floor >= 1200:
                min_ok = min(min_ok, noise_floor + max(NOISE_PAD, 350))
            if threshold < min_ok:
                threshold = min_ok
            print(
                f"🔇 Noise floor={noise_floor:.0f} → threshold={threshold:.0f} "
                f"(margin={NOISE_MARGIN}, energy_min={ENERGY_THRESHOLD:.0f}, cap={THRESHOLD_CAP:.0f})"
            )
            if noise_floor > 1500:
                print(
                    "⚠️ High USB noise — lower Mic Capture (~45–55) + turn Auto Gain OFF"
                )

    print(
        f"🎙️ VAD listening (max {max_seconds:.1f}s, device={mic_dev}, "
        f"sr={capture_sr}, threshold={threshold:.0f}, silence={SILENCE_S}s)..."
    )
    print("   >>> Speak into USB mic — say: Hello care companion <<<")

    buffers = []
    speech_started = False
    silent_run = 0
    speech_chunks = 0
    waited = 0
    peak_seen = 0.0
    above_streak = 0
    pre_roll: list[bytes] = []
    kept_chunks = 0
    min_keep_chunks = max(1, int(MIN_KEEP_S * 1000 / CHUNK_MS))

    with track("mic_record"):
        with track("vad_capture"):
            for i in range(max_chunks + pre_roll_chunks):
                kwargs = dict(
                    frames=chunk_frames,
                    samplerate=capture_sr,
                    channels=1,
                    dtype="int16",
                    blocking=True,
                )
                if mic_dev is not None:
                    kwargs["device"] = mic_dev
                chunk = sd.rec(**kwargs)
                sd.wait()
                raw = chunk.tobytes()
                energy = _rms(raw)
                pk = _peak(raw)
                if energy > peak_seen:
                    peak_seen = energy
                # Live meter every ~0.5s
                if i % 5 == 0:
                    bar = int(min(40, energy / max(threshold, 1) * 20))
                    print(
                        f"   level={energy:6.0f} peak={pk:5.0f} need>{threshold:.0f} "
                        f"{'█' * bar}{'░' * (20 - bar)}"
                        f"{' << SPEECH' if energy >= threshold else ''}",
                        flush=True,
                    )

                # Pure electrical pop: huge peak but AC energy still near floor
                spike = pk > 30000 and energy < max(noise_floor * 1.8, ENERGY_THRESHOLD * 0.85)

                if not speech_started:
                    waited += 1
                    pre_roll.append(raw)
                    if len(pre_roll) > start_streak + 2:
                        pre_roll.pop(0)
                    if (not spike) and energy >= threshold:
                        above_streak += 1
                    else:
                        above_streak = 0
                    if above_streak >= start_streak:
                        speech_started = True
                        silent_run = 0
                        speech_chunks = above_streak
                        kept_chunks = above_streak
                        buffers.extend(pre_roll[-above_streak:])
                        print(f"✅ Speech started (energy={energy:.0f}) — keep talking…")
                    elif waited > max_chunks:
                        break
                    continue

                kept_chunks += 1
                if (not spike) and energy >= threshold:
                    silent_run = 0
                    speech_chunks += 1
                    buffers.append(raw)
                else:
                    buffers.append(raw)
                    silent_run += 1
                    # Do not cut off mid-sentence — enforce MIN_KEEP_S
                    if (
                        kept_chunks >= min_keep_chunks
                        and silent_run >= silence_chunks_needed
                        and speech_chunks >= min_speech_chunks
                    ):
                        break

                if kept_chunks >= max_chunks:
                    break

    if not buffers or speech_chunks < min_speech_chunks:
        # Soft accept: if we clearly heard speech energy, keep buffer anyway
        peak_audio = 0.0
        if buffers:
            try:
                import numpy as np

                arr_tmp = np.frombuffer(b"".join(buffers), dtype=np.int16)
                peak_audio = float(np.max(np.abs(arr_tmp))) if arr_tmp.size else 0.0
            except Exception:
                peak_audio = 0.0
        if buffers and speech_started and (speech_chunks >= 2 or peak_audio > 5000 or peak_seen >= threshold):
            print(
                f"⚠️ VAD soft-accept (speech_chunks={speech_chunks}<{min_speech_chunks}, "
                f"peak={peak_audio:.0f}) — still sending to STT"
            )
        else:
            print(
                f"ℹ️ VAD: {NO_SPEECH} (speech_chunks={speech_chunks}, "
                f"peak_energy={peak_seen:.0f}, threshold={threshold:.0f})"
            )
            if peak_seen < threshold:
                print(
                    f"💡 Voice RMS peak={peak_seen:.0f} < need {threshold:.0f}. "
                    f"Speak closer into USB mic; raise Mic Capture; say louder."
                )
            return None, 0.0

    audio = b"".join(buffers)
    seconds = len(audio) / (capture_sr * 2)

    # Peak gate on captured buffer
    arr = np.frombuffer(audio, dtype=np.int16)
    peak = float(np.max(np.abs(arr))) if arr.size else 0.0
    rms = float(np.sqrt(np.mean(arr.astype(np.float32) ** 2))) if arr.size else 0.0
    if peak < SILENCE_PEAK or rms < SILENCE_RMS:
        print(f"🔇 VAD buffer too quiet (peak={peak:.0f}, rms={rms:.0f}) → {NO_SPEECH}")
        return None, 0.0

    # High-pass + normalize before Whisper (tame USB rumble / clipping)
    try:
        from voice.stt.audio_io import highpass_int16, normalize_int16

        arr = highpass_int16(arr, capture_sr)
        arr = normalize_int16(arr)
    except Exception:
        try:
            from voice.stt.audio_io import normalize_int16

            arr = normalize_int16(arr)
        except Exception:
            pass

    fd, path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    save_wav(path, arr, capture_sr)

    saved = max(0.0, max_seconds - seconds)
    if saved > 0.1:
        print(f"⚡ VAD stopped early ({seconds:.1f}s recorded, ~{saved:.1f}s saved vs max)")

    return path, seconds
