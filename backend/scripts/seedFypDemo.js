/**
 * Seeds a demo caregiver + companion so POST /api/emergency/trigger-demo returns 201.
 * Run from backend/:  npm run seed:demo
 */
import "dotenv/config";
import mongoose from "mongoose";
import User from "../models/userModel.js";
import Companion from "../models/companionModel.js";
import Emergency from "../models/emergencyModel.js";

const DEMO = {
  caregiver: {
    name: "Demo Caregiver",
    email: "demo.caregiver@carecompanion.local",
    password: "Demo1234!",
    mobile: "+923001234567",
    role: "caregiver",
    isActiveCaregiver: true,
  },
  companion: {
    name: "Grandma Demo",
    age: 72,
    gender: "female",
    contactNumber: "+923009876543",
    language: "english",
    medicalNotes: "FYP demo profile",
  },
};

async function main() {
  if (!process.env.MONGO_URI) {
    console.error("MONGO_URI is missing. Copy backend/.env.example to backend/.env first.");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI, { dbName: "care-companion" });
  console.log("Connected to MongoDB");

  let caregiver = await User.findOne({ email: DEMO.caregiver.email });
  if (!caregiver) {
    caregiver = await User.create(DEMO.caregiver);
    console.log("Created demo caregiver:", caregiver.email);
  } else {
    caregiver.isActiveCaregiver = true;
    await caregiver.save();
    console.log("Demo caregiver already exists:", caregiver.email);
  }

  let companion = await Companion.findOne({ user: caregiver._id });
  if (!companion) {
    companion = await Companion.create({ ...DEMO.companion, user: caregiver._id });
    console.log("Created demo companion:", companion.name);
  } else {
    console.log("Demo companion already exists:", companion.name);
  }

  const resolved = await Emergency.updateMany(
    { companionId: companion._id, status: "active" },
    { $set: { status: "resolved", resolvedAt: new Date() } }
  );
  if (resolved.modifiedCount) {
    console.log(`Resolved ${resolved.modifiedCount} active emergency alert(s) for clean SOS testing.`);
  }

  console.log("\nDemo login (mobile app):");
  console.log(`  email:    ${DEMO.caregiver.email}`);
  console.log(`  password: ${DEMO.caregiver.password}`);
  console.log("\nTest SOS:");
  console.log("  curl -X POST http://127.0.0.1:5000/api/emergency/trigger-demo");
  console.log("  python ../scripts/test_sos_local.py");

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
