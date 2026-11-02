#!/usr/bin/env python3
"""
Isolated mic → Whisper test (no VAD, no hallucination filters).

Monitors input levels while recording, saves WAV, sends to OpenAI Whisper.

Usage (on Pi):
  source ~/venv/bin/activate
  python3 test_mic_whisper.py              # record 6s, transcribe once
  python3 test_mic_whisper.py --seconds 8
  python3 test_mic_whisper.py --loop       # repeat until Ctrl+C
  python3 test_mic_whisper.py --monitor   # live level meter only (no Whisper)

Env (optional, ~/.env):
  MIC_DEVICE_INDEX=1
  MIC_SAMPLE_RATE=44100
  OPENAI_API_KEY=sk-...
"""
from __future__ import annotations

import argparse
import os
import sys
import tempfile
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

WHISPER_SR = 16000


def load_env() -> None:
    for p in (ROOT / ".env", Path.home() / ".env", Path("/home/carecompanion/.env")):
        if not p.exists():
            continue
        for line in p.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                k, v = k.strip(), v.strip().strip('"').strip("'")
                if k and k not in os.environ:
                    os.environ[k] = v
        break


def list_devices(sd) -> None:
    print("\n--- Audio devices ---")
    for i, d in enumerate(sd.query_devices()):
        if int(d.get("max_input_channels") or 0) > 0:
            print(
                f"  IN  [{i}] {d['name']}  sr={d.get('default_samplerate')}  "
                f"channels={d['max_input_channels']}"
            )
    for i, d in enumerate(sd.query_devices()):
        if int(d.get("max_output_channels") or 0) > 0:
            print(f"  OUT [{i}] {d['name']}")


def mic_index(sd) -> int:
    raw = os.getenv("MIC_DEVICE_INDEX", "").strip()
    if raw.lstrip("-").isdigit():
        return int(raw)
    for i, d in enumerate(sd.query_devices()):
        if int(d.get("max_input_channels") or 0) > 0 and "usb" in str(d.get("name", "")).lower():
            return i
    for i, d in enumerate(sd.query_devices()):
        if int(d.get("max_input_channels") or 0) > 0:
            return i
    raise RuntimeError("No input device found")


def capture_rate(sd, dev: int) -> int:
    raw = os.getenv("MIC_SAMPLE_RATE", "").strip()
    if raw.isdigit():
        return int(raw)
    info = sd.query_devices(dev)
    sr = int(float(info.get("default_samplerate") or 44100))
    return 44100 if sr == 16000 else sr


def resample_int16(audio, orig_sr: int):
    import numpy as np

    if orig_sr == WHISPER_SR:
        return np.asarray(audio, dtype=np.int16).flatten()
    arr = np.asarray(audio, dtype=np.float32).flatten()
    if arr.size == 0:
        return arr.astype(np.int16)
    duration = len(arr) / orig_sr
    n = max(1, int(duration * WHISPER_SR))
    x_old = np.linspace(0, duration, num=len(arr), endpoint=False)
    x_new = np.linspace(0, duration, num=n, endpoint=False)
    return np.interp(x_new, x_old, arr).astype(np.int16)


