import mongoose from "mongoose";

const reminderSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    title: { type: String, required: true },
    description: { type: String, default: "" },
    date: { type: Date, required: true },
    language: {
      type: String,
      enum: ["english", "urdu"],
      default: "english",
    },
    status: {
      type: String,
      enum: ["pending", "completed"],
      default: "pending",
    },
  },
  { timestamps: true }
);

const Reminder = mongoose.model("Reminder", reminderSchema);
export default Reminder;
