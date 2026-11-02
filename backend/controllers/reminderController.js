import Reminder from "../models/reminderModel.js";
import Companion from "../models/companionModel.js";
import axios from "axios";
import { IOT_CONTROLLER_URL, IOT_FALLBACK_URLS } from "../config/network.js";
import { emitRealtime } from "../utils/realtime.js";

const IOT_TIMEOUT_MS = Number(process.env.IOT_REQUEST_TIMEOUT_MS || 4000);

function normalizeLanguage(raw) {
  const v = String(raw || "english").toLowerCase().trim();
  if (v.includes("urdu") || v === "ur") return "urdu";
  return "english";
}

async function getCompanionLanguage(userId) {
  try {
    const companion = await Companion.findOne({ user: userId });
    return normalizeLanguage(companion?.language);
  } catch {
    return "english";
  }
}

const syncWithIoT = async (reminder, action = "add") => {
  const payload = {
    userId: reminder.userId.toString(),
    title: reminder.title,
    description: reminder.description || "",
    date:
      reminder.date instanceof Date
        ? reminder.date.toISOString()
        : String(reminder.date),
    status: reminder.status || "pending",
    language: normalizeLanguage(reminder.language),
    mongoId: reminder._id?.toString(),
  };

  const urls = IOT_FALLBACK_URLS.length ? IOT_FALLBACK_URLS : [IOT_CONTROLLER_URL];
  let lastErr = null;

  for (const base of urls) {
    try {
      if (action === "add") {
        await axios.post(`${base}/api/reminders`, payload, { timeout: IOT_TIMEOUT_MS });
      } else {
        await axios.post(
          `${base}/api/sync-reminders`,
          { userId: payload.userId },
          { timeout: IOT_TIMEOUT_MS }
        );
      }
      console.log(`✅ Synced reminder ${action} (${payload.language}) → ${base}`);
      return;
    } catch (error) {
      lastErr = error.message;
    }
  }
  console.error(
    `❌ Failed to sync reminder with IoT (tried ${urls.join(", ")}): ${lastErr}`
  );
};

export const getReminders = async (req, res) => {
  try {
    const reminders = await Reminder.find({ userId: req.user._id }).sort({ createdAt: -1 });
    res.json(reminders);
  } catch (err) {
    console.error("❌ Get Reminders Error:", err.message);
    res.status(500).json({ message: err.message });
  }
};

export const addReminder = async (req, res) => {
  try {
    const { title, description, date, language: bodyLang } = req.body;
    if (!title || !date) {
      return res.status(400).json({ message: "Title and Date are required" });
    }

    const language = bodyLang
      ? normalizeLanguage(bodyLang)
      : await getCompanionLanguage(req.user._id);

    const reminder = new Reminder({
      userId: req.user._id,
      title,
      description: description || "",
      date,
      language,
      status: "pending",
    });

    const saved = await reminder.save();
    console.log(`💾 Reminder saved (${language}): ${title}`);
    emitRealtime(req.app, "reminderUpdated", { action: "created", reminder: saved });
    res.status(201).json(saved);

    syncWithIoT(saved, "add").catch((err) =>
      console.error("⚠️ Background IoT sync failed:", err.message)
    );
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const updateReminder = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = { ...req.body };
    if (updates.language) updates.language = normalizeLanguage(updates.language);

    // If language not provided, keep companion language on update of title/date only
    if (!updates.language) {
      updates.language = await getCompanionLanguage(req.user._id);
    }

    const updated = await Reminder.findOneAndUpdate(
      { _id: id, userId: req.user._id },
      updates,
      { new: true, runValidators: true }
    );

    if (!updated) return res.status(404).json({ message: "Reminder not found" });

    emitRealtime(req.app, "reminderUpdated", { action: "updated", reminder: updated });
    res.json(updated);
    syncWithIoT(updated, "update").catch((err) =>
      console.error("⚠️ Background IoT sync failed:", err.message)
    );
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const deleteReminder = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await Reminder.findOneAndDelete({ _id: id, userId: req.user._id });

    if (!deleted) return res.status(404).json({ message: "Reminder not found" });

    res.json({ message: "Reminder deleted successfully" });
    syncWithIoT(deleted, "delete").catch((err) =>
      console.error("⚠️ Background IoT sync failed:", err.message)
    );
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const getReminderHistory = async (req, res) => {
  try {
    const history = await Reminder.find({
      userId: req.user._id,
      status: "completed",
    })
      .sort("-updatedAt")
      .limit(50);
    res.json(history);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const markReminderCompleted = async (req, res) => {
  try {
    const { reminderId } = req.body;
    const updated = await Reminder.findByIdAndUpdate(
      reminderId,
      { status: "completed", updatedAt: new Date() },
      { new: true }
    );

    if (!updated) return res.status(404).json({ message: "Reminder not found" });
    emitRealtime(req.app, "reminderUpdated", {
      action: "completed",
      reminder: updated,
    });
    res.json({ status: "success", reminder: updated });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