def save_whisper_wav(path: str, audio_int16, capture_sr: int) -> None:
    pcm = resample_int16(audio_int16, capture_sr)
    with wave.open(path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(WHISPER_SR)
        wf.writeframes(pcm.tobytes())


def normalize_optional(audio):
    """Light boost if peak is low; skip if voice module unavailable."""
    import numpy as np

    arr = np.asarray(audio, dtype=np.float32).flatten()
    if arr.size == 0:
        return arr.astype(np.int16)
    try:
        from voice.stt.audio_io import normalize_int16

        return normalize_int16(arr.astype(np.int16))
    except Exception:
        arr -= float(np.mean(arr))
        peak = float(np.max(np.abs(arr)))
        if peak < 1:
            return arr.astype(np.int16)
        target = float(os.getenv("MIC_NORM_PEAK", "10000"))
        scale = min(float(os.getenv("MIC_GAIN", "3.0")), target / peak)
        return np.clip(arr * scale, -32767, 32767).astype(np.int16)


def record_with_meter(sd, dev: int, sr: int, seconds: float):
    import numpy as np

    chunk_s = 0.25
    chunk_frames = int(chunk_s * sr)
    n_chunks = max(1, int(round(seconds / chunk_s)))
    parts = []
    max_peak = 0.0
    max_rms = 0.0

    print(f"\nRecording {seconds:.1f}s from device={dev} @ {sr} Hz")
    print(">>> Speak clearly into the mic NOW <<<\n")

    for i in range(n_chunks):
        chunk = sd.rec(
            chunk_frames,
            samplerate=sr,
            channels=1,
            dtype="int16",
            device=dev,
            blocking=True,
        )
        sd.wait()
        arr = np.asarray(chunk, dtype=np.float32).flatten()
        arr -= float(np.mean(arr)) if arr.size else 0.0
        peak = float(np.max(np.abs(arr))) if arr.size else 0.0
        rms = float(np.sqrt(np.mean(arr * arr))) if arr.size else 0.0
        max_peak = max(max_peak, peak)
        max_rms = max(max_rms, rms)
        bar = int(min(40, peak / 500))
        print(
            f"  [{i * chunk_s:4.1f}s] peak={peak:6.0f}  rms={rms:6.0f}  "
            f"{'█' * bar}{'░' * (20 - min(20, bar))}",
            flush=True,
        )
        parts.append(chunk.astype(np.int16).flatten())

    audio = np.concatenate(parts) if parts else np.zeros(0, dtype=np.int16)
    print(f"\nSummary: max_peak={max_peak:.0f}  max_rms={max_rms:.0f}")
    if max_peak < 500:
        print("⚠️ Very quiet — check mic jack, alsamixer -c 3, speak louder")
    elif max_peak > 30000:
        print("⚠️ Clipping — lower Mic Capture in alsamixer")
    return audio, max_peak, max_rms


def monitor_only(sd, dev: int, sr: int) -> None:
    import numpy as np

    chunk = int(0.1 * sr)
    print(f"\nLive monitor (device={dev}, sr={sr}). Ctrl+C to stop.\n")
    try:
        while True:
            data = sd.rec(
                chunk,
                samplerate=sr,
                channels=1,
                dtype="float32",
                device=dev,
                blocking=True,
            )
            sd.wait()
            arr = np.asarray(data, dtype=np.float32).flatten()
            peak = float(np.max(np.abs(arr))) if arr.size else 0.0
            rms = float(np.sqrt(np.mean(arr * arr))) if arr.size else 0.0
            bar = int(min(50, peak / 400))
            print(f"  peak={peak:6.0f}  rms={rms:6.0f}  {'█' * bar}", flush=True)
    except KeyboardInterrupt:
        print("\nStopped.")


def transcribe_whisper(wav_path: str, language: str | None) -> str:
    try:
        from voice.openai_util import get_openai_client, log_openai_key_status

        log_openai_key_status()
        client = get_openai_client()
    except ImportError:
        from openai import OpenAI

        key = os.getenv("OPENAI_API_KEY", "").strip()
        if not key:
            raise RuntimeError("OPENAI_API_KEY not set in .env")
        print(f"🔑 Using OPENAI_API_KEY from env")
        client = OpenAI(api_key=key)

    if client is None:
        raise RuntimeError("OpenAI client unavailable — check OPENAI_API_KEY")

    print("\n--- Whisper API ---")
    with open(wav_path, "rb") as f:
        kwargs = {"model": "whisper-1", "file": f, "temperature": 0}
        if language:
            kwargs["language"] = language
        result = client.audio.transcriptions.create(**kwargs)

    text = (getattr(result, "text", None) or "").strip()
    print(f"Raw transcription: {text!r}")
    return text


def run_once(args) -> int:
    import numpy as np
    import sounddevice as sd

    dev = mic_index(sd)
    sr = capture_rate(sd, dev)
    list_devices(sd)
    print(f"\nUsing mic device={dev}  capture_sr={sr}")

    audio, peak, _rms = record_with_meter(sd, dev, sr, args.seconds)

    if args.no_normalize:
        pcm = np.asarray(audio, dtype=np.int16)
    else:
        pcm = normalize_optional(audio)

    out_wav = Path.home() / "mic_whisper_test.wav"
    save_whisper_wav(str(out_wav), pcm, sr)
    print(f"Saved 16 kHz WAV: {out_wav}")
    print(f"Replay: aplay {out_wav}")

    if peak < args.min_peak and not args.force:
        print(f"\nSkipping Whisper (peak {peak:.0f} < min {args.min_peak}). Use --force to send anyway.")
        return 1

    lang = None if args.lang == "auto" else ("ur" if args.lang == "urdu" else "en")
    try:
        text = transcribe_whisper(str(out_wav), lang)
    except Exception as exc:
        print(f"❌ Whisper failed: {exc}")
        return 1

    if text:
        print(f"\n✅ Heard: {text}")
        return 0
    print("\n❌ Whisper returned empty text")
    return 1


def main() -> int:
    load_env()
    parser = argparse.ArgumentParser(description="Isolated mic monitor + Whisper STT")
    parser.add_argument("--seconds", type=float, default=6.0, help="Record duration (default 6)")
    parser.add_argument("--loop", action="store_true", help="Repeat record+transcribe until Ctrl+C")
    parser.add_argument("--monitor", action="store_true", help="Live level meter only")
    parser.add_argument("--lang", choices=("en", "urdu", "auto"), default="en")
    parser.add_argument("--no-normalize", action="store_true", help="Send raw audio without gain")
    parser.add_argument("--min-peak", type=int, default=400, help="Skip Whisper if peak below this")
    parser.add_argument("--force", action="store_true", help="Send to Whisper even if quiet")
    args = parser.parse_args()

    import sounddevice as sd

    print("=== Mic → Whisper (isolated test) ===")

    if args.monitor:
        dev = mic_index(sd)
        sr = capture_rate(sd, dev)
        list_devices(sd)
        monitor_only(sd, dev, sr)
        return 0

    if args.loop:
        n = 0
        try:
            while True:
                n += 1
                print(f"\n{'=' * 50}\n  Turn {n}\n{'=' * 50}")
                run_once(args)
        except KeyboardInterrupt:
            print("\nDone.")
        return 0

    return run_once(args)


if __name__ == "__main__":
    raise SystemExit(main())
