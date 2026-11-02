import "dotenv/config";
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import fileUpload from 'express-fileupload';

import userRoutes from "./routes/userRoutes.js";
import reminderRoutes from "./routes/reminderRoutes.js";
import emotionRoutes from "./routes/emotionRoutes.js";
import moodRoutes from "./routes/moodRoutes.js";
import emergencyRoutes from "./routes/emergencyRoutes.js";
import companionRoutes from "./routes/companionRoutes.js";
import healthTipRoutes from "./routes/healthTipRoutes.js"; 
import statsRoutes from "./routes/statsRoutes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(fileUpload());

// Static Files
app.use("/audio", express.static(path.join(__dirname, "public/audio")));

const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST", "PUT", "DELETE"] },
});

app.set("io", io);

// Existing Routes
app.use("/api/users", userRoutes);
app.use("/api/reminders", reminderRoutes);
app.use("/api/emotion", emotionRoutes);
app.use("/api/mood", moodRoutes);
app.use("/api/emergency", emergencyRoutes);
app.use("/api/companion", companionRoutes);
app.use("/api/health-tips", healthTipRoutes);
app.use("/api/stats", statsRoutes);

io.on("connection", (socket) => {
    console.log("📱 Socket connected:", socket.id);
    socket.on("emergency_monitor_active", () => {
        socket.join("caregiver_monitor");
    });
    socket.on("stats_monitor_active", () => {
        socket.join("caregiver_monitor");
    });
    socket.on("disconnect", () => {
        console.log("📱 Socket disconnected:", socket.id);
    });
});

app.get("/", (req, res) => res.send("Care-Companion API is running ✅"));

app.get("/api/health", (req, res) => {
    res.json({
        ok: true,
        db: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
        time: new Date().toISOString(),
    });
});

function getLanIp() {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name] || []) {
            if (net.family === "IPv4" && !net.internal) return net.address;
        }
    }
    return null;
}

const PORT = process.env.PORT || 5000;

mongoose.connect(process.env.MONGO_URI, { dbName: "care-companion" })
    .then(async () => {
        console.log("DB Connected ✅");
        try {
            const { ensureHealthTipTemplatesSeeded } = await import("./services/healthTipTemplates.js");
            await ensureHealthTipTemplatesSeeded();
        } catch (seedErr) {
            console.warn("⚠️ Health tip template seed skipped:", seedErr.message);
        }
        httpServer.listen(PORT, "0.0.0.0", () => {
            const lan = getLanIp();
            console.log(`Server running on http://127.0.0.1:${PORT}`);
            if (lan) console.log(`LAN access: http://${lan}:${PORT} (Pi + phone use this IP)`);
            console.log(`SOS endpoint: POST http://127.0.0.1:${PORT}/api/emergency/trigger-demo`);
        });
    })
    .catch((err) => {
        console.error("DB connection error ❌:", err.message);
        console.error("👉 Fix backend/.env MONGO_URI:");
        console.error("   • MongoDB Atlas connection string, OR");
        console.error("   • Start local MongoDB on mongodb://127.0.0.1:27017");
        process.exit(1);
    });