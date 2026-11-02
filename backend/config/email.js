import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

// Transporter Configuration
export const transporter = nodemailer.createTransport({
  service: "gmail",
  host: "smtp.gmail.com",
  port: 465, // Secure port for Gmail
  secure: true, // Use SSL
  pool: true, // Use pooled connections for better performance
  auth: {
    user: process.env.EMAIL_USER, // e.g., izhanroohanrehan@gmail.com
    pass: process.env.EMAIL_PASS, // Your 16-digit Google App Password
  },
});

// Connection Test Function
export const verifyEmailConnection = async () => {
  const user = process.env.EMAIL_USER?.trim();
  const pass = process.env.EMAIL_PASS?.trim();
  const disabled =
    process.env.DISABLE_EMAIL?.toLowerCase() === "1" ||
    process.env.DISABLE_EMAIL?.toLowerCase() === "true" ||
    !user ||
    !pass ||
    user.includes("your-gmail") ||
    pass.includes("your-google");

  if (disabled) {
    console.log("ℹ️ Email service skipped (DISABLE_EMAIL or placeholder credentials)");
    return;
  }

  try {
    await transporter.verify();
    console.log("✅ Email Service (Nodemailer) is ready to send emails");
  } catch (error) {
    console.error("❌ Email Service Error:");
    console.error(`- Message: ${error.message}`);
    console.error(`- Code: ${error.code}`);

    if (error.code === "EAUTH") {
      console.error(
        "👉 Fix EMAIL_USER / EMAIL_PASS in .env, or set DISABLE_EMAIL=1 for local demo."
      );
    }
  }
};

// Auto-run verification on start
verifyEmailConnection();