const fs = require('fs');
const openai = require('../config/openai');

/**
 * Convert audio file to text using OpenAI Whisper API
 * Optimized for Urdu Script (Nastaliq)
 */
async function convertAudioToText(audioFilePath) {
  try {
    if (!fs.existsSync(audioFilePath)) {
      throw new Error(`Audio file not found: ${audioFilePath}`);
    }

    const audioFile = fs.createReadStream(audioFilePath);

    // Whisper API call with strict Urdu instructions
    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
      language: 'ur', // Explicitly setting Urdu
      prompt: 'یہ ایک اردو گفتگو ہے۔ براہ کرم اسے صرف اردو رسم الخط میں لکھیں، ہندی میں نہیں۔', // Stronger instruction to avoid Hindi script
      response_format: 'json',
      temperature: 0, // Lower temperature means more accurate transcription
    });

    console.log('[STT] Final Urdu Text:', transcription.text);
    return transcription.text;
  } catch (error) {
    console.error('Error in STT service:', error.message);
    throw new Error(`Failed to convert audio to text: ${error.message}`);
  }
}

module.exports = { convertAudioToText };