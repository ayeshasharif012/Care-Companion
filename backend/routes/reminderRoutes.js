import express from "express";
import {
  getReminders,
  addReminder,
  updateReminder,
  deleteReminder,
  getReminderHistory,
  markReminderCompleted,
} from "../controllers/reminderController.js";

// ✅ Import sahi hai
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

// GET user reminders
// ✅ 'auth' ki jagah 'protect' use karein
router.get("/", protect, getReminders);

// GET reminder history
router.get("/history", protect, getReminderHistory);

// POST new reminder
router.post("/", protect, addReminder);

// UPDATE reminder
router.put("/:id", protect, updateReminder);

// DELETE reminder
router.delete("/:id", protect, deleteReminder);

// 🟢 IoT Controller endpoint: Mark reminder as completed (NO AUTH)
router.post("/mark-completed", markReminderCompleted);

export default router;