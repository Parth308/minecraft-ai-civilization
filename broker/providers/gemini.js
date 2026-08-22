const logger = require('../../shared/logger');

async function queryGemini(apiKey, prompt) {
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');

  logger.info('GeminiProvider', 'Querying Gemini Flash API...');
  const t0 = Date.now();

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }]
    })
  });

  const latencyMs = Date.now() - t0;

  if (response.status === 429) {
    const error = new Error('Gemini API Rate Limit Exceeded (429)');
    error.status = 429;
    throw error;
  }

  if (!response.ok) {
    throw new Error(`Gemini API Error: ${response.statusText} (${response.status})`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Invalid response structure from Gemini API');

  return {
    text,
    model: data.modelVersion || 'gemini-2.5-flash',
    latencyMs,
    usage: {
      inputTokens: data.usageMetadata?.promptTokenCount ?? null,
      outputTokens: data.usageMetadata?.candidatesTokenCount ?? null
    }
  };
}

module.exports = queryGemini;
