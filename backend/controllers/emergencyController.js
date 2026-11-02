import Emergency from "../models/emergencyModel.js";
import Companion from "../models/companionModel.js";
import User from "../models/userModel.js";
import { sendPushNotification } from "../utils/sendNotification.js";

export const triggerDemoAlert = async (req, res) => {
  try {
    let caregiver;
    
    // 1. Auth user, else active caregiver, else any caregiver (for physical SOS button)
    if (req.user && req.user._id) {
      caregiver = await User.findById(req.user._id);
    } else {
      caregiver = await User.findOne({ isActiveCaregiver: true });
    }

    if (!caregiver) {
      caregiver = await User.findOne({ role: "caregiver" }).sort({ updatedAt: -1 });
    }

    if (!caregiver) {
      caregiver = await User.findOne().sort({ createdAt: 1 });
    }

    if (!caregiver) {
      console.error("❌ No caregiver/user found in database.");
      return res.status(404).json({ 
        message: "No caregiver found. Register/login at least one user first." 
      });
    }

    // Mark as active so subsequent alerts keep routing to the same caregiver
    if (!caregiver.isActiveCaregiver) {
      await User.updateMany({ isActiveCaregiver: true }, { $set: { isActiveCaregiver: false } });
      caregiver.isActiveCaregiver = true;
      await caregiver.save();
    }

    // 2. Find Companion linked to this caregiver
    const companion = await Companion.findOne({ user: caregiver._id });
    if (!companion) {
      return res.status(404).json({ message: "No Companion found for this caregiver!" });
    }

    // 3. Prevent Duplicate Active Alerts
    const activeAlertExists = await Emergency.findOne({
      companionId: companion._id,
      status: "active",
    });

    if (activeAlertExists) {
      return res.status(400).json({
        success: false,
        message: "Alert already active.",
      });
    }

    // 4. Create Emergency Log
    const emergency = await Emergency.create({
      companionId: companion._id,
      caregiverId: caregiver._id,
      message: `🚨 PHYSICAL BUTTON: ${companion.name} needs help!`,
      status: "active",
    });

    const fullAlert = await Emergency.findById(emergency._id).populate(
      "companionId",
      "name"
    );

    const io = req.app.get("io");
    if (io) {
      io.emit("newEmergency", fullAlert);
      console.log("✅ Socket event 'newEmergency' emitted");
    }

    res.status(201).json({
      success: true,
      alert: fullAlert,
    });

    // Push after response so Pi / test scripts never wait on Expo push delivery
    if (caregiver.pushToken) {
      sendPushNotification(
        caregiver.pushToken,
        "Emergency Alert",
        `${companion.name} needs help!`,
        { type: "emergency" }
      ).catch((err) =>
        console.error("Push notification failed (SOS still logged):", err.message)
      );
    }
  } catch (error) {
    console.error("❌ Error in triggerDemoAlert:", error.message);
    res.status(500).json({ message: error.message });
  }
};

export const getEmergencies = async (req, res) => {
  try {
    const emergencies = await Emergency.find({
      caregiverId: req.user._id,
    })
      .populate("companionId", "name")
      .sort({ status: 1, createdAt: -1 })
      .lean();

    res.status(200).json(emergencies || []);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch emergencies",
    });
  }
};

export const resolveEmergency = async (req, res) => {
  try {
    const { id } = req.params;

    const emergency = await Emergency.findOneAndUpdate(
      {
        _id: id.trim(),
        caregiverId: req.user._id,
      },
      {
        status: "resolved",
        resolvedAt: new Date(),
      },
      { new: true }
    ).populate("companionId", "name");

    if (!emergency) {
      return res.status(404).json({
        message: "Alert not found",
      });
    }

    const io = req.app.get("io");
    if (io) {
      io.emit("emergencyResolved", emergency);
    }

    res.json(emergency);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

export const deleteEmergency = async (req, res) => {
  try {
    const deletedItem = await Emergency.findOneAndDelete({
      _id: req.params.id.trim(),
      caregiverId: req.user._id,
    });

    if (!deletedItem) {
      return res.status(404).json({
        message: "Log not found",
      });
    }

    const io = req.app.get("io");
    if (io) {
      io.emit("emergencyDeleted", { id: req.params.id });
    }

    res.json({
      success: true,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};