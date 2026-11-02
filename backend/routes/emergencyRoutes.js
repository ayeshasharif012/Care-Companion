import express from "express";
const router = express.Router();

import {
  getEmergencies,
  resolveEmergency,
  deleteEmergency,
  triggerDemoAlert,
} from "../controllers/emergencyController.js";

import { protect } from "../middleware/authmiddleware.js";

router.get("/", protect, getEmergencies);
router.post("/trigger-demo", triggerDemoAlert);
router.put("/:id/resolve", protect, resolveEmergency);
router.delete("/:id", protect, deleteEmergency);

export default router;