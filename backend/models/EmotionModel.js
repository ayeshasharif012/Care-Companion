import mongoose from "mongoose";

const emotionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  emotion: { type: String, enum: ["happy", "sad", "angry", "neutral"], required: true },
  confidence: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model("Emotion", emotionSchema);
