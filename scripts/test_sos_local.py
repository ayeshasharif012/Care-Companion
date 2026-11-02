#!/usr/bin/env python3
"""
Quick local test for Care Companion SOS endpoint.

Usage:
  python scripts/test_sos_local.py
  python scripts/test_sos_local.py --host 192.168.0.106
  python scripts/test_sos_local.py --resolve   # resolve active alert first (needs login)

Requires: backend running on port 5000 and demo data seeded (npm run seed:demo).
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request


def request(method: str, url: str, data: dict | None = None, headers: dict | None = None, timeout: float = 10):
    body = None
    hdrs = {"Accept": "application/json", **(headers or {})}
    if data is not None:
        body = json.dumps(data).encode("utf-8")
        hdrs["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=body, headers=hdrs, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8")
        return resp.status, json.loads(raw) if raw else {}


def main() -> int:
    parser = argparse.ArgumentParser(description="Test POST /api/emergency/trigger-demo")
    parser.add_argument("--host", default="127.0.0.1", help="Backend host (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=5000, help="Backend port (default: 5000)")
    parser.add_argument(
        "--resolve",
        action="store_true",
        help="Login as demo caregiver and resolve active alert before triggering",
    )
    args = parser.parse_args()

    base = f"http://{args.host}:{args.port}"
    health_url = f"{base}/api/health"
    sos_url = f"{base}/api/emergency/trigger-demo"

    print(f"1) Health check: GET {health_url}")
    try:
        status, health = request("GET", health_url)
        print(f"   {status} OK — db={health.get('db')}")
    except urllib.error.URLError as e:
        print(f"   FAILED: {e}")
        print("   Start backend first: cd backend && npm run dev")
        return 1

    if args.resolve:
        login_url = f"{base}/api/users/login"
        print(f"2) Resolve active alert via login: POST {login_url}")
        try:
            _, login = request(
                "POST",
                login_url,
                {"email": "demo.caregiver@carecompanion.local", "password": "Demo1234!"},
            )
            token = login.get("token")
            if not token:
                print("   Login failed — run: cd backend && npm run seed:demo")
                return 1
            _, emergencies = request(
                "GET",
                f"{base}/api/emergency",
                headers={"Authorization": f"Bearer {token}"},
            )
            for alert in emergencies:
                if alert.get("status") == "active":
                    alert_id = alert.get("_id")
                    resolve_url = f"{base}/api/emergency/{alert_id}/resolve"
                    request(
                        "PUT",
                        resolve_url,
                        headers={"Authorization": f"Bearer {token}"},
                    )
                    print(f"   Resolved active alert {alert_id}")
        except urllib.error.HTTPError as e:
            print(f"   Resolve step skipped/failed: HTTP {e.code}")

    print(f"3) Trigger SOS: POST {sos_url}")
    try:
        status, payload = request("POST", sos_url, data={})
        print(f"   HTTP {status}")
        print(json.dumps(payload, indent=2))
        if status == 201:
            print("\nSUCCESS — SOS endpoint returned 201 Created.")
            return 0
        return 1
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"   HTTP {e.code}: {body}")
        if e.code == 404:
            print("\nTip: Seed demo user + companion: cd backend && npm run seed:demo")
        if e.code == 400 and "already active" in body.lower():
            print("\nTip: Re-run with --resolve or resolve the alert in the mobile app.")
        return 1
    except urllib.error.URLError as e:
        print(f"   FAILED: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
