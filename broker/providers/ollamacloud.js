const logger = require('../../shared/logger');

async function queryOllamaCloud(apiKey, prompt, options = {}) {
  if (!apiKey) throw new Error('OLLAMACLOUD_API_KEY is not configured');

  const model = process.env.OLLAMACLOUD_MODEL || 'gpt-oss:20b';
  logger.info('OllamaCloudProvider', `Querying Ollama Cloud with model: ${model}...`);
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

  const response = await fetch('https://ollama.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000)
  });

  const latencyMs = Date.now() - t0;

  if (response.status === 429) {
    const errText = await response.text().catch(() => '');
    const error = new Error(`Ollama Cloud Rate Limit Exceeded (429) | ${errText}`);
    error.status = 429;
    throw error;
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Ollama Cloud Error HTTP ${response.status}: ${response.statusText} | ${errText}`);
  }

  const data = await response.json();
  const msg = data.choices?.[0]?.message;
  // Reasoning models (gpt-oss) can exhaust max_tokens thinking and leave
  // content empty — salvage trailing JSON from the reasoning trace instead.
  let text = msg?.content;
  if (!text && msg?.reasoning) {
    const m = String(msg.reasoning).match(/\{[\s\S]*\}/);
    if (m) text = m[0];
  }
  if (!text) throw new Error('Invalid response structure from Ollama Cloud API');

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

module.exports = queryOllamaCloud;
