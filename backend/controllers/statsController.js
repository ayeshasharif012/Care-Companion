import Emergency from "../models/emergencyModel.js";
import Emotion from "../models/EmotionModel.js";
import Reminder from "../models/reminderModel.js";
import HealthTip from "../models/HealthTip.js";
import Companion from "../models/companionModel.js";

function weekStart(days = 7) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (days - 1));
  return d;
}

/** GET /api/stats/weekly — single payload for Weekly Stats screen */
export const getWeeklyStats = async (req, res) => {
  try {
    const userId = req.user._id;
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 30);
    const since = weekStart(days);

    let tipLanguage = "english";
    try {
      const companion = await Companion.findOne({ user: userId }).lean();
      const lang = String(companion?.language || "english").toLowerCase();
      tipLanguage = lang.includes("urdu") || lang === "ur" ? "urdu" : "english";
    } catch {
      /* default english */
    }

    const [emergencies, emotions, reminders, healthTips] = await Promise.all([
      Emergency.find({ caregiverId: userId })
        .populate("companionId", "name")
        .sort({ status: 1, createdAt: -1 })
        .lean(),
      Emotion.find({ user: userId, createdAt: { $gte: since } })
        .sort({ createdAt: -1 })
        .lean(),
      Reminder.find({ userId }).sort({ date: -1 }).lean(),
      HealthTip.find({
        createdBy: userId,
        active: true,
        language: tipLanguage,
      })
        .sort({ createdAt: -1 })
        .lean(),
    ]);

    const weekEmergencies = emergencies.filter(
      (e) => e.createdAt && new Date(e.createdAt) >= since
    );
    const weekReminders = reminders.filter(
      (r) =>
        (r.date && new Date(r.date) >= since) ||
        (r.updatedAt && new Date(r.updatedAt) >= since)
    );
    const weekTips = healthTips.filter(
      (t) => t.createdAt && new Date(t.createdAt) >= since
    );

    const emotionCounts = { happy: 0, sad: 0, angry: 0, neutral: 0 };
    emotions.forEach((e) => {
      const key = String(e.emotion || "neutral").toLowerCase();
      if (key in emotionCounts) emotionCounts[key]++;
      else emotionCounts.neutral++;
    });

    const activeEmergencies = emergencies.filter((e) => e.status === "active");
    const pendingReminders = weekReminders.filter((r) => r.status === "pending");
    const completedReminders = weekReminders.filter((r) => r.status === "completed");

    res.status(200).json({
      success: true,
      days,
      generatedAt: new Date().toISOString(),
      emergencies,
      emotions: emotions.map((e) => ({
        emotion: e.emotion,
        confidence: e.confidence ?? 0,
        createdAt: e.createdAt,
      })),
      reminders,
      healthTips,
      summary: {
        emergencies: {
          active: activeEmergencies.length,
          resolvedWeek: weekEmergencies.filter((e) => e.status === "resolved").length,
          totalWeek: weekEmergencies.length,
        },
        emotions: {
          total: emotions.length,
          counts: emotionCounts,
          dominant:
            Object.entries(emotionCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ||
            "neutral",
          avgConfidence: emotions.length
            ? emotions.reduce((s, e) => s + (e.confidence || 0), 0) / emotions.length
            : 0,
        },
        reminders: {
          pending: pendingReminders.length,
          completed: completedReminders.length,
          totalWeek: weekReminders.length,
          completionRate: weekReminders.length
            ? Math.round((completedReminders.length / weekReminders.length) * 100)
            : 0,
        },
        healthTips: {
          active: healthTips.length,
          addedWeek: weekTips.length,
        },
      },
    });
  } catch (error) {
    console.error("❌ getWeeklyStats:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};
