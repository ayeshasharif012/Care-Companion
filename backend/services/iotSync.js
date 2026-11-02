import axios from "axios";
import { IOT_CONTROLLER_URL, IOT_FALLBACK_URLS } from "../config/network.js";

const IOT_TIMEOUT_MS = Number(process.env.IOT_REQUEST_TIMEOUT_MS || 4000);

/** Tell Pi to refresh user + companion language from MongoDB. */
export async function syncCompanionWithIoT(userId) {
  if (!userId) return;
  const urls = IOT_FALLBACK_URLS.length ? IOT_FALLBACK_URLS : [IOT_CONTROLLER_URL];
  const payload = { userId: String(userId) };

  for (const base of urls) {
    try {
      await axios.post(`${base.replace(/\/$/, "")}/set-user`, payload, {
        timeout: IOT_TIMEOUT_MS,
      });
      console.log(`✅ IoT set-user synced → ${base}`);
      return;
    } catch (err) {
      console.warn(`⚠️ IoT set-user failed (${base}): ${err.message}`);
    }
  }
}
