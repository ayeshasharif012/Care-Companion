import User from "../models/userModel.js";
import jwt from "jsonwebtoken";
import { transporter } from "../config/email.js";

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "1d" });
};

// ---------------- REGISTER ----------------
export const registerUser = async (req, res) => {
  try {
    let { name, email, password, mobile } = req.body;

    if (!name || !email || !password || !mobile) {
      return res.status(400).json({ message: "All fields are required" });
    }

    email = email.toLowerCase().trim();

    const existingUser = await User.findOne({
      $or: [{ email }, { mobile }],
    });

    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    const user = await User.create({
      name,
      email,
      password,
      mobile,
      role: "caregiver",
    });

    res.status(201).json({
      token: generateToken(user._id),
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        mobile: user.mobile,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ---------------- LOGIN ----------------
export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({
      email: email?.toLowerCase().trim(),
    });

    if (!user) return res.status(404).json({ message: "User not found" });

    const isMatch = await user.matchPassword(password);
    if (!isMatch)
      return res.status(401).json({ message: "Invalid credentials" });

    // ✅ OPTIMIZATION: Only update active users (not ALL users in database)
    await User.updateMany({ isActiveCaregiver: true }, { $set: { isActiveCaregiver: false } });
    user.isActiveCaregiver = true;
    await user.save();

    res.json({
      token: generateToken(user._id),
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        mobile: user.mobile,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ---------------- LOGOUT ----------------
export const logoutUser = async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user._id, {
      isActiveCaregiver: false,
    });

    res.json({ message: "Logout successful" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ---------------- FORGOT PASSWORD ----------------
export const requestPasswordReset = async (req, res) => {
  try {
    const { email } = req.body;
    const normalizedEmail = email?.toLowerCase().trim();

    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      return res.status(404).json({ message: "No account found with this email" });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    try {
      await transporter.sendMail({
        from: `"Care Companion" <${process.env.EMAIL_USER}>`,
        to: user.email,
        subject: `[Care Companion] OTP: ${otp}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 500px; margin: auto; border: 1px solid #eee; border-radius: 10px; padding: 20px;">
            <h2 style="color: #1B1464; text-align: center;">Care Companion</h2>
            <p>Hi <strong>${user.name}</strong>,</p>
            <p>Use the following OTP to reset your password. This code is valid for 10 minutes.</p>
            <div style="background: #f4f4f7; padding: 15px; text-align: center; border-radius: 8px; margin: 20px 0;">
              <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #1B1464;">${otp}</span>
            </div>
            <p style="font-size: 12px; color: #888; text-align: center;">If you didn't request this, please ignore this email.</p>
          </div>
        `,
      });

      user.resetOTP = otp;
      user.resetOTPExpire = Date.now() + 10 * 60 * 1000;

      await user.save({ validateBeforeSave: false });

      res.json({ message: "Verification code sent to your email" });
    } catch (mailError) {
      console.error("Transporter Error:", mailError);
      return res.status(500).json({ message: "Email service temporarily unavailable" });
    }
  } catch (error) {
    res.status(500).json({ message: "An error occurred while processing request" });
  }
};

// ---------------- VERIFY OTP ----------------
export const verifyOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;

    const user = await User.findOne({
      email: email?.toLowerCase().trim(),
      resetOTP: otp,
      resetOTPExpire: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ message: "Invalid or expired verification code" });
    }

    res.json({ message: "Verification successful", success: true });
  } catch (error) {
    res.status(500).json({ message: "Verification process failed" });
  }
};

// ---------------- RESET PASSWORD ----------------
export const resetPassword = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({
      email: email?.toLowerCase().trim(),
    });

    if (!user) {
      return res.status(400).json({ message: "Reset failed: User not found" });
    }

    user.password = password;
    user.resetOTP = undefined;
    user.resetOTPExpire = undefined;

    await user.save();

    res.json({ message: "Your password has been reset successfully" });
  } catch (error) {
    res.status(500).json({ message: "Internal server error during reset" });
  }
};

// ---------------- GET PROFILE ----------------
export const getUserProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select(
      "-password -resetOTP -resetOTPExpire"
    );

    if (!user) {
      return res.status(404).json({ message: "Profile not found" });
    }

    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ---------------- PUSH TOKEN ----------------
export const updatePushToken = async (req, res) => {
  try {
    const { pushToken } = req.body;

    if (!pushToken) {
      return res.status(400).json({ message: "Push token is required" });
    }

    await User.findByIdAndUpdate(req.user._id, { pushToken }, { new: true });

    res.json({ message: "Notification token synchronized" });
  } catch (error) {
    res.status(500).json({ message: "Failed to update notification settings" });
  }
};