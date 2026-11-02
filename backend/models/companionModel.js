import mongoose from "mongoose";

const companionSchema = mongoose.Schema({
  name: { type: String, required: true },
  age: { type: Number },
  gender: { type: String },
  contactNumber: { type: String },
  language: { type: String, required: true }, // manually set from frontend
  medicalNotes: { type: String },
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, // assigned caregiver
}, { timestamps: true });

const Companion = mongoose.model("Companion", companionSchema);

export default Companion;