import AsyncStorage from "@react-native-async-storage/async-storage";
import API from "../src/api/api";
import { API_URL, IOT_CONTROLLER_URL, DEV_HOST, PI_HOST, IOT_PORT } from "../config";

const BASE_URL = API_URL;

let lastSavedEmotion = "";
let lastIotBase = IOT_CONTROLLER_URL;

/** Try Pi Tailscale first (usual FYP setup), then configured URL, then laptop local. */
export function getIotCandidates() {
  return [...new Set([
    `http://${PI_HOST}:${IOT_PORT}`,
    IOT_CONTROLLER_URL,
    `http://${DEV_HOST}:${IOT_PORT}`,
  ].map((u) => u.replace(/\/$/, "")))];
}

export function getIotDeviceLabel(baseUrl = lastIotBase) {
  const u = (baseUrl || "").toLowerCase();
  if (u.includes(DEV_HOST.toLowerCase()) || u.includes("127.0.0.1") || u.includes("localhost")) {
    return "Laptop";
  }
  if (u.includes(PI_HOST)) return "Raspberry Pi";
  return "Companion Device";
}

async function fetchIotJson(path, body, timeoutMs = 45000) {
  const candidates = getIotCandidates();
  let lastError = "Companion IoT not reachable";

  for (const base of candidates) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);

      const text = await res.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }

      if (res.ok && data) {
        lastIotBase = base;
        return { data, base };
      }
      lastError = data?.message || text || `HTTP ${res.status}`;
    } catch (err) {
      lastError = err?.message || String(err);
    }
  }

  throw new Error(lastError);
}

export async function checkIotHealth() {
  for (const base of getIotCandidates()) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(`${base}/health`, {
        method: "GET",
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        lastIotBase = base;
        const data = await res.json();
        return { ok: true, base, data };
      }
    } catch {
      /* try next */
    }
  }
  return { ok: false, base: null, data: null };
}

/** Record + classify on companion mic (Pi or laptop running main.py). */
export const triggerPiEmotionScan = async (seconds = 3) => {
  try {
    const userId = await AsyncStorage.getItem("userId");
    if (!userId) return { error: "Please log in first" };

    const { data, base } = await fetchIotJson("/api/emotion/scan", { userId, seconds }, 60000);
    if (data.status !== "success") {
      return { error: data.message || "Scan failed" };
    }

    lastSavedEmotion = data.emotion || lastSavedEmotion;
    return {
      emotion: data.emotion,
      confidence: data.confidence,
      source: data.source || "companion_mic",
      device: getIotDeviceLabel(base),
      base,
    };
  } catch (error) {
    console.error("Emotion scan error:", error);
    return { error: error.message || "Cannot reach companion mic" };
  }
};

export const startPiVoiceChat = async (turns = 3) => {
  try {
    const userId = await AsyncStorage.getItem("userId");
    if (!userId) return null;

    const { data } = await fetchIotJson(
      "/api/voice/chat",
      { companion: userId, turns },
      120000
    );
    return data;
  } catch (error) {
    console.error("Voice chat error:", error);
    return null;
  }
};

export const playStoryOnPi = async (emotion) => {
  try {
    const userId = await AsyncStorage.getItem("userId");
    const { data } = await fetchIotJson("/api/story", {
      userId,
      emotion,
      speak: true,
    });
    return data;
  } catch (error) {
    console.error("Story error:", error);
    return null;
  }
};

export const getLatestEmotion = async () => {
  try {
    const userId = await AsyncStorage.getItem("userId");
    const token = await AsyncStorage.getItem("token");
    if (!userId || !token) return null;

    const { data } = await API.get(`/emotion/latest/${userId}`);
    if (data.success && data.emotion?.emotion) {
      lastSavedEmotion = data.emotion.emotion;
      return data.emotion;
    }
    return null;
  } catch (error) {
    if (error?.response?.status === 404) return null;
    console.error("Fetch latest emotion:", error?.response?.data?.message || error.message);
    return null;
  }
};

export const getEmotionHistory = async (days = 7) => {
  try {
    const userId = await AsyncStorage.getItem("userId");
    if (!userId) return [];
    const { data } = await API.get(`/emotion/history/${userId}?days=${days}`);
    return data?.emotions || [];
  } catch {
    return [];
  }
};

export const getEmotionStory = async (emotion) => {
  try {
    const userId = await AsyncStorage.getItem("userId");
    if (!userId) return null;

    const { data } = await API.post("/emotion/story", { userId, emotion });
    if (data.success && data.story) return data;
    return null;
  } catch (error) {
    console.error("Story fetch error:", error);
    return null;
  }
};
