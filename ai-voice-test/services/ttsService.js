const fs = require('fs');
const path = require('path');
const openai = require('../config/openai');

/**
 * Convert text to speech using OpenAI TTS API
 */
async function convertTextToSpeech(text, outputPath) {
  try {
    console.log('[TTS] Generating audio for:', text);

    const mp3 = await openai.audio.speech.create({
      model: 'tts-1',
      voice: 'nova', // You can use 'alloy', 'echo', 'fable', 'onyx', 'nova', or 'shimmer'
      input: text,
    });

    const buffer = Buffer.from(await mp3.arrayBuffer());
    
    // Ensure directory exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    await fs.promises.writeFile(outputPath, buffer);
    
    console.log(`[TTS] Audio saved to: ${outputPath}`);
    return outputPath;
  } catch (error) {
    console.error('Error in TTS service:', error.message);
    throw new Error(`Failed to convert text to speech: ${error.message}`);
  }
}

// ✅ Correct Export
module.exports = { convertTextToSpeech };