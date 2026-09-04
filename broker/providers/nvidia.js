const logger = require('../../shared/logger');

async function queryNvidia(apiKey, prompt, options = {}) {
  if (!apiKey) throw new Error('NVIDIA_API_KEY is not configured');

  const model = process.env.NVIDIA_MODEL || 'openai/gpt-oss-20b';
  logger.info('NvidiaProvider', `Querying NVIDIA NIM API with model: ${model}...`);
  const t0 = Date.now();

  const requestBody = {
    model: model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.6,
    max_tokens: 1024,
    // Reasoning model: low effort keeps JSON answers fast — broker prompts
    // are big and full reasoning blows the 30s timeout (24% fail rate).
    reasoning_effort: 'low'
  };
  if (options.jsonMode) {
    requestBody.response_format = { type: 'json_object' };
  }

  const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
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
    const error = new Error('NVIDIA NIM API Rate Limit Exceeded (429)');
    error.status = 429;
    throw error;
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`NVIDIA NIM API Error HTTP ${response.status}: ${response.statusText} | ${errText}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('Invalid response structure from NVIDIA NIM API');

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

module.exports = queryNvidia;
