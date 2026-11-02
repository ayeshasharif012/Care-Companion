# Care Companion IoT — run full client stack locally on Windows (FYP demo)
# Same as Pi: wake-word, STT, TTS, emotion :5001, reminders, health tips, SOS
#
# Usage (PowerShell):
#   cd iot-controller
#   .\start_local.ps1
#
# Windows note: torch fails in deep OneDrive paths (WinError 206). This script uses
# a short-path venv at C:\cc-venv\iot by default. Override: $env:CC_IOT_VENV = "D:\venv\iot"

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$VenvRoot = if ($env:CC_IOT_VENV) { $env:CC_IOT_VENV } else { "C:\cc-venv\iot" }
$VenvPython = Join-Path $VenvRoot "Scripts\python.exe"
$VenvPip = Join-Path $VenvRoot "Scripts\pip.exe"
$VenvActivate = Join-Path $VenvRoot "Scripts\Activate.ps1"

Write-Host "`n=== Care Companion — Local IoT Client (Laptop) ===`n" -ForegroundColor Cyan
Write-Host "Python venv: $VenvRoot" -ForegroundColor DarkGray

if (-not (Test-Path ".env")) {
    if (Test-Path ".env.local.example") {
        Copy-Item ".env.local.example" ".env"
        Write-Host "Created .env from .env.local.example — edit OPENAI_API_KEY and MONGO_URI`n" -ForegroundColor Yellow
    } else {
        Write-Host "Missing .env — copy .env.local.example to .env first`n" -ForegroundColor Red
        exit 1
    }
}

if (-not (Test-Path $VenvRoot)) {
    Write-Host "Creating Python venv at $VenvRoot ..." -ForegroundColor Green
    New-Item -ItemType Directory -Force -Path (Split-Path $VenvRoot -Parent) | Out-Null
    python -m venv $VenvRoot
}

Write-Host "Activating venv..." -ForegroundColor Green
& $VenvActivate

Write-Host "Installing core dependencies (Flask, audio, API)..." -ForegroundColor Green
& $VenvPython -m pip install -q --upgrade pip
& $VenvPip install -q -r requirements-core.txt

Write-Host "Installing emotion ML stack (torch + transformers — may take 5–15 min)..." -ForegroundColor Green
try {
    & $VenvPip install -q -r requirements-emotion.txt
} catch {
    Write-Host "`n⚠️  Emotion ML install failed (often WinError 206 on long paths)." -ForegroundColor Yellow
    Write-Host "   Fix: set `$env:CC_IOT_VENV = 'C:\cc-venv\iot' and re-run, OR enable Windows long paths:" -ForegroundColor Yellow
    Write-Host "   Settings → System → About → Advanced → Long Paths = On`n" -ForegroundColor Yellow
    throw
}

Write-Host "`nChecking audio devices..." -ForegroundColor Green
& $VenvPython list_audio_devices.py

Write-Host "Freeing ports 5001 / 5002 if held by old runs..." -ForegroundColor Green
foreach ($port in 5001, 5002) {
    $conn = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($conn) {
        Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
        Write-Host "  Stopped process on port $port"
    }
}

Write-Host "`nPrerequisites:" -ForegroundColor Cyan
Write-Host "  1. Backend running:  cd ..\backend && npm run dev   (http://127.0.0.1:5000)"
Write-Host "  2. Log in on mobile app once (sets active user for wake-word / reminders)"
Write-Host "  3. Phone config: EXPO_PUBLIC_IOT_URL=http://<YOUR_LAPTOP_IP>:5002"
Write-Host "  4. SOS test: curl http://127.0.0.1:5002/health"
Write-Host "`nStarting main.py (Flask :5002 + emotion :5001 + background workers)...`n" -ForegroundColor Green

$env:RUN_MODE = "local"
& $VenvPython main.py
