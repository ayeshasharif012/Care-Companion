# Local IoT Client on Laptop (Windows)

Run the **full Care Companion client** on your laptop — the same Python stack as the Raspberry Pi (`main.py`), with laptop mic/speakers instead of the Pi USB audio card.

## What runs (one terminal, same as Pi)

| Service | Port / thread | Description |
|---------|----------------|-------------|
| Flask IoT API | **5002** | `/speak`, `/set-user`, voice chat, SOS |
| Emotion service | **5001** | Wav2Vec2 emotion model |
| Wake-word listener | background | "hello care companion" → voice chat |
| Whisper STT + OpenAI TTS | in wake/chat | Mic → text → reply on speakers |
| Reminder worker | background | SQLite + Mongo sync → speak reminders |
| Health tips player | background | Random active tips on interval |
| SOS | keyboard or `/sos` | Triggers `POST /api/emergency/trigger-demo` on Node backend |

The **Node.js backend** (port **5000**) runs separately — see [LOCAL_FYP_SETUP.md](../LOCAL_FYP_SETUP.md).

---

## Quick start (PowerShell)

### 1. Start backend first

```powershell
cd backend
npm run dev
```

### 2. Configure IoT client

```powershell
cd iot-controller
copy .env.local.example .env
```

Edit `.env`:

- `OPENAI_API_KEY` — same as backend
- `MONGO_URI` — same as `backend/.env`
- `BACKEND_URL=http://127.0.0.1:5000` (already set in template)

### 3. Run everything

```powershell
cd iot-controller
.\start_local.ps1
```

Or manually:

```powershell
cd iot-controller
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
python list_audio_devices.py
$env:RUN_MODE = "local"
python main.py
```

---

## Audio configuration

### Default (recommended)

Leave **`MIC_DEVICE_INDEX` unset** in `.env` — Windows uses the **default microphone and speakers**.

Set in `.env`:

```env
RUN_MODE=local
TTS_USE_PYGAME=1
TTS_STREAMING=0
```

### Pick a specific mic

```powershell
python list_audio_devices.py
```

Then in `.env`:

```env
MIC_DEVICE_INDEX=2
```

**Do not** copy Pi values like `MIC_DEVICE_INDEX=3` or `MIC_SAMPLE_RATE=44100` unless your USB mic needs them on the laptop.

---

## Backend URL

For laptop-only demo:

```env
BACKEND_URL=http://127.0.0.1:5000
```

If the **phone app** on the same Wi-Fi must reach the IoT Flask API:

```env
BACKEND_URL=http://YOUR_LAN_IP:5000
```

And expose Flask on the LAN (already `0.0.0.0:5002`). Update `frontend/.env` with the same LAN IP.

---

## Testing SOS locally

While `main.py` is running:

**Option A — keyboard:** type `s` and press Enter in the same terminal.

**Option B — HTTP:**

```powershell
curl http://127.0.0.1:5002/sos
```

**Option C — direct backend:**

```powershell
python ..\scripts\test_sos_local.py
```

---

## Wake-word & voice chat

1. Log in on the **mobile app** (sets active user via `/set-user` or companion sync).
2. Say: **"Hello care companion"**
3. The client listens, runs Whisper STT, emotion (during chat), GPT reply, and speaks via **laptop speakers**.

If wake-word does not trigger, check mic levels in the terminal peak meter and run `python list_audio_devices.py`.

---

## Expected startup logs

```text
🖥️ Local audio profile (laptop defaults)
--- Audio devices (sounddevice) ---
✅ Mongo config loaded from environment
🚀 Starting Care Companion IoT services...
✅ Reminder worker started
✅ Health tips player (30s–90s)
✅ SOS keyboard listener (type s + Enter, or POST /sos)
✅ Wake-word listener
✅ [Emotion] Launched ... emotion_service.py (:5001)
🌐 Backend SOS target: http://127.0.0.1:5000
🌐 Listening 0.0.0.0:5002
```

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| No mic input / silence | Run `list_audio_devices.py`, set `MIC_DEVICE_INDEX`, check Windows mic privacy settings |
| No speaker output | Ensure `TTS_USE_PYGAME=1`; install `pygame` via `pip install pygame` |
| SOS timeout | Backend not running; check `BACKEND_URL`; run `npm run seed:demo` in backend |
| Port 5002 busy | `start_local.ps1` kills old processes; or `Get-NetTCPConnection -LocalPort 5002` |
| Emotion :5001 slow first start | First run downloads Hugging Face model — wait for "Emotion service starting" |
| Reminders not speaking | Log in on app; call `POST http://127.0.0.1:5002/set-user` with `{ "userId": "..." }` |

---

## Pi vs laptop

| Setting | Raspberry Pi | Laptop (local) |
|---------|--------------|----------------|
| Mic | `MIC_DEVICE_INDEX=3` (USB) | unset = default |
| TTS | `mpg123` + ALSA | `pygame` (Windows) |
| SOS | GPIO button | Keyboard `s` or `GET /sos` |
| `RUN_MODE` | unset | `local` |
