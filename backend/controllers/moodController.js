// controllers/moodController.js
import mongoose from "mongoose";

const Emotion = mongoose.connection.collection("emotions");

const emotionScore = {
  happy: 2,
  neutral: 0,
  sad: -2,
  angry: -1,
};

export const getMood = async (req, res) => {
  try {
    const { userId } = req.params;
    const days = parseInt(req.query.days) || 7;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    let oid = null;
    try {
      oid = new mongoose.Types.ObjectId(userId);
    } catch {
      oid = null;
    }

    // EmotionModel stores `user` (not userId) — support both for safety
    const userFilter = oid
      ? { $or: [{ user: oid }, { userId: oid }, { user: userId }, { userId: userId }] }
      : { $or: [{ user: userId }, { userId: userId }] };

    const emotions = await Emotion.find({
      ...userFilter,
      createdAt: { $gte: startDate },
    })
      .sort({ createdAt: -1 })
      .toArray();

    if (!emotions.length) {
      return res.json({
        mood: "Neutral",
        message: "No data found",
        totalScore: 0,
        dataPoints: 0,
      });
    }

    let totalScore = 0;
    emotions.forEach((e) => (totalScore += emotionScore[e.emotion] || 0));

    let calculatedMood = "Neutral";
    if (totalScore > 2) calculatedMood = "Happy";
    else if (totalScore < -2) calculatedMood = "Sad";

    const latest = emotions[0];

    res.json({
      _id: latest._id,
      userId,
      mood: latest.emotion,
      overallStatus: calculatedMood,
      timestamp: latest.createdAt,
      dataPoints: emotions.length,
    });
  } catch (error) {
    console.error("Mood calculation failed:", error.message);
    res.status(500).json({ message: "Server error" });
  }
};
