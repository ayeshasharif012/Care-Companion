import mongoose from "mongoose";
import Emotion from "../models/EmotionModel.js";
import Companion from "../models/companionModel.js";
import axios from "axios";
import FormData from "form-data";
import { AI_SERVICE_URL } from "../config/network.js";
import { generateEmotionStory } from "../services/storyService.js";
import { emitRealtime } from "../utils/realtime.js";

const VALID = new Set(["happy", "sad", "angry", "neutral"]);

function normalizeEmotion(raw) {
  const e = String(raw || "neutral").toLowerCase().trim();
  if (e.includes("happy") || e.includes("joy")) return "happy";
  if (e.includes("sad")) return "sad";
  if (e.includes("angry") || e.includes("anger")) return "angry";
  if (VALID.has(e)) return e;
  return "neutral";
}

async function getCompanionLanguage(userId) {
  try {
    const companion = await Companion.findOne({ user: userId });
    const v = String(companion?.language || "english").toLowerCase();
    return v.includes("urdu") ? "urdu" : "english";
  } catch {
    return "english";
  }
}

export const detectEmotion = async (req, res) => {
  try {
    if (!req.files || !req.files.audio) {
      console.error("❌ No audio file in req.files:", req.files);
      return res.status(400).json({ message: "Audio file is required" });
    }

    const { userId } = req.body;
    if (!userId) return res.status(400).json({ message: "userId is required" });

    const formData = new FormData();
    formData.append("audio", req.files.audio.data, {
      filename: "audio.wav",
      contentType: "audio/wav",
    });

    const aiResponse = await axios.post(`${AI_SERVICE_URL}/predict`, formData, {
      headers: { ...formData.getHeaders() },
      timeout: Number(process.env.EMOTION_TIMEOUT_MS || 20000),
    });

    const mood = normalizeEmotion(aiResponse.data?.mood);
    const confidence = Number(aiResponse.data?.confidence ?? 0.5);

    const newEmotion = await Emotion.create({
      user: userId,
      emotion: mood,
      confidence,
    });

    const payload = {
      userId: String(userId),
      emotion: newEmotion.emotion,
      confidence: newEmotion.confidence ?? 0,
      createdAt: newEmotion.createdAt,
    };
    emitRealtime(req.app, "newEmotion", payload);

    res.status(200).json({
      success: true,
      emotion: payload,
    });
  } catch (error) {
    console.error("❌ Full Proxy Error:", error.response?.data || error.message);
    res.status(500).json({ message: "AI Server failure or processing error" });
  }
};

/** Pi mic path: already classified locally — just persist to Mongo */
export const saveEmotion = async (req, res) => {
  try {
    const { userId, emotion, confidence } = req.body || {};
    if (!userId) return res.status(400).json({ message: "userId is required" });

    const mood = normalizeEmotion(emotion);
    const conf = Math.max(0, Math.min(1, Number(confidence ?? 0.5)));

    const saved = await Emotion.create({
      user: userId,
      emotion: mood,
      confidence: conf,
    });

    console.log(`💾 Emotion saved (Pi/API): ${mood} user=${userId}`);
    const payload = {
      userId: String(userId),
      emotion: saved.emotion,
      confidence: saved.confidence ?? 0,
      createdAt: saved.createdAt,
    };
    emitRealtime(req.app, "newEmotion", payload);
    res.status(201).json({
      success: true,
      emotion: payload,
    });
  } catch (error) {
    console.error("❌ Save Emotion Error:", error.message);
    res.status(500).json({ message: "Unable to save emotion" });
  }
};

export const getEmotionHistory = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId) return res.status(400).json({ message: "userId is required" });

    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 30);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    let oid = null;
    try {
      oid = new mongoose.Types.ObjectId(userId);
    } catch {
      oid = null;
    }

    const userFilter = oid
      ? { $or: [{ user: oid }, { user: userId }] }
      : { user: userId };

    const emotions = await Emotion.find({
      ...userFilter,
      createdAt: { $gte: startDate },
    })
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({
      success: true,
      total: emotions.length,
      days,
      emotions: emotions.map((e) => ({
        emotion: e.emotion,
        confidence: e.confidence ?? 0,
        createdAt: e.createdAt,
      })),
    });
  } catch (error) {
    console.error("❌ Get Emotion History Error:", error.message);
    res.status(500).json({ message: "Unable to fetch emotion history" });
  }
};

export const getLatestEmotion = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId) return res.status(400).json({ message: "userId is required" });

    const latestEmotion = await Emotion.findOne({ user: userId }).sort({ createdAt: -1 });
    if (!latestEmotion) {
      return res.status(404).json({ success: false, message: "No saved emotion found" });
    }

    res.status(200).json({
      success: true,
      emotion: {
        emotion: latestEmotion.emotion,
        confidence: latestEmotion.confidence ?? 0,
        createdAt: latestEmotion.createdAt,
      },
    });
  } catch (error) {
    console.error("❌ Get Latest Emotion Error:", error.message);
    res.status(500).json({ message: "Unable to fetch latest emotion" });
  }
};

export const getEmotionStory = async (req, res) => {
  try {
    const userId = req.body?.userId || req.query?.userId || req.params?.userId;
    if (!userId) return res.status(400).json({ message: "userId is required" });

    let emotion = normalizeEmotion(req.body?.emotion || req.query?.emotion);
    if (!req.body?.emotion && !req.query?.emotion) {
      const latest = await Emotion.findOne({ user: userId }).sort({ createdAt: -1 });
      emotion = normalizeEmotion(latest?.emotion || "neutral");
    }

    const languageRaw = req.body?.language || req.query?.language;
    const language = languageRaw
      ? String(languageRaw)
      : await getCompanionLanguage(userId);

    const result = await generateEmotionStory(emotion, language);
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error("❌ Story Error:", error.message);
    res.status(500).json({ message: "Unable to generate story" });
  }
};
