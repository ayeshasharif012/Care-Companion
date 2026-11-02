import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Lazy client — do NOT crash the whole server if OPENAI_API_KEY is missing at import time
let _client = null;
function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is missing. Add it to backend/.env and restart the server."
    );
  }
  if (!_client) {
    _client = new OpenAI({ apiKey });
  }
  return _client;
}

// Calm ChatGPT-like voice for all languages (OpenAI TTS)
const LANGUAGE_VOICES = {
  urdu: "nova",
  ur: "nova",
  english: "nova",
  en: "nova",
};

const TTS_SPEED = Number(process.env.OPENAI_TTS_SPEED || 0.92);

/**
 * Generate audio using OpenAI's TTS API
 * @param {string} text - The text to convert to speech
 * @param {string} language - Language code (urdu/ur or english/en)
 * @param {string} outputPath - Full path where the audio file should be saved
 * @returns {Promise<boolean>} - True if successful
 */
export const generateAudioWithOpenAI = async (text, language, outputPath) => {
  try {
    const client = getOpenAIClient();
    const normalizedLang = String(language).toLowerCase().trim();
    const voice = LANGUAGE_VOICES[normalizedLang] || "nova";

    console.log(`\n🎤 ========== AUDIO GENERATION START ==========`);
    console.log(`📝 Text: ${text.substring(0, 80)}...`);
    console.log(`🌐 Language received: "${language}" (normalized: "${normalizedLang}")`);
    console.log(`🎙️  Voice selected: "${voice}" (calm ChatGPT-like)`);
    console.log(`📁 Output path: ${outputPath}`);
    console.log(`🎤 ==========================================\n`);

    const response = await client.audio.speech.create({
      model: "tts-1",
      voice: voice,
      input: text,
      speed: TTS_SPEED,
    });

    console.log(`✅ OpenAI API response received, creating file...`);

    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Save the audio file
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(outputPath, buffer);

    // Verify file was created
    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1000) {
      const fileSize = fs.statSync(outputPath).size;
      console.log(`✅ Audio generated successfully!`);
      console.log(`   File: ${outputPath}`);
      console.log(`   Size: ${fileSize} bytes`);
      console.log(`   Language: ${normalizedLang}`);
      console.log(`   Voice: ${voice}\n`);
      return true;
    } else {
      throw new Error("Audio file is too small or empty");
    }
  } catch (error) {
    console.error(`\n❌ OpenAI TTS Error:`);
    console.error(`   Message: ${error.message}`);
    console.error(`   Language: ${language}`);
    console.error(`   Output: ${outputPath}\n`);
    throw error;
  }
};

export default { generateAudioWithOpenAI };
