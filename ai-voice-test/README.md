# AI Voice Motivation System Backend

A simple Node.js Express backend for an AI voice motivation system using the OpenAI API. The system processes audio input, generates supportive motivational messages, and outputs audio responses.

## Features

- **Speech-to-Text (STT)**: Convert audio files to text using Whisper API
- **Emotion Detection**: Accept emotion input to personalize motivational messages
- **Text Generation**: Generate warm, supportive motivational messages using GPT-4o-mini
- **Text-to-Speech (TTS)**: Convert motivational messages back to audio using the Speech API
- **REST API**: Easy-to-use POST endpoint for testing

## Project Structure

```
ai-voice-test/
├── config/
│   └── openai.js          # OpenAI client configuration
├── services/
│   ├── sttService.js      # Speech-to-Text service
│   ├── motivationService.js # Motivation message generation
│   └── ttsService.js      # Text-to-Speech service
├── routes/
│   └── testRoute.js       # API endpoints
├── audio/
│   └── input.wav          # Test audio input (add your own)
├── .env                   # Environment variables
├── package.json           # Dependencies
└── server.js              # Main server file
```

## Installation

1. **Clone or download the project**

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   - Copy `.env` file and add your OpenAI API key:
   ```
   OPENAI_API_KEY=your_openai_api_key_here
   PORT=3000
   NODE_ENV=development
   AUDIO_INPUT_PATH=./audio/input.wav
   AUDIO_OUTPUT_PATH=./audio/output.mp3
   ```

4. **Add test audio file**
   - Place an audio file named `input.wav` in the `audio/` folder
   - Supported formats: MP3, WAV, M4A, FLAC, etc.

## Usage

### Start the Server

**Development mode (with auto-reload):**
```bash
npm run dev
```

**Production mode:**
```bash
npm start
```

The server will start on `http://localhost:3000`

### Test Endpoints

#### 1. Health Check
```
GET http://localhost:3000/api/health
```

**Response:**
```json
{
  "status": "OK",
  "message": "Voice Motivation Backend is running"
}
```

#### 2. Test Voice Motivation (Main Endpoint)
```
POST http://localhost:3000/api/test-voice
```

**Request Body:**
```json
{
  "emotion": "neutral",
  "testText": "I am feeling tired today"
}
```

**Supported emotions:**
- `happy` - For joyful users
- `sad` - For users needing compassionate support
- `neutral` - Default, general motivation
- `angry` - For users needing calm reassurance

**Optional parameters:**
```json
{
  "emotion": "neutral",
  "testText": "I am feeling tired today",
  "audioInputPath": "./audio/input.wav",
  "audioOutputPath": "./audio/output.mp3"
}
```

**Note:** Use `testText` to skip speech-to-text and test the motivation generation directly.

**Response:**
```json
{
  "success": true,
  "detectedText": "I'm feeling tired and unmotivated today",
  "emotion": "sad",
  "motivationalMessage": "It's wonderful that you're reaching out today. Remember, even small steps forward are progress. You have more strength within you than you know.",
  "audioOutputPath": "/full/path/to/audio/output.mp3",
  "message": "Voice motivation test completed successfully"
}
```

### Testing with cURL

```bash
# Test with default emotion (neutral) - requires audio file
curl -X POST http://localhost:3000/api/test-voice \
  -H "Content-Type: application/json" \
  -d '{"emotion": "neutral"}'

# Test with specific emotion - requires audio file
curl -X POST http://localhost:3000/api/test-voice \
  -H "Content-Type: application/json" \
  -d '{"emotion": "sad"}'

# Test with text input (skips STT, faster testing)
curl -X POST http://localhost:3000/api/test-voice \
  -H "Content-Type: application/json" \
  -d '{"emotion": "sad", "testText": "I am feeling very tired and unmotivated today"}'
```

### Testing with Postman

1. Create a new POST request
2. URL: `http://localhost:3000/api/test-voice`
3. Body (raw JSON):
   ```json
   {
     "emotion": "neutral",
     "testText": "I am feeling tired today"
   }
   ```
4. Click Send

**Note:** The `testText` parameter allows you to skip the speech-to-text step and test the motivation generation directly.

## System Flow

```
1. Audio Input (input.wav)
         ↓
2. Speech-to-Text (Whisper)
         ↓
3. Emotion Input (from request)
         ↓
4. Generate Motivational Message (GPT-4o-mini)
         ↓
5. Text-to-Speech (Voice API)
         ↓
6. Audio Output (output.mp3)
```

## API Response Details

### Success Response (200)
```json
{
  "success": true,
  "detectedText": "User's spoken text",
  "emotion": "emotion_type",
  "motivationalMessage": "Generated supportive message",
  "audioOutputPath": "/path/to/output.mp3",
  "message": "Description of completion"
}
```

### Error Response (4xx/5xx)
```json
{
  "success": false,
  "error": "Error message",
  "message": "Description of what went wrong"
}
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENAI_API_KEY` | Your OpenAI API key | Required |
| `PORT` | Server port | 3000 |
| `NODE_ENV` | Environment (development/production) | development |
| `AUDIO_INPUT_PATH` | Default input audio path | ./audio/input.wav |
| `AUDIO_OUTPUT_PATH` | Default output audio path | ./audio/output.mp3 |

### OpenAI API Models Used

- **STT**: `whisper-1` - Accurate speech recognition
- **LLM**: `gpt-4o-mini` - Fast and efficient text generation
- **TTS**: `tts-1` - Natural speech generation with `nova` voice

## Features for Elderly Users

The system is specifically designed for elderly users:

- **Simple Language**: Messages use clear, straightforward language
- **Warm Tone**: The `nova` voice is warm and natural
- **Supportive Messages**: All prompts encourage compassion and positivity
- **Emotion-Aware**: Responses adapt to emotional context
- **Short Responses**: Motivational messages are concise (2-3 sentences)

## Troubleshooting

### "Audio file not found"
- Ensure `input.wav` exists in the `audio/` folder
- Check the file path in `.env` or request body

### "Invalid API key"
- Verify your OpenAI API key in `.env`
- Ensure no extra spaces or quotes

### "ENOENT: no such file or directory"
- Make sure all directories are created
- Check file paths are correct

### "401 Unauthorized"
- API key is invalid or expired
- Check OpenAI billing and API key status

### Server won't start
- Check if port 3000 is already in use
- Change PORT in `.env` if needed

## Requirements

- Node.js v14 or higher
- npm or yarn
- OpenAI API key (get one at https://platform.openai.com/api-keys)
- Test audio file (MP3, WAV, M4A, FLAC, etc.)

## Dependencies

- **express**: Web framework
- **dotenv**: Environment variable management
- **openai**: OpenAI API client
- **multer**: File upload handling
- **axios**: HTTP client

## License

MIT

## Support

For issues with OpenAI API:
- Visit: https://platform.openai.com/docs
- Check rate limits and usage: https://platform.openai.com/account/usage/overview

For Express.js help:
- Visit: https://expressjs.com

## Next Steps

1. Add your OpenAI API key to `.env`
2. Place a test audio file in `audio/input.wav`
3. Run `npm install`
4. Start with `npm run dev`
5. Test the endpoint with cURL or Postman
