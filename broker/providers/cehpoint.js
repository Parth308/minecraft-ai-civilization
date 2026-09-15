const logger = require('../../shared/logger');

// Cehpoint AI (ai-api.cehpoint.co.in) — zero auth, unlimited free calls.
// Indian AI API hub, OpenAI-compatible endpoint.
async function queryCehpoint(apiKey, prompt, options = {}) {
  const model = process.env.CEHPOINT_MODEL || 'cehpoint-ai';
  logger.info('CehpointProvider', `Querying Cehpoint AI with model: ${model}...`);
  const t0 = Date.now();

  const body = {
    model,
    messages: [
      { role: 'system', content: 'You are a decision engine for an autonomous Minecraft agent. Reply ONLY with raw JSON matching the requested schema. No markdown, no explanations.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.4,
    max_tokens: 1024
  };
  if (options.jsonMode) body.response_format = { type: 'json_object' };

  const response = await fetch('https://ai-api.cehpoint.co.in/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000)
  });

  const latencyMs = Date.now() - t0;

  if (response.status === 429) {
    const errText = await response.text().catch(() => '');
    const error = new Error(`Cehpoint Rate Limit Exceeded (429) | ${errText}`);
    error.status = 429;
    throw error;
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Cehpoint Error HTTP ${response.status}: ${response.statusText} | ${errText}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('Invalid response structure from Cehpoint AI');

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

module.exports = queryCehpoint;
