# 🏥 Care Companion App 🧓🎙️

**Final Year Project (FYP) – Department of Software Engineering** **Sir Syed University of Engineering & Technology (SSUET)**

Care Companion is a bilingual (**English + Urdu**) AI-powered wellness ecosystem. It bridges the gap between elderly care and technology by combining a **caregiver mobile app** with an **AI Voice Assistant** and **IoT device** to deliver emotion-aware support, smart reminders, and emergency safety nets.

---

## 📑 Table of Contents
- [Project Overview](#project-overview)
- [System Architecture](#system-architecture)
- [Core Features](#core-features)
- [Technology Stack](#technology-stack)
- [Repository Structure](#repository-structure)
- [Getting Started](#getting-started)
- [Team Members](#team-members)

---

## 🌟 Project Overview
Care Companion is designed for elderly or isolated users who need hands-free assistance. Unlike standard reminder apps, it uses **Artificial Intelligence** to understand voice commands in Urdu/English and detects the user's emotional state to provide empathetic feedback.



---

## 🛠️ System Components

### 1. 📱 Caregiver Mobile App (React Native / Expo)
* **Smart Scheduling:** Create medication, hydration, and activity reminders.
* **Mood Analytics:** Monitor the patient’s emotional trends over time.
* **Bilingual UI:** Full support for English and Urdu languages.

### 2. 🧠 AI Voice Service (Node.js + OpenAI)
* **STT (Speech-to-Text):** Powered by **Whisper-1** optimized for Urdu script (Nastaliq).
* **Motivation Engine:** Uses **GPT-4o-mini** to generate emotion-aware, compassionate responses.
* **TTS (Text-to-Speech):** High-quality audio responses using OpenAI's **Nova** voice.

### 3. 📟 IoT Controller (Python Engine)
* Runs on **Raspberry Pi** to provide a hands-free experience.
* Real-time synchronization with MongoDB for announcement triggers.
* Local audio management for seamless playback.

---

## 🚀 Core Features
* **Bilingual Voice Interaction:** Natural conversation in Urdu and English.
* **Emotion-Aware Feedback:** Adjusts its tone based on whether the user is happy, sad, or neutral.
* **Smart Reminders:** Automated voice announcements that sync across all devices.
* **Emergency SOS:** Quick caregiver alerts for urgent situations.
* **Offline Resilience:** Designed to handle local tasks even with intermittent connectivity.

---

## 💻 Technology Stack

| Layer | Technology |
| :--- | :--- |
| **Frontend** | React Native (TypeScript), Expo |
| **Backend** | Node.js, Express.js |
| **Database** | MongoDB (Atlas) |
| **AI Models** | OpenAI Whisper (STT), GPT-4o-mini (LLM), OpenAI TTS-1 |
| **IoT/Hardware** | Raspberry Pi 4, Python 3.x, Pygame Audio |

---

## 📂 Repository Structure

```txt
care-companion/
├── 📂 backend/                # Main Node.js API (Auth, Reminders, Logic)
│   ├── config/              # Database & Email configs
│   ├── controllers/         # Logic for Reminders, Emotions, Moods
│   ├── models/              # MongoDB Schemas
│   └── routes/              # API Endpoints
├── 📂 frontend/               # React Native (Expo) Mobile Application
│   ├── app/                 # Expo Router (Tabs & Auth screens)
│   ├── src/                 # API services, Utils, Translations
│   └── assets/              # UI Assets (Images/Fonts)
├── 📂 ai-voice-service/       # Independent AI Engine (STT -> GPT -> TTS)
│   ├── services/            # Whisper, Motivation, and TTS modules
│   └── audio/               # Local cache for voice inputs/outputs
└── 📂 iot-controller/         # Python scripts for Raspberry Pi
    ├── main.py              # Main loop for reminder announcements
    └── speech_engine.py     # Local audio playback logic

```

---

## ⚙️ Getting Started

### 1. Prerequisites

* Node.js LTS & npm
* Expo CLI (`npm install -g expo-cli`)
* MongoDB Atlas Account
* OpenAI API Key

### 2. Installation

Clone the repo and install dependencies for each module:

```bash
# Backend
cd backend && npm install

# Frontend
cd frontend && npm install

# AI Voice Service
cd ai-voice-service && npm install

```

### 3. Environment Variables

Create a `.env` file in the `backend`, `frontend`, and `ai-voice-service` folders.

```text
OPENAI_API_KEY=your_key_here
MONGO_URI=your_mongodb_uri
PORT=5000

```

---

## 👥 Team Members

| Name | Roll No. | Email |
| --- | --- | --- |
| **Izhan Rehan** | 2022F-BSE-363 | [SE22F-363@ssuet.edu.pk](mailto:SE22F-363@ssuet.edu.pk) |
| **Tineshia D’souza** | 2022F-BSE-265 | [SE22F-265@ssuet.edu.pk](mailto:SE22F-265@ssuet.edu.pk) |
| **Sunena** | 2022F-BSE-044 | [SE22F-044@ssuet.edu.pk](mailto:SE22F-044@ssuet.edu.pk) |
| **Ayesha Sharif** | 2022F-BSE-026 | [SE22F-026@ssuet.edu.pk](mailto:SE22F-026@ssuet.edu.pk) |

---

## 📜 License

Developed as a **Final Year Project (SSUET)**. All rights reserved by the project team for academic purposes.
