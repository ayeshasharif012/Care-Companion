import twilio from "twilio";
import dotenv from "dotenv";

dotenv.config();

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

export const sendEmergencySMS = async (toNumber, message) => {
  if (!toNumber) throw new Error("Phone number required");

  const cleanNumber = toNumber.trim();

  await client.messages.create({
    body: message || "Emergency alert triggered!",
    from: process.env.TWILIO_PHONE_NUMBER,
    to: cleanNumber,
  });
};

export const makeEmergencyCall = async (toNumber, message) => {
  if (!toNumber) throw new Error("Phone number required");

  const cleanNumber = toNumber.trim();

  await client.calls.create({
    twiml: `<Response><Say voice="alice">${message}</Say></Response>`,
    from: process.env.TWILIO_PHONE_NUMBER,
    to: cleanNumber,
  });
};