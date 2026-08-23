const logger = require('../../shared/logger');

async function queryOpenRouter(apiKey, prompt) {
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not configured');

  const candidateModels = [
    process.env.OPENROUTER_MODEL,
    'nvidia/nemotron-3-nano-30b-a3b:free',
    'liquid/lfm-2.5-2.6b:free',
    'nvidia/nemotron-3.5-lightning:free',
    'google/gemma-4-31b-it:free',
    'google/gemma-4-26b-a4b-it:free'
  ].filter(Boolean);

  let lastError = null;
  const t0 = Date.now();

  for (const model of candidateModels) {
    try {
      logger.info('OpenRouterProvider', `Querying OpenRouter API with model: ${model}...`);
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/Parth308/minecraft-ai-civilization',
          'X-Title': 'Minecraft AI Civilization'
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
        const error = new Error(`OpenRouter API Rate Limit Exceeded (429) | ${errText}`);
        error.status = 429;
        throw error;
      }

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        lastError = new Error(`OpenRouter API Error HTTP ${response.status}: ${response.statusText} | ${errText}`);
        continue; // Try next candidate free model
      }

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content;
      if (!text) continue;

      return {
        text,
        model: data.model || model,
        latencyMs,
        usage: {
          inputTokens: data.usage?.prompt_tokens ?? null,
          outputTokens: data.usage?.completion_tokens ?? null
        }
      };
    } catch (err) {
      if (err.status === 429) throw err;
      lastError = err;
    }
  }

  throw lastError || new Error('All OpenRouter free models exhausted');
}

module.exports = queryOpenRouter;
