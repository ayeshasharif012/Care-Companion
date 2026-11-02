import AsyncStorage from "@react-native-async-storage/async-storage";
import API from "../src/api/api";
import { IOT_CONTROLLER_URL } from "../config";

export type CompanionLang = "english" | "urdu";

const STORAGE_KEY = "companionLanguage";

export function normalizeCompanionLang(raw?: string | null): CompanionLang {
  const v = String(raw || "english").toLowerCase();
  return v.includes("urdu") || v === "ur" ? "urdu" : "english";
}

export async function getStoredCompanionLanguage(): Promise<CompanionLang | null> {
  const v = await AsyncStorage.getItem(STORAGE_KEY);
  return v ? normalizeCompanionLang(v) : null;
}

export async function fetchCompanionLanguage(): Promise<CompanionLang> {
  try {
    const { data } = await API.get("/companion/me");
    const lang = normalizeCompanionLang(data?.language);
    await AsyncStorage.setItem(STORAGE_KEY, lang);
    return lang;
  } catch {
    const cached = await getStoredCompanionLanguage();
    return cached || "english";
  }
}

export async function updateCompanionLanguage(
  language: CompanionLang
): Promise<CompanionLang> {
  const { data } = await API.patch("/companion/me/language", { language });
  const lang = normalizeCompanionLang(data?.language || language);
  await AsyncStorage.setItem(STORAGE_KEY, lang);

  const userId = await AsyncStorage.getItem("userId");
  if (userId) {
    Promise.race([
      fetch(`${IOT_CONTROLLER_URL}/set-user`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 2000)),
    ]).catch(() => {});
  }

  return lang;
}
