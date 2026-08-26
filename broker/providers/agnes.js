const logger = require('../../shared/logger');

async function queryAgnes(apiKey, prompt) {
  if (!apiKey) throw new Error('AGNES_API_KEY is not configured');

  const model = process.env.AGNES_MODEL || 'deepseek-v3';
  logger.info('AgnesProvider', `Querying Agnes AI API with model: ${model}...`);
  const t0 = Date.now();

  const response = await fetch('https://apihub.agnes-ai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.6,
      max_tokens: 1024
    }),
    signal: AbortSignal.timeout(6000)
  });

  const latencyMs = Date.now() - t0;

  if (response.status === 429) {
    const errText = await response.text().catch(() => '');
    const error = new Error(`Agnes AI Rate Limit Exceeded (429) | ${errText}`);
    error.status = 429;
    throw error;
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Agnes AI Error HTTP ${response.status}: ${response.statusText} | ${errText}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('Invalid response structure from Agnes AI API');

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

module.exports = queryAgnes;
