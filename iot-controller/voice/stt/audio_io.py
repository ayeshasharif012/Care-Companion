"""Pi / laptop mic capture — USB mics often need 44100/48000, not 16000."""
from __future__ import annotations

import os
import sys
import wave

WHISPER_SAMPLE_RATE = 16000


def is_windows() -> bool:
    return sys.platform == "win32"


def is_local_run() -> bool:
    return os.getenv("RUN_MODE", "").lower() == "local" or is_windows()


def list_audio_devices() -> None:
    """Print input/output devices (sounddevice). Useful when picking MIC_DEVICE_INDEX."""
    try:
        import sounddevice as sd

        print("\n--- Audio devices (sounddevice) ---")
        for i, d in enumerate(sd.query_devices()):
            tag = []
            if d.get("max_input_channels", 0) > 0:
                tag.append("IN")
            if d.get("max_output_channels", 0) > 0:
                tag.append("OUT")
            default = ""
            try:
                if i == sd.default.device[0]:
                    default += " [default IN]"
                if i == sd.default.device[1]:
                    default += " [default OUT]"
            except Exception:
                pass
            print(
                f"  [{i}] {'/'.join(tag) or '?'}: {d.get('name')} "
                f"sr={d.get('default_samplerate')}{default}"
            )
        print("--- end devices ---\n")
    except Exception as exc:
        print(f"⚠️ Could not list audio devices: {exc}")


def apply_local_audio_profile() -> None:
    """
    Laptop / RUN_MODE=local: use built-in default mic & speakers (not Pi USB card 3).
    Set in iot-controller/.env:  RUN_MODE=local
    """
    if not is_local_run():
        return

    # Pi .env often pins USB card — on laptop that breaks capture
    if os.getenv("RUN_MODE", "").lower() == "local" or is_windows():
        # Common Pi USB card indices — wrong on laptop
        mic_idx = os.getenv("MIC_DEVICE_INDEX", "").strip()
        if mic_idx in ("1", "3") and is_windows():
            os.environ.pop("MIC_DEVICE_INDEX", None)
            print(f"   Cleared Pi MIC_DEVICE_INDEX={mic_idx} → Windows default mic")
        if os.getenv("TTS_SINK_ID", "").strip() in ("89",):
            os.environ.pop("TTS_SINK_ID", None)

    if is_windows():
        os.environ.setdefault("TTS_USE_PYGAME", "1")
        os.environ.setdefault("TTS_STREAMING", "0")

    os.environ.setdefault("ENABLE_KEYBOARD_SOS", "1")

    print("🖥️ Local audio profile (laptop defaults)")
    mic = os.getenv("MIC_DEVICE_INDEX", "").strip() or "system default"
    spk = os.getenv("SPEAKER_DEVICE_INDEX", "").strip() or "system default"
    print(f"   Mic: {mic}  Speaker: {spk}  TTS pygame={os.getenv('TTS_USE_PYGAME', 'auto')}")
    list_audio_devices()


def _pick_usb_input_index() -> int | None:
    """Prefer real USB sound-card input over pulse/pipewire/default."""
    try:
        import sounddevice as sd

        devices = sd.query_devices()
        usb = None
        any_in = None
        for i, d in enumerate(devices):
            if int(d.get("max_input_channels") or 0) < 1:
                continue
            name = str(d.get("name", "")).lower()
            if any(x in name for x in ("pulse", "pipewire", "default")):
                continue
            if any_in is None:
                any_in = i
            if "usb" in name:
                usb = i
                break
        return usb if usb is not None else any_in
    except Exception:
        return None


def _device_is_virtual(index: int) -> bool:
    try:
        import sounddevice as sd

        name = str(sd.query_devices(index).get("name", "")).lower()
        return any(x in name for x in ("pulse", "pipewire", "default"))
    except Exception:
        return False


def mic_device_index() -> int | None:
    """
    Prefer MIC_DEVICE_INDEX; empty = OS default input (laptop built-in mic).

    On Pi, people often set MIC_DEVICE_INDEX=3 from `arecord -l` (ALSA card 3).
    PortAudio usually maps USB to index 1 — auto-correct virtual/wrong indices.
    """
    raw = os.getenv("MIC_DEVICE_INDEX", "").strip()
    if not raw or raw.lower() in ("default", "auto"):
        if not is_local_run():
            return _pick_usb_input_index()
        return None
    if not raw.lstrip("-").isdigit():
        return None

    idx = int(raw)
    if is_local_run():
        return idx

    # Pi: if env points at pulse/pipewire (silent) or a non-input device, use USB hw
    try:
        import sounddevice as sd

        info = sd.query_devices(idx)
        in_ch = int(info.get("max_input_channels") or 0)
        if in_ch < 1 or _device_is_virtual(idx):
            usb = _pick_usb_input_index()
            if usb is not None and usb != idx:
                print(
                    f"⚠️ MIC_DEVICE_INDEX={idx} is not a live USB mic "
                    f"→ using PortAudio [{usb}] instead "
                    f"(arecord card ≠ sounddevice index; set MIC_DEVICE_INDEX={usb} in ~/.env)"
                )
                # Persist for this process so every path (STT/VAD/emotion) uses USB
                os.environ["MIC_DEVICE_INDEX"] = str(usb)
                return usb
    except Exception:
        usb = _pick_usb_input_index()
        if usb is not None:
            os.environ["MIC_DEVICE_INDEX"] = str(usb)
            return usb
    return idx


