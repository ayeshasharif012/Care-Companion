// backend/controllers/healthTipController.js
import HealthTip from "../models/HealthTip.js";
import Companion from "../models/companionModel.js";
import HealthTipTemplate from "../models/HealthTipTemplate.js";
import { ensureHealthTipTemplatesSeeded } from "../services/healthTipTemplates.js";
import path from "path";
import { fileURLToPath } from "url";
import fsPromises from "fs/promises";
import axios from "axios";
import { generateAudioWithOpenAI } from "../services/ttsService.js";
import { IOT_CONTROLLER_URL, IOT_FALLBACK_URLS } from "../config/network.js";
import { emitRealtime } from "../utils/realtime.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IOT_REQUEST_TIMEOUT_MS = Number(process.env.IOT_REQUEST_TIMEOUT_MS || 4000);

/** Push tip sync to Pi — tries fallbacks, never blocks the HTTP response long. */
const syncHealthTipsWithIoT = async (userId) => {
  const urls = IOT_FALLBACK_URLS.length ? IOT_FALLBACK_URLS : [IOT_CONTROLLER_URL];
  let lastErr = null;

  for (const base of urls) {
    const target = `${base}/sync-health-tips`;
    try {
      await axios.post(
        target,
        { userId: String(userId) },
        {
          timeout: IOT_REQUEST_TIMEOUT_MS,
          headers: { "Content-Type": "application/json" },
        }
      );
      console.log(`✅ Health tips synced with IoT → ${target}`);
      return;
    } catch (error) {
      lastErr = error?.message || String(error);
      console.warn(`⚠️ IoT sync failed (${target}): ${lastErr}`);
    }
  }
  console.warn(
    `⚠️ IoT health tips sync unavailable for user ${userId}. ` +
      `Pi may be offline — tips stay in Mongo; Pi will pull on next /set-user or play loop. Last: ${lastErr}`
  );
};

// Ensure audio directory exists
const AUDIO_DIR = path.join(__dirname, "../public/audio/tips");
await fsPromises.mkdir(AUDIO_DIR, { recursive: true });

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const HEALTH_TIPS_TRANSLATION_MAP = {
  "practice deep breathing exercises to reduce stress.": "گہری سانس لینے کی ورزش کریں تاکہ تناؤ کم ہو۔",
  "practice deep breathing exercises to reduce stress": "گہری سانس لینے کی ورزش کریں تاکہ تناؤ کم ہو۔",
  "get 7-8 hours of sleep every night.": "ہر رات 7 سے 8 گھنٹے کی نیند لیں۔",
  "get 7-8 hours of sleep every night": "ہر رات 7 سے 8 گھنٹے کی نیند لیں۔",
  "drink at least 8 glasses of water daily to stay hydrated.": "روزانہ کم از کم 8 گلاس پانی پیئں۔",
  "drink at least 8 glasses of water daily to stay hydrated": "روزانہ کم از کم 8 گلاس پانی پیئں۔",
  "keep a water bottle with you throughout the day.": "ہمیشہ اپنے ساتھ پانی کی بوتل رکھیں۔",
  "keep a water bottle with you throughout the day": "ہمیشہ اپنے ساتھ پانی کی بوتل رکھیں۔",
  "avoid sugary drinks and prefer water or herbal tea.": "شکر والے مشروبات سے بچیں اور پانی پیئں۔",
  "avoid sugary drinks and prefer water or herbal tea": "شکر والے مشروبات سے بچیں اور پانی پیئں۔",
  "take a 30-minute walk every day for better health.": "روزانہ 30 منٹ کی سیر کریں۔",
  "take a 30-minute walk every day for better health": "روزانہ 30 منٹ کی سیر کریں۔",
  "do gentle stretching exercises in the morning.": "صبح میں نرم ورزش کریں۔",
  "do gentle stretching exercises in the morning": "صبح میں نرم ورزش کریں۔",
  "take breaks every hour to stretch your neck and shoulders.": "ہر گھنٹے میں اپنی گردن کو سمجھو کریں۔",
  "take breaks every hour to stretch your neck and shoulders": "ہر گھنٹے میں اپنی گردن کو سمجھو کریں۔",
  "sit up straight with your shoulders back and relaxed.": "سیدھے بیٹھیں اور اپنے کندھے پیچھے رکھیں۔",
  "sit up straight with your shoulders back and relaxed": "سیدھے بیٹھیں اور اپنے کندھے پیچھے رکھیں۔",
  "eat more fruits and vegetables for better nutrition.": "زیادہ سے زیادہ پھل اور سبزیاں کھائیں۔",
  "eat more fruits and vegetables for better nutrition": "زیادہ سے زیادہ پھل اور سبزیاں کھائیں۔"
};

