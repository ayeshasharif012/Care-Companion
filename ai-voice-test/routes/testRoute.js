const express = require('express');
const router = express.Router();
const path = require('path');

// ✅ Destructuring imports
const { convertAudioToText } = require('../services/sttService');
const { generateMotivationalMessage } = require('../services/motivationService');
const { convertTextToSpeech } = require('../services/ttsService');

router.post('/test-voice', async (req, res) => {
  try {
    const emotion = req.body.emotion || 'neutral';
    const audioInputPath = req.body.audioInputPath || './audio/input.wav';
    const audioOutputPath = req.body.audioOutputPath || './audio/output.mp3';
    const testText = req.body.testText;

    console.log(`\n--- New Request: ${emotion} ---`);

    let detectedText;

    // Step 1: Speech to Text (Whisper)
    if (testText) {
      console.log('[1/3] Using test text...');
      detectedText = testText;
    } else {
      console.log('[1/3] Converting audio to text (Whisper)...');
      detectedText = await convertAudioToText(audioInputPath);
    }

    // Step 2: AI Motivation (GPT-4o-mini)
    console.log('[2/3] Generating motivation...');
    const motivationalMessage = await generateMotivationalMessage(detectedText, emotion);

    // Step 3: Text to Speech (TTS-1)
    console.log('[3/3] Creating audio response...');
    const outputPath = await convertTextToSpeech(motivationalMessage, audioOutputPath);

    console.log('✅ Process Completed Successfully!\n');

    res.json({
      success: true,
      detectedText,
      emotion,
      motivationalMessage,
      audioUrl: `http://localhost:5000/audio/output.mp3?t=${Date.now()}` // Cache busting
    });

  } catch (error) {
    console.error('❌ Final Route Error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;