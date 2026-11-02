import express from "express";
import { getMood } from "../controllers/moodController.js";

const router = express.Router();

router.get("/:userId", getMood);

export default router;
