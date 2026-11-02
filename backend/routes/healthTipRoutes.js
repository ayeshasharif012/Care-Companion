import express from "express";
import { protect } from "../middleware/authmiddleware.js"; // <-- Yahan {} lagayein
import {
  createHealthTip,
  getHealthTips,
  updateHealthTip,
  deleteHealthTip,
  getSuggestedHealthTips,
} from "../controllers/healthTipController.js";

const router = express.Router();

router.route("/")
  .post(protect, createHealthTip)
  .get(protect, getHealthTips);

router.get("/suggested/list", getSuggestedHealthTips);

router.route("/:id")
  .put(protect, updateHealthTip)
  .delete(protect, deleteHealthTip);

export default router;
