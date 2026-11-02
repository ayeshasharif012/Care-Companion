"""
Physical SOS button → Node.js Care-Companion API on the Windows PC.
Polling mode (edge detect often fails on newer Pi OS / lgpio).
"""
import os
import sys
import time
import requests

try:
    import RPi.GPIO as GPIO
except Exception as exc:
    GPIO = None
    print(f"⚠️ GPIO disabled: {exc}")

BUTTON_PIN = 4
DEBOUNCE_SEC = 3.0
_last_trigger = 0.0

# Only the Windows PC that runs: npm run dev / node server.js
BACKEND_HOST = os.environ.get("CARE_BACKEND_HOST", "192.168.1.92")
BACKEND_PORT = os.environ.get("CARE_BACKEND_PORT", "5000")

SERVER_URLS = [
    f"http://{BACKEND_HOST}:{BACKEND_PORT}/api/emergency/trigger-demo",
    "http://100.94.54.17:5000/api/emergency/trigger-demo",  # Windows Tailscale
]


def is_success(response):
    """201 created, or 400 'already active' both mean the alert path worked."""
    if response.ok:
        return True
    if response.status_code == 400:
        try:
            msg = (response.json() or {}).get("message", "")
        except Exception:
            msg = response.text or ""
        if "already active" in msg.lower():
            return True
    return False


def trigger_alert(_channel=None):
    global _last_trigger
    now = time.time()
    if now - _last_trigger < DEBOUNCE_SEC:
        return
    _last_trigger = now

    print("\n🚨 Button Pressed! Sending SOS signal...")
    last_error = None

    for server_url in SERVER_URLS:
        try:
            print(f"   Trying {server_url} ...")
            response = requests.post(server_url, json={}, timeout=5)
            if is_success(response):
                print(f"✅ Alert OK ({response.status_code}) via {server_url}")
                return
            body = (response.text or "")[:180]
            last_error = f"{server_url} -> {response.status_code} {body}"
            print(f"   ✗ {response.status_code}: {body}")
        except requests.exceptions.RequestException as exc:
            last_error = f"{server_url} -> {exc}"
            print(f"   ✗ unreachable: {exc}")

    print(f"❌ All targets failed. Last: {last_error}")
    print(f"   On Windows: keep `npm run dev` running, open http://{BACKEND_HOST}:{BACKEND_PORT}/")


def setup_gpio():
    if GPIO is None:
        return False
    try:
        GPIO.setwarnings(False)
        GPIO.cleanup()
    except Exception:
        pass
    GPIO.setmode(GPIO.BCM)
    GPIO.setup(BUTTON_PIN, GPIO.IN, pull_up_down=GPIO.PUD_UP)
    return True


def run_polling_loop():
    print("🔄 GPIO polling mode")
    print("🚀 SOS ready — waiting for button press...")
    print(f"   Target: {SERVER_URLS[0]}")
    last_state = GPIO.input(BUTTON_PIN)
    try:
        while True:
            current = GPIO.input(BUTTON_PIN)
            if last_state == GPIO.HIGH and current == GPIO.LOW:
                trigger_alert()
            last_state = current
            time.sleep(0.05)
    except KeyboardInterrupt:
        print("\n🛑 Exiting...")
    finally:
        try:
            GPIO.cleanup()
        except Exception:
            pass


if __name__ == "__main__":
    if not setup_gpio():
        print("❌ GPIO unavailable")
        sys.exit(1)
    # Skip flaky edge detection — go straight to polling
    run_polling_loop()
