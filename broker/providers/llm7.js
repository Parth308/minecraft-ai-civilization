const logger = require('../../shared/logger');

async function queryLLM7(apiKey, prompt) {
  const model = process.env.LLM7_MODEL || 'default';
  const effectiveKey = apiKey || 'unused';
  logger.info('LLM7Provider', `Querying LLM7.io API with model: ${model}...`);
  const t0 = Date.now();

  const response = await fetch('https://api.llm7.io/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${effectiveKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.6,
      max_tokens: 1024
    }),
    signal: AbortSignal.timeout(8000)
  });

  const latencyMs = Date.now() - t0;

  if (response.status === 429) {
    const errText = await response.text().catch(() => '');
    const error = new Error(`LLM7.io Rate Limit Exceeded (429) | ${errText}`);
    error.status = 429;
    throw error;
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`LLM7.io Error HTTP ${response.status}: ${response.statusText} | ${errText}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('Invalid response structure from LLM7.io API');

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

module.exports = queryLLM7;
