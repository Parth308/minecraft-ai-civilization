const logger = require('../../shared/logger');

async function queryGroq(apiKey, prompt) {
  if (!apiKey) throw new Error('GROQ_API_KEY is not configured');

  const model = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
  logger.info('GroqProvider', `Querying Groq API with model: ${model}...`);
  const t0 = Date.now();

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: model,
      messages: [{ role: 'user', content: prompt }]
    }),
    signal: AbortSignal.timeout(8000)
  });

  const latencyMs = Date.now() - t0;

  if (response.status === 429) {
    const errText = await response.text().catch(() => '');
    const error = new Error(`Groq API Rate Limit Exceeded (429) | ${errText}`);
    error.status = 429;
    throw error;
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Groq API Error HTTP ${response.status}: ${response.statusText} | ${errText}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('Invalid response structure from Groq API');

  return {
    text,
    model: data.model || model,
    latencyMs,
    usage: {
      inputTokens: data.usage?.prompt_tokens ?? null,
      outputTokens: data.usage?.completion_tokens ?? null
    }
  };
}

module.exports = queryGroq;
