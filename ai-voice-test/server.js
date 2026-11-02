const express = require('express');
const path = require('path');
require('dotenv').config();

const testRoute = require('./routes/testRoute');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Route for static audio files
app.use('/audio', express.static(path.join(__dirname, 'audio')));

// API Routes
app.use('/api', testRoute);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'AI Voice Motivation System Backend',
    version: '1.0.0',
    endpoints: {
      health: 'GET /api/health',
      testVoice: 'POST /api/test-voice',
    },
    description: 'Test the voice motivation system with POST /api/test-voice',
    bodyExample: {
      emotion: 'neutral',
      testText: 'I am feeling tired today',
      audioInputPath: './audio/input.wav',
      audioOutputPath: './audio/output.mp3',
    },
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    availableEndpoints: {
      health: 'GET /api/health',
      testVoice: 'POST /api/test-voice',
    },
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message,
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`\n========== AI Voice Motivation Backend ==========`);
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
  console.log(`Test endpoint: POST http://localhost:${PORT}/api/test-voice`);
  console.log(`================================================\n`);
});