def speaker_device_index() -> int | None:
    raw = os.getenv("SPEAKER_DEVICE_INDEX", "").strip()
    if not raw or raw.lower() in ("default", "auto"):
        return None
    if raw.lstrip("-").isdigit():
        return int(raw)
    return None


def capture_sample_rate(device: int | None = None) -> int:
    """
    Hardware capture rate.
    USB mics commonly reject 16000 — use MIC_SAMPLE_RATE or device default (often 44100).
    Audio is always resampled to 16 kHz before Whisper.
    """
    env = os.getenv("MIC_SAMPLE_RATE", "").strip()
    if env.isdigit():
        return int(env)
    dev = device if device is not None else mic_device_index()
    if dev is not None:
        try:
            import sounddevice as sd

            info = sd.query_devices(dev)
            rate = int(float(info.get("default_samplerate") or 0))
            if rate > 0:
                return rate
        except Exception:
            pass
    # Safe default for USB mics when env/device query unavailable
    if mic_device_index() is not None:
        return 44100
    return WHISPER_SAMPLE_RATE


def resample_to_whisper(audio_int16, orig_sr: int):
    import numpy as np

    if orig_sr == WHISPER_SAMPLE_RATE:
        return audio_int16
    audio = np.asarray(audio_int16, dtype=np.float32).flatten()
    if audio.size == 0:
        return audio.astype(np.int16)
    duration = len(audio) / orig_sr
    target_len = max(1, int(duration * WHISPER_SAMPLE_RATE))
    x_old = np.linspace(0, duration, num=len(audio), endpoint=False)
    x_new = np.linspace(0, duration, num=target_len, endpoint=False)
    out = np.interp(x_new, x_old, audio)
    return out.astype(np.int16)


def save_wav(path: str, audio_int16, sample_rate: int) -> int:
    """Write mono int16 WAV at 16 kHz for Whisper. Returns final sample rate."""
    final = resample_to_whisper(audio_int16, sample_rate)
    with wave.open(path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(WHISPER_SAMPLE_RATE)
        wf.writeframes(final.tobytes())
    return WHISPER_SAMPLE_RATE


def normalize_int16(audio, target_peak: float | None = None, max_boost: float | None = None):
    """DC-remove + peak-normalize. Uses percentile peak so USB clips don't crush speech."""
    import numpy as np

    arr = np.asarray(audio, dtype=np.float32).flatten()
    if arr.size == 0:
        return arr.astype(np.int16)
    arr -= float(np.mean(arr))
    abs_arr = np.abs(arr)
    if arr.size > 200:
        # Ignore rare clipping pops when choosing gain
        peak = float(np.percentile(abs_arr, 99.5))
        hard = float(np.percentile(abs_arr, 99.9))
        arr = np.clip(arr, -hard, hard)
    else:
        peak = float(np.max(abs_arr)) if abs_arr.size else 0.0
    if peak < 1.0:
        return arr.astype(np.int16)
    target = float(target_peak if target_peak is not None else os.getenv("MIC_NORM_PEAK", "10000"))
    boost_cap = float(max_boost if max_boost is not None else os.getenv("MIC_GAIN", "3.0"))
    scale = target / peak
    if scale > boost_cap:
        scale = boost_cap
    out = np.clip(arr * scale, -32767, 32767)
    print(
        f"🎚️ Normalize p99.5={peak:.0f} → {float(np.max(np.abs(out))):.0f} (x{scale:.2f})"
    )
    return out.astype(np.int16)


def despike_int16(audio, limit: float | None = None):
    """Soft-cap extreme samples (USB pops) without wiping speech."""
    import numpy as np

    arr = np.asarray(audio, dtype=np.float32).flatten()
    if arr.size == 0:
        return arr.astype(np.int16)
    lim = float(limit if limit is not None else os.getenv("MIC_DESPIKE", "14000"))
    if lim <= 0:
        return arr.astype(np.int16)
    return np.clip(arr, -lim, lim).astype(np.int16)


def highpass_int16(audio, sample_rate: int, cutoff_hz: float | None = None):
    """
    First-order high-pass — strips USB rumble/DC that inflates VAD RMS.
    DX-001 / cheap USB cards often look 'loud' from ~50Hz junk, not speech.
    """
    import numpy as np

    arr = np.asarray(audio, dtype=np.float32).flatten()
    if arr.size < 8:
        return arr.astype(np.int16)
    cut = float(cutoff_hz if cutoff_hz is not None else os.getenv("MIC_HIGHPASS_HZ", "280"))
    if cut <= 0 or sample_rate <= 0:
        return arr.astype(np.int16)
    rc = 1.0 / (2.0 * np.pi * cut)
    dt = 1.0 / float(sample_rate)
    alpha = rc / (rc + dt)
    y = np.empty_like(arr)
    y[0] = 0.0
    prev_y = 0.0
    prev_x = float(arr[0])
    for i in range(1, arr.size):
        x = float(arr[i])
        prev_y = alpha * (prev_y + x - prev_x)
        y[i] = prev_y
        prev_x = x
    return np.clip(y, -32767, 32767).astype(np.int16)
