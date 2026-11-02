const openai = require('../config/openai');

async function generateMotivationalMessage(detectedText, emotion) {
  try {
    const emotionPrompts = {
      happy: 'The person is happy. Acknowledge their joy.',
      sad: 'The person is sad. Offer compassionate support.',
      neutral: 'The person is neutral. Provide an uplifting message.',
      angry: 'The person is angry. Acknowledge with calm reassurance.',
    };

    const emotionContext = emotionPrompts[emotion] || emotionPrompts.neutral;

    const prompt = `You are a supportive coach for elderly users. ${emotionContext}
      User said: "${detectedText}"
      Respond strictly in the SAME LANGUAGE as the user (Urdu or English).
      Keep it warm, 2 sentences max.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a warm, bilingual coach.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 150,
      temperature: 0.7,
    });

    return response.choices[0].message.content.trim();
  } catch (error) {
    console.error('Error in motivation service:', error.message);
    throw new Error(`Failed to generate: ${error.message}`);
  }
}

// ✅ MUST BE EXPORTED LIKE THIS
module.exports = { generateMotivationalMessage };