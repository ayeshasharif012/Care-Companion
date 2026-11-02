import mongoose from "mongoose";

const healthTipSchema = new mongoose.Schema(
  {
    language: { type: String, enum: ["urdu", "english"], required: true },
    category: { type: String, enum: ["hydration", "posture", "exercise", "nutrition", "wellness"], required: true },
    tipText: { type: String, required: true },
    audioUrl: { type: String, required: true }, // relative path or URL to audio file
    active: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // optional
  },
  { timestamps: true }
);

export default mongoose.model("HealthTip", healthTipSchema);