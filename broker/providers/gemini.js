const logger = require('../../shared/logger');

async function queryGemini(apiKey, prompt, options = {}) {
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  logger.info('GeminiProvider', `Querying Gemini API with model: ${model}...`);
  const t0 = Date.now();

  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }]
  };
  if (options.jsonMode) {
    requestBody.generationConfig = { ...(requestBody.generationConfig || {}), responseMimeType: 'application/json' };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(8000)
  });

  const latencyMs = Date.now() - t0;

  if (response.status === 429) {
    const errText = await response.text().catch(() => '');
    const error = new Error(`Gemini API Rate Limit Exceeded (429) | ${errText}`);
    error.status = 429;
    throw error;
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Gemini API Error HTTP ${response.status}: ${response.statusText} | ${errText}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Invalid response structure from Gemini API');

  return {
    text,
    model: data.modelVersion || model,
    latencyMs,
    usage: {
      inputTokens: data.usageMetadata?.promptTokenCount ?? null,
      outputTokens: data.usageMetadata?.candidatesTokenCount ?? null
    }
  };
}

module.exports = queryGemini;
