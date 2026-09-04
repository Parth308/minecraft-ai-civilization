const logger = require('../../shared/logger');

async function queryChutes(apiKey, prompt, options = {}) {
  if (!apiKey) throw new Error('CHUTES_API_KEY is not configured');

  const model = process.env.CHUTES_MODEL || 'unsloth/Mistral-Nemo-Instruct-2407-TEE';
  logger.info('ChutesProvider', `Querying Chutes with model: ${model}...`);
  const t0 = Date.now();

  const requestBody = {
    model: model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.6,
    max_tokens: 1024
  };
  if (options.jsonMode) {
    requestBody.response_format = { type: 'json_object' };
  }

  const response = await fetch('https://llm.chutes.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(30000)
  });

  const latencyMs = Date.now() - t0;

  if (response.status === 429) {
    const errText = await response.text().catch(() => '');
    const error = new Error(`Chutes Rate Limit Exceeded (429) | ${errText}`);
    error.status = 429;
    throw error;
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Chutes Error HTTP ${response.status}: ${response.statusText} | ${errText}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('Invalid response structure from Chutes API');

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

module.exports = queryChutes;
