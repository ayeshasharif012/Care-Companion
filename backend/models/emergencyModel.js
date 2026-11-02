import mongoose from "mongoose";

const emergencySchema = new mongoose.Schema(
  {
    companionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Companion",
      required: true,
    },
    caregiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    message: {
      type: String,
      default: "Urgent help needed!",
    },
    status: {
      type: String,
      enum: ["active", "resolved"],
      default: "active",
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    autoIndex: true,
  }
);

const Emergency = mongoose.model("Emergency", emergencySchema);

export default Emergency;