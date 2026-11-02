/**
 * Backend → Raspberry Pi connection strings.
 * Pi Tailscale IP (stable): 100.109.141.51
 * Pi LAN (changes): check Flask log "Running on http://..."
 * Override with PI_HOST / IOT_CONTROLLER_URL env vars.
 */
const DEFAULT_PI_HOST = "100.109.141.51";

function pickHost(raw, fallback) {
  const v = (raw || "").trim();
  if (!v) return fallback;
  // Reject hosts that are the Windows PC or localhost — never the Pi
  const bad = ["192.168.1.92", "100.94.54.17", "localhost", "127.0.0.1", "carecompanion"];
  const lower = v.toLowerCase();
  if (bad.some((b) => lower === b || lower.includes(b + ":"))) {
    console.warn(`[network] Ignoring non-Pi host "${v}", using ${fallback}`);
    return fallback;
  }
  return v.replace(/^https?:\/\//, "").replace(/\/$/, "").split(":")[0] || fallback;
}

const PI_HOST = pickHost(
  process.env.PI_HOST || process.env.TAILSCALE_HOST,
  DEFAULT_PI_HOST
);

export const IOT_CONTROLLER_URL = (
  process.env.IOT_CONTROLLER_URL &&
  !/192\.168\.1\.92|100\.94\.54\.17|localhost|carecompanion/i.test(process.env.IOT_CONTROLLER_URL)
    ? process.env.IOT_CONTROLLER_URL
    : `http://${PI_HOST}:5002`
).replace(/\/$/, "");

export const AI_SERVICE_URL = (
  process.env.AI_SERVICE_URL &&
  !/192\.168\.1\.92|100\.94\.54\.17|localhost|carecompanion/i.test(process.env.AI_SERVICE_URL)
    ? process.env.AI_SERVICE_URL
    : `http://${PI_HOST}:5001`
).replace(/\/$/, "");

export const TAILSCALE_HOST = PI_HOST;

// Fallback list for IoT push (Pi only — do not include Windows IPs)
export const IOT_FALLBACK_URLS = [
  IOT_CONTROLLER_URL,
  "http://100.109.141.51:5002",
  "http://192.168.0.190:5002",
  "http://192.168.1.94:5002",
].filter((url, i, arr) => arr.indexOf(url) === i);

console.log(`[network] IOT_CONTROLLER_URL = ${IOT_CONTROLLER_URL}`);
console.log(`[network] AI_SERVICE_URL = ${AI_SERVICE_URL}`);
