import mongoose from "mongoose";

const healthTipTemplateSchema = new mongoose.Schema(
  {
    language: {
      type: String,
      enum: ["urdu", "english"],
      required: true,
    },
    category: {
      type: String,
      enum: ["hydration", "posture", "exercise", "nutrition", "wellness"],
      required: true,
    },
    tipText: { type: String, required: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model("HealthTipTemplate", healthTipTemplateSchema);
