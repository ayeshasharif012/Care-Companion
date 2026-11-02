import mongoose from "mongoose";

const moodSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  mood: { type: String, required: true }, // "Happy", "Sad", "Neutral"
  timestamp: { type: Date, default: Date.now },
});

const MoodLog = mongoose.model("MoodLog", moodSchema);
export default MoodLog;