export const createHealthTip = async (req, res) => {
  try {
    const { category, tipText, language: requestLanguage } = req.body;
    if (!category || !tipText) {
      return res.status(400).json({ message: "Missing required fields: category and tipText" });
    }

    let dbLanguage = "english"; 
    
    if (requestLanguage) {
      const normalizedReqLang = requestLanguage.toLowerCase().trim();
      dbLanguage = (normalizedReqLang === "ur" || normalizedReqLang === "urdu") ? "urdu" : "english";
    } else {
      try {
        const companion = await Companion.findOne({ user: req.user._id });
        if (companion?.language) {
          const normalizedLang = companion.language.toLowerCase().trim();
          dbLanguage = (normalizedLang === "ur" || normalizedLang === "urdu") ? "urdu" : "english";
        }
      } catch (err) {
        console.error(`⚠️ Error fetching companion language context:`, err.message);
      }
    }

    let processedText = tipText.trim().replace(/\s+/g, ' ');
    if (dbLanguage === "urdu") {
      const lowerText = processedText.toLowerCase();
      if (HEALTH_TIPS_TRANSLATION_MAP[lowerText]) {
        processedText = HEALTH_TIPS_TRANSLATION_MAP[lowerText];
      } else if (!/[\u0600-\u06FF]/.test(processedText)) {
        processedText = "اپنی صحت کا خیال رکھیں، وقت پر پانی پییں اور آرام کریں۔";
      }
    }

    const escapedText = escapeRegex(processedText);
    const existingUserTip = await HealthTip.findOne({
      createdBy: req.user._id,
      language: dbLanguage,
      category,
      tipText: { $regex: new RegExp(`^${escapedText}$`, 'i') },
      active: true
    });

    if (existingUserTip) {
      return res.status(400).json({
        message: "You have already added this tip."
      });
    }

    const timestamp = Date.now();
    const filename = `${timestamp}_${dbLanguage}.wav`;
    const outputPath = path.join(AUDIO_DIR, filename);

    const tip = new HealthTip({
      language: dbLanguage,
      category,
      tipText: processedText,
      audioUrl: `/audio/tips/${filename}`,
      createdBy: req.user._id,
    });
    
    await tip.save();
    console.log(
      `💾 [HealthTip] SAVED in Mongo: lang=${dbLanguage} cat=${category} text="${processedText.slice(0, 80)}"`
    );
    emitRealtime(req.app, "healthTipUpdated", { action: "created", tip });
    res.status(201).json(tip);

    // Sync health tips with IoT (non-blocking)
    syncHealthTipsWithIoT(req.user._id).catch(() => {});

    // Dynamic background compilation thread engine mapping context trigger fluid
    generateAudioWithOpenAI(processedText, dbLanguage, outputPath)
      .then(() => console.log(`✅ Audio compiled securely for ID node structure: ${tip._id}`))
      .catch(err => console.error(`❌ Background validation engine mismatch trigger exception:`, err.message));

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getHealthTips = async (req, res) => {
  try {
    const caregiverId = req.user?._id || req.query.caregiverId;
    if (!caregiverId) {
      return res.status(401).json({ message: "Login required to view health tips" });
    }

    let language = req.query.language;
    if (!language) {
      try {
        const companion = await Companion.findOne({ user: caregiverId });
        language = companion?.language ? companion.language.toLowerCase() : "english";
      } catch {
        language = "english";
      }
    }

    const normalizedLang = String(language).toLowerCase().trim();
    const dbLanguage =
      normalizedLang === "ur" || normalizedLang === "urdu" ? "urdu" : "english";

    const tips = await HealthTip.find({
      active: true,
      createdBy: caregiverId,
      language: dbLanguage,
    }).sort("-createdAt");

    res.json(tips);
  } catch (error) {
    console.error("getHealthTips:", error.message);
    res.status(500).json({ message: "Unable to load health tips" });
  }
};

export const updateHealthTip = async (req, res) => {
  try {
    const tip = await HealthTip.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(tip);
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

export const deleteHealthTip = async (req, res) => {
  try {
    const tip = await HealthTip.findById(req.params.id);
    if (!tip) return res.status(404).json({ message: "Tip context not matching system directory log targets" });

    await HealthTip.findByIdAndUpdate(req.params.id, { active: false }, { new: true });
    console.log(
      `🗑️ [HealthTip] DELETED (active=false): id=${req.params.id} text="${(tip.tipText || "").slice(0, 80)}"`
    );
    res.json({ message: "Tip deleted" });

    // Sync so Pi stops playing this tip
    syncHealthTipsWithIoT(req.user._id).catch(() => {});
    const filename = path.basename(tip.audioUrl);
    const filePath = path.join(__dirname, "../public/audio/tips", filename);
    fsPromises.unlink(filePath).catch(() => console.log(`⏭️ Missing file sequence skipped context cleanup safe`));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const suggestedTips = {
  english: [
    { category: "hydration", text: "Drink at least 8 glasses of water daily to stay hydrated." },
    { category: "hydration", text: "Keep a water bottle with you throughout the day." },
    { category: "posture", text: "Sit up straight with your shoulders back and relaxed." },
    { category: "posture", text: "Take breaks every hour to stretch your neck and shoulders." },
    { category: "exercise", text: "Take a 30-minute walk every day for better health." },
    { category: "exercise", text: "Do gentle stretching exercises in the morning." },
    { category: "nutrition", text: "Eat more fruits and vegetables for better nutrition." },
    { category: "nutrition", text: "Avoid sugary drinks and prefer water or herbal tea." },
    { category: "wellness", text: "Get 7-8 hours of sleep every night." },
    { category: "wellness", text: "Practice deep breathing exercises to reduce stress." },
  ],
  urdu: [
    { category: "hydration", text: "روزانہ کم از کم 8 گلاس پانی پیئں۔" },
    { category: "hydration", text: "ہمیشہ اپنے ساتھ پانی کی بوتل رکھیں۔" },
    { category: "posture", text: "سیدھے بیٹھیں اور اپنے کندھے پیچھے رکھیں۔" },
    { category: "posture", text: "ہر گھنٹے میں اپنی گردن کو سمجھو کریں۔" },
    { category: "exercise", text: "روزانہ 30 منٹ کی سیر کریں۔" },
    { category: "exercise", text: "صبح میں نرم ورزش کریں۔" },
    { category: "nutrition", text: "زیادہ سے زیادہ پھل اور سبزیاں کھائیں۔" },
    { category: "nutrition", text: "شکر والے مشروبات سے بچیں اور پانی پیئں۔" },
    { category: "wellness", text: "ہر رات 7 سے 8 گھنٹے کی نیند لیں۔" },
    { category: "wellness", text: "گہری سانس لینے کی ورزش کریں تاکہ تناؤ کم ہو۔" },
  ]
};

export const getSuggestedHealthTips = async (req, res) => {
  try {
    let { language } = req.query;
    if (!language) {
      return res.status(400).json({ message: "language query parameter is required" });
    }

    const normalizedLang = String(language).toLowerCase().trim();
    const dbLanguage =
      normalizedLang === "ur" || normalizedLang === "urdu" ? "urdu" : "english";

    await ensureHealthTipTemplatesSeeded();

    const rows = await HealthTipTemplate.find({
      active: true,
      language: dbLanguage,
    })
      .sort({ category: 1, createdAt: 1 })
      .lean();

    const tips = rows.length
      ? rows.map((r) => ({ category: r.category, text: r.tipText }))
      : suggestedTips[dbLanguage] || [];

    res.json(tips);
  } catch (error) {
    console.error("getSuggestedHealthTips:", error.message);
    res.status(500).json({ message: "Unable to load suggested health tips" });
  }
};