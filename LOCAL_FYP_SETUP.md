# Local FYP Presentation Setup

This guide runs **Care Companion** on your laptop for demos. Important: the main API is **Node.js / Express** on port **5000**, not Flask. Flask runs only on the **Raspberry Pi IoT controller** (port **5002**).

## Architecture (local demo)

```text
Phone (Expo app)  ──►  Laptop Node backend :5000  ──►  MongoDB
Raspberry Pi      ──►  Laptop Node backend :5000  (SOS, reminders sync)
Raspberry Pi      ──►  Pi Flask IoT :5002         (speak / voice only)
```

---

## 1. Prerequisites

| Tool | Purpose |
|------|---------|
| Node.js 18+ | Backend + frontend |
| MongoDB local **or** Atlas | Users, reminders, emergencies |
| Python 3 (optional) | SOS test script |
| Expo Go (phone) | Mobile app demo |

---

## 2. Environment files

Copy the templates and edit with your values:

```powershell
copy backend\.env.example backend\.env
copy frontend\.env.example frontend\.env
copy iot-controller\.env.example iot-controller\.env
```

### Find your laptop LAN IP (Windows)

```powershell
ipconfig
```

Use the **IPv4 Address** under your Wi-Fi adapter (e.g. `192.168.0.106`).

### `backend/.env` (minimum for SOS demo)

```env
PORT=5000
MONGO_URI=mongodb://127.0.0.1:27017/care-companion
JWT_SECRET=local-dev-secret-change-me
OPENAI_API_KEY=sk-...
```

### `frontend/.env`

Replace `YOUR_LAN_IP` with your laptop IP — **not** `localhost` (phone cannot reach it):

```env
EXPO_PUBLIC_API_URL=http://192.168.0.106:5000/api
EXPO_PUBLIC_SOCKET_URL=http://192.168.0.106:5000
EXPO_PUBLIC_IOT_URL=http://100.109.141.51:5002
```

Also update `frontend/config.ts` → `DEV_HOST` if you rely on the fallback instead of `.env`.

### `iot-controller/.env` (Pi or local Python)

```env
BACKEND_URL=http://192.168.0.106:5000
CARE_BACKEND_HOST=192.168.0.106
CARE_BACKEND_PORT=5000
OPENAI_API_KEY=sk-...
```

---

## 3. MongoDB

**Option A — Local**

1. Install [MongoDB Community](https://www.mongodb.com/try/download/community)
2. Start the service
3. Use `MONGO_URI=mongodb://127.0.0.1:27017/care-companion`

**Option B — Atlas**

1. Create a free cluster at [mongodb.com/atlas](https://www.mongodb.com/atlas)
2. Allow your IP (or `0.0.0.0/0` for demo day only)
3. Set `MONGO_URI=mongodb+srv://USER:PASS@cluster.mongodb.net/care-companion`

Database name is always **`care-companion`** (set in `server.js`).

---

## 4. Start the backend

```powershell
cd backend
npm install
npm run dev
```

You should see:

```text
DB Connected ✅
Server running on http://127.0.0.1:5000
LAN access: http://192.168.x.x:5000 (Pi + phone use this IP)
SOS endpoint: POST http://127.0.0.1:5000/api/emergency/trigger-demo
```

Quick check:

```powershell
curl http://127.0.0.1:5000/api/health
```

---

## 5. Seed demo data (required for SOS)

The SOS route needs at least one **caregiver** and linked **companion** in MongoDB:

```powershell
cd backend
npm run seed:demo
```

Demo login for the mobile app:

| Field | Value |
|-------|-------|
| Email | `demo.caregiver@carecompanion.local` |
| Password | `Demo1234!` |

---

## 6. Test SOS locally

### Python (recommended)

```powershell
python scripts/test_sos_local.py
```

From another machine on the LAN (Pi):

```powershell
python scripts/test_sos_local.py --host 192.168.0.106
```

If you get **400 Alert already active**:

```powershell
python scripts/test_sos_local.py --resolve
```

### curl (PowerShell)

```powershell
curl -Method POST http://127.0.0.1:5000/api/emergency/trigger-demo
```

Expected: **HTTP 201** with JSON `{ "success": true, "alert": { ... } }`.

### Common failures

| Symptom | Fix |
|---------|-----|
| Connection refused / timeout | Backend not running; wrong IP in Pi `.env` |
| 404 No caregiver found | Run `npm run seed:demo` |
| 404 No Companion found | Run `npm run seed:demo` |
| 400 Alert already active | Resolve in app or `python scripts/test_sos_local.py --resolve` |
| DB disconnected | Check `MONGO_URI` and MongoDB service |

---

## 7. Start the mobile app

```powershell
cd frontend
npm install
npx expo start
```

Scan the QR code with Expo Go. Phone and laptop must be on the **same Wi-Fi**.

---

## 8. Raspberry Pi (optional live demo)

1. Set `iot-controller/.env` → `BACKEND_URL=http://<YOUR_LAPTOP_IP>:5000`
2. Deploy / run `main.py` on the Pi
3. Physical SOS button calls `POST /api/emergency/trigger-demo`

Ensure Windows Firewall allows inbound TCP **5000** on private networks:

```powershell
New-NetFirewallRule -DisplayName "Care Companion API" -Direction Inbound -LocalPort 5000 -Protocol TCP -Action Allow
```

---

## 9. Presentation checklist

- [ ] MongoDB running (local or Atlas)
- [ ] `backend/.env` configured
- [ ] `npm run dev` in `backend/`
- [ ] `npm run seed:demo` completed once
- [ ] `python scripts/test_sos_local.py` returns **201**
- [ ] `frontend/.env` uses laptop LAN IP
- [ ] Logged into demo account on phone
- [ ] Pi `BACKEND_URL` points to laptop IP (if using Pi)

---

## IoT client on laptop (full Pi stack)

To run **wake-word, STT, TTS, emotion :5001, reminders, health tips, and SOS** on your Windows laptop (not only the Node backend), see **[LOCAL_IOT_SETUP.md](LOCAL_IOT_SETUP.md)**.

Quick command:

```powershell
cd iot-controller
.\start_local.ps1
```

---

```http
POST /api/emergency/trigger-demo
Content-Type: application/json

(no auth required — for physical SOS button / Pi)
```

**201 Created** — emergency logged and pushed to app via Socket.IO  
**400** — alert already active for this companion  
**404** — no user/companion in database  
**500** — server or DB error
