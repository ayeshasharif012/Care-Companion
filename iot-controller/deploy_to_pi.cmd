@echo off
REM Transfer Care Companion IoT files to Raspberry Pi
setlocal
cd /d "%~dp0"

set PI=carecompanion@100.109.141.51
set DEST=/home/carecompanion

echo.
echo === SCP to %PI%:%DEST%/ ===
echo.

scp apply_pi_mic_env.py pi_fix_now.py pi_mic_fix.py pi_mic_diag.py pi_mic_hw_check.py test_mic.py test_conversation.py main.py list_audio_devices.py pi_mic_speaker_loop.py .env.pi.example .env.example %PI%:%DEST%/
if errorlevel 1 goto fail

scp -r voice %PI%:%DEST%/
if errorlevel 1 goto fail

echo.
echo === Done. On Pi: ===
echo   python3 ~/apply_pi_mic_env.py
echo   python3 ~/main.py
echo   Expect: Mic index=1  device=1
echo.
pause
exit /b 0

:fail
echo SCP failed — check Pi online / Tailscale.
pause
exit /b 1
