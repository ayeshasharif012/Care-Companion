/**
 * Single source of truth for device networking.
 * - DEV_HOST = Windows PC (Node backend :5000 + Expo Metro) — sockets & REST API
 * - PI_HOST  = Raspberry Pi IoT Flask (:5002) — speak / set-user / voice only
 *
 * NEVER point SOCKET_URL / API at the Pi — Socket.IO lives only on the Node backend.
 */
const DEV_HOST = "192.168.0.106"; // PC Wi-Fi (must match Expo Metro banner)
const PI_HOST = "100.109.141.51"; // Pi Tailscale IP
const API_PORT = 5000;
const IOT_PORT = 5002;

function isUsableHost(value?: string | null): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  if (v.includes("carecompanion") && !/\d+\.\d+\.\d+\.\d+/.test(v)) return false;
  if (v.includes("localhost") || v.includes("127.0.0.1")) return false;
  return true;
}

function pickUrl(envValue: string | undefined, fallback: string): string {
  const raw = envValue?.trim();
  if (raw && isUsableHost(raw)) return raw.replace(/\/$/, "");
  return fallback;
}

/** Reject accidental Pi IoT URL for API/socket (port 5001/5002). */
function assertBackendUrl(url: string, label: string): string {
  if (/:(5001|5002)(\/|$)/.test(url)) {
    console.warn(
      `[network] ${label} must be Windows backend :5000, not Pi. Got ${url} → using fallback.`
    );
    return `http://${DEV_HOST}:${API_PORT}`;
  }
  return url;
}

export const API_BASE_URL = assertBackendUrl(
  pickUrl(process.env.EXPO_PUBLIC_SOCKET_URL, `http://${DEV_HOST}:${API_PORT}`),
  "API_BASE_URL / SOCKET"
);

export const API_URL = assertBackendUrl(
  pickUrl(process.env.EXPO_PUBLIC_API_URL, `${API_BASE_URL}/api`),
  "API_URL"
);

export const SOCKET_URL = API_BASE_URL;

/** Pi Flask IoT — prefer Tailscale Pi for phone app (override with EXPO_PUBLIC_IOT_URL) */
export const IOT_CONTROLLER_URL = pickUrl(
  process.env.EXPO_PUBLIC_IOT_URL,
  `http://${PI_HOST}:${IOT_PORT}`
);

export { API_PORT, IOT_PORT, DEV_HOST, PI_HOST };

if (__DEV__) {
  console.log("[network] API_URL =", API_URL);
  console.log("[network] SOCKET_URL =", SOCKET_URL);
  console.log("[network] IOT_CONTROLLER_URL =", IOT_CONTROLLER_URL);
}
