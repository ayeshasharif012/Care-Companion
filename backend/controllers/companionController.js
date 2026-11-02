import Companion from "../models/companionModel.js";
import Reminder from "../models/reminderModel.js";
import { syncCompanionWithIoT } from "../services/iotSync.js";
import { emitRealtime } from "../utils/realtime.js";

function normalizeCompanionLanguage(raw) {
  const v = String(raw || "english").toLowerCase().trim();
  if (v.includes("urdu") || v === "ur") return "urdu";
  return "english";
}

// Create or Update companion profile
export const createCompanion = async (req, res) => {
  try {
    const { name, age, gender, contactNumber, language, medicalNotes } = req.body;

    if (!name || !language) {
      return res.status(400).json({ message: "Name and language are required" });
    }

    const normalizedLanguage = normalizeCompanionLanguage(language);
    const existingCompanion = await Companion.findOne({ user: req.user._id });

    if (existingCompanion) {
      existingCompanion.name = name;
      existingCompanion.age = age;
      existingCompanion.gender = gender;
      existingCompanion.contactNumber = contactNumber;
      existingCompanion.language = normalizedLanguage;
      existingCompanion.medicalNotes = medicalNotes;

      const updatedCompanion = await existingCompanion.save();
      syncCompanionWithIoT(req.user._id).catch(() => {});
      return res.status(201).json(updatedCompanion);
    }

    const newCompanion = await Companion.create({
      name,
      age,
      gender,
      contactNumber,
      language: normalizedLanguage,
      medicalNotes,
      user: req.user._id,
    });

    syncCompanionWithIoT(req.user._id).catch(() => {});
    res.status(201).json(newCompanion);
  } catch (error) {
    console.error("Create Companion Error:", error);
    res.status(500).json({ message: error.message });
  }
};

export const getCompanions = async (req, res) => {
  try {
    const caregiverId = req.query.caregiverId || req.user._id;
    const companions = await Companion.find({ user: caregiverId });

    if (!companions || companions.length === 0) {
      return res.status(404).json({ message: "Companion profile not found" });
    }
    res.status(200).json(companions);
  } catch (error) {
    console.error("Get Companions Error:", error);
    res.status(500).json({ message: error.message });
  }
};

export const getMyCompanion = async (req, res) => {
  try {
    const companion = await Companion.findOne({ user: req.user._id });
    if (!companion) {
      return res.status(404).json({ message: "Companion profile not found" });
    }
    res.status(200).json(companion);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/** Update companion language — reminders, Pi voice, health tips follow this language. */
export const updateMyCompanionLanguage = async (req, res) => {
  try {
    const { language } = req.body || {};
    if (!language) {
      return res.status(400).json({ message: "language is required" });
    }

    const normalizedLanguage = normalizeCompanionLanguage(language);
    const companion = await Companion.findOne({ user: req.user._id });
    if (!companion) {
      return res.status(404).json({ message: "Companion profile not found" });
    }

    companion.language = normalizedLanguage;
    await companion.save();

    await Reminder.updateMany(
      { userId: req.user._id, status: "pending" },
      { $set: { language: normalizedLanguage } }
    );

    syncCompanionWithIoT(req.user._id).catch(() => {});
    emitRealtime(req.app, "companionLanguageUpdated", {
      userId: String(req.user._id),
      language: normalizedLanguage,
    });

    res.status(200).json({
      success: true,
      companion,
      language: normalizedLanguage,
      message: `Companion language set to ${normalizedLanguage}`,
    });
  } catch (error) {
    console.error("Update companion language:", error.message);
    res.status(500).json({ message: error.message });
  }
};

export const getCompanionById = async (req, res) => {
  try {
    const companion = await Companion.findById(req.params.id);
    if (!companion) return res.status(404).json({ message: "Companion not found" });
    res.status(200).json(companion);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const updateCompanion = async (req, res) => {
  try {
    const body = { ...req.body };
    if (body.language) body.language = normalizeCompanionLanguage(body.language);

    const updatedCompanion = await Companion.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      body,
      { new: true }
    );
    if (!updatedCompanion) {
      return res.status(404).json({ message: "Companion not found" });
    }

    if (body.language) {
      await Reminder.updateMany(
        { userId: req.user._id, status: "pending" },
        { $set: { language: body.language } }
      );
      syncCompanionWithIoT(req.user._id).catch(() => {});
    }

    res.status(200).json(updatedCompanion);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const deleteCompanion = async (req, res) => {
  try {
    const deleted = await Companion.findOneAndDelete({
      _id: req.params.id,
      user: req.user._id,
    });
    if (!deleted) return res.status(404).json({ message: "Companion not found" });
    res.status(200).json({ message: "Companion deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
