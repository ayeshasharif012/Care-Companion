import express from "express";
import {
  registerUser,
  loginUser,
  logoutUser,
  getUserProfile,
  updatePushToken,
  requestPasswordReset,
  verifyOTP,
  resetPassword,
} from "../controllers/userController.js";
import { protect } from "../middleware/authmiddleware.js";

const router = express.Router();

router.post("/register", registerUser);
router.post("/login", loginUser);
router.post("/logout", protect, logoutUser);

router.post("/forgot-password", requestPasswordReset);
router.post("/verify-otp", verifyOTP);
router.post("/reset-password", resetPassword);

router.get("/me", protect, getUserProfile);
router.post("/update-token", protect, updatePushToken);

export default router;