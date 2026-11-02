#!/bin/bash
# Run ON the Pi:  bash /home/carecompanion/pi_fix_now.sh
# Prefer:         python3 /home/carecompanion/pi_fix_now.py  (no CRLF issues)
set -e
HOME_DIR="/home/carecompanion"
cd "$HOME_DIR"

echo "=== Care Companion Pi fix (run ON the Pi) ==="

touch .env
for kv in \
  "ENABLE_WAKE_WORD=0" \
  "ENABLE_PI_EMOTION=0" \
  "ENABLE_SOS=0" \
  "USE_VAD=1" \
  "VAD_ENERGY_THRESHOLD=700" \
  "VAD_MIN_SPEECH_S=0.9" \
  "VAD_SILENCE_S=0.9" \
  "VAD_DYNAMIC_THRESHOLD=1" \
  "STT_MIN_WORDS=2" \
  "STT_REJECT_SINGLE=1" \
  "RECORD_MAX_SECONDS=6" \
  "CHAT_SKIP_EMOTION=1"
do
  key="${kv%%=*}"
  grep -q "^${key}=" .env 2>/dev/null && sed -i "s|^${key}=.*|${kv}|" .env || echo "$kv" >> .env
done
echo "✅ .env quiet mode"

python3 "$HOME_DIR/pi_fix_now.py"
