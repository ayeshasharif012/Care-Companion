import express from "express";
import { protect } from "../middleware/authmiddleware.js";
import { getWeeklyStats } from "../controllers/statsController.js";

const router = express.Router();

router.get("/weekly", protect, getWeeklyStats);

export default router;
