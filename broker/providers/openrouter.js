const logger = require('../../shared/logger');

async function queryOpenRouter(apiKey, prompt) {
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not configured');

  logger.info('OpenRouterProvider', 'Querying OpenRouter Free API...');
  const t0 = Date.now();

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'meta-llama/llama-3.1-8b-instruct:free',
      messages: [{ role: 'user', content: prompt }]
    })
  });

  const latencyMs = Date.now() - t0;

  if (response.status === 429) {
    const error = new Error('OpenRouter API Rate Limit Exceeded (429)');
    error.status = 429;
    throw error;
  }

  if (!response.ok) {
    throw new Error(`OpenRouter API Error: ${response.statusText} (${response.status})`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('Invalid response structure from OpenRouter API');

  return {
    text,
    model: data.model || 'meta-llama/llama-3.1-8b-instruct:free',
    latencyMs,
    usage: {
      inputTokens: data.usage?.prompt_tokens ?? null,
      outputTokens: data.usage?.completion_tokens ?? null
    }
  };
}

module.exports = queryOpenRouter;
