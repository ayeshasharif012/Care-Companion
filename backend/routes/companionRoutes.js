import express from "express";
import { protect } from "../middleware/authmiddleware.js";
import { 
  createCompanion, 
  getCompanions,
  getMyCompanion,
  updateMyCompanionLanguage,
  getCompanionById, 
  updateCompanion, 
  deleteCompanion 
} from "../controllers/companionController.js";

const router = express.Router();

router.route("/")
  .post(protect, createCompanion)
  .get(protect, getCompanions);

router.get("/me", protect, getMyCompanion);
router.patch("/me/language", protect, updateMyCompanionLanguage);

// 🛠️ Get, Update, Delete single companion by ID
router.route("/:id")
  .get(protect, getCompanionById)
  .put(protect, updateCompanion)
  .delete(protect, deleteCompanion);

export default router;