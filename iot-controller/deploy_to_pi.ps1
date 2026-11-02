# Transfer Care Companion IoT files to Raspberry Pi (PowerShell)
# Usage:
#   cd iot-controller
#   .\deploy_to_pi.ps1

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$PI = "carecompanion@100.109.141.51"
$DEST = "/home/carecompanion"

Write-Host "`n=== SCP to ${PI}:${DEST}/ ===`n" -ForegroundColor Cyan

$files = @(
    "apply_pi_mic_env.py",
    "pi_fix_now.py",
    "pi_mic_fix.py",
    "pi_mic_diag.py",
    "pi_mic_hw_check.py",
    "test_mic.py",
    "test_conversation.py",
    "main.py",
    "list_audio_devices.py",
    "pi_mic_speaker_loop.py",
    "sos_button.py",
    ".env.pi.example",
    ".env.example"
)

scp @files "${PI}:${DEST}/"
if ($LASTEXITCODE -ne 0) { throw "scp files failed" }

scp -r voice "${PI}:${DEST}/"
if ($LASTEXITCODE -ne 0) { throw "scp voice/ failed" }

Write-Host "`n=== Done. On Pi run: ===" -ForegroundColor Green
Write-Host "  python3 ~/apply_pi_mic_env.py"
Write-Host "  python3 ~/main.py"
Write-Host "  Look for: Mic index=1  and  device=1`n"
