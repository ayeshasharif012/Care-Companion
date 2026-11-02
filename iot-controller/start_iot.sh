#!/bin/bash
# Start Care Companion IoT controller cleanly on the Pi.
# Usage: bash /home/carecompanion/start_iot.sh

set -e
cd /home/carecompanion

echo "→ Stopping old IoT / SOS / emotion processes..."
# Free ports held by previous runs
sudo fuser -k 5002/tcp 2>/dev/null || true
sudo fuser -k 5001/tcp 2>/dev/null || true
pkill -f "/home/carecompanion/sos_button.py" 2>/dev/null || true
pkill -f "/home/carecompanion/main.py" 2>/dev/null || true
pkill -f "emotion_service.py" 2>/dev/null || true
sleep 1

if ss -ltn | grep -q ':5002'; then
  echo "❌ Port 5002 still busy. Run: sudo lsof -i :5002  then sudo kill -9 <PID>"
  exit 1
fi

echo "→ Starting main.py ..."
source /home/carecompanion/venv/bin/activate
exec python /home/carecompanion/main.py
