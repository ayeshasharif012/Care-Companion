/**
 * Generate a short emotion-toned story for Care Companion.
 * Tone rules:
 *  - happy  → cheerful / upbeat
 *  - sad|angry → calm, soothing, empathetic
 *  - neutral → standard conversational storytelling
 */
import OpenAI from "openai";

let _client = null;
function getClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY missing");
  if (!_client) _client = new OpenAI({ apiKey });
  return _client;
}

function normalizeLanguage(raw) {
  const v = String(raw || "english").toLowerCase().trim();
  if (v.includes("urdu") || v === "ur") return "urdu";
  return "english";
}

function normalizeEmotion(raw) {
  const e = String(raw || "neutral").toLowerCase().trim();
  if (e.includes("happy") || e.includes("joy")) return "happy";
  if (e.includes("sad")) return "sad";
  if (e.includes("angry") || e.includes("anger")) return "angry";
  return "neutral";
}

function toneForEmotion(mood) {
  if (mood === "happy") {
    return "cheerful, warm, and upbeat — celebrate gentle joy without being childish";
  }
  if (mood === "sad" || mood === "angry") {
    return "calm, soothing, and empathetic — soft pacing to help the listener relax";
  }
  return "clear, friendly, standard conversational storytelling — balanced and warm";
}

const FALLBACK = {
  english: {
    happy:
      "On a bright morning, soft sunlight warmed a quiet garden. Birds sang gently, and an old friend smiled knowing joy grows when shared. You are surrounded by care.",
    sad: "A small lantern glowed in the evening breeze. Even when the sky felt heavy, its warm light stayed close. You are not alone — rest is allowed, and tomorrow can be kinder.",
    angry:
      "A restless river slowed as it reached a calm lake. The water learned to breathe, and the shore listened without judgment. Your feelings matter, and peace can return gently.",
    neutral:
      "In a peaceful room, a soft clock ticked like a heartbeat. Everything was safe, simple, and still. Take one slow breath — I am here with you.",
  },
  urdu: {
    happy:
      "ایک روشن صبح باغ میں نرم دھوپ پھیلی۔ پرندے ہلکے سے گائے، اور دل مسکرایا۔ خوشی بانٹنے سے بڑھتی ہے — آپ محفوظ اور پیارے ہیں۔",
    sad: "شام کی ہلکی روشنی میں ایک چھوٹا سا دیا جلا۔ آسمان بھاری لگا، مگر روشنی قریب رہی۔ آپ اکیلے نہیں — آرام جائز ہے، اور کل نرم ہو سکتا ہے۔",
    angry:
      "ایک بے چین دریا جھیل تک پہنچ کر آہستہ ہو گیا۔ پانی نے سانس لی، اور کنارے نے خاموشی سے سنا۔ آپ کے جذبات اہم ہیں، سکون آہستہ واپس آ سکتا ہے۔",
    neutral:
      "ایک پرسکون کمرے میں گھڑی نرم سی چلی۔ سب محفوظ اور سادہ تھا۔ ایک آہستہ سانس لیں — میں آپ کے ساتھ ہوں۔",
  },
};

export async function generateEmotionStory(emotion, language = "english") {
  const mood = normalizeEmotion(emotion);
  const lang = normalizeLanguage(language);
  const langName = lang === "urdu" ? "Urdu" : "English";
  const tone = toneForEmotion(mood);

  try {
    const client = getClient();
    const resp = await client.chat.completions.create({
      model: process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            `You are Care Companion. Write a short story in ${langName} only. ` +
            `Detected mood: ${mood}. Delivery tone: ${tone}. ` +
            `4–6 sentences for an elderly listener. No medical advice. ` +
            `End with one supportive line.`,
        },
        {
          role: "user",
          content: `Please tell a story for someone feeling ${mood}, using the required tone.`,
        },
      ],
      max_tokens: 260,
      temperature: 0.75,
    });
    const text = (resp.choices?.[0]?.message?.content || "").trim();
    if (text) return { story: text, emotion: mood, language: lang, source: "openai" };
  } catch (err) {
    console.error("⚠️ Story generation fallback:", err.message);
  }

  return {
    story: FALLBACK[lang][mood] || FALLBACK.english.neutral,
    emotion: mood,
    language: lang,
    source: "fallback",
  };
}

export default { generateEmotionStory };
