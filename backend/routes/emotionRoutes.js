import express from "express";
import {
  detectEmotion,
  saveEmotion,
  getLatestEmotion,
  getEmotionHistory,
  getEmotionStory,
} from "../controllers/emotionController.js";

const router = express.Router();

router.post("/detect", detectEmotion);
router.post("/save", saveEmotion);
router.get("/history/:userId", getEmotionHistory);
router.get("/latest/:userId", getLatestEmotion);
router.post("/story", getEmotionStory);
router.get("/story/:userId", getEmotionStory);

export default router;
