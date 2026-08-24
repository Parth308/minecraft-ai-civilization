const logger = require('../../shared/logger');

// LiteRouter (literouter.com) — unified gateway, OpenAI-compatible.
// Free plan: unlimited :free-model calls with ~7s cooldown, 50 premium calls/day.
// Big free roster includes Chinese models (DeepSeek/GLM/Qwen) — no CN identity needed.
async function queryLiteRouter(apiKey, prompt, options = {}) {
  if (!apiKey) throw new Error('LITEROUTER_API_KEY is not configured');

  const candidateModels = [
    process.env.LITEROUTER_MODEL,
    'deepseek-v3.2:free',
    'claude-haiku-4.5-cheap:free',
    'gpt-oss-120b:free',
    'llama-3.3-70b-instruct-turbo:free',
    'mistral-large-3:free',
    'qwen3.5:free',
    'gemini-2.5-flash-lite:free'
  ].filter(Boolean);

  let lastError = null;
  const t0 = Date.now();

  for (const model of candidateModels) {
    try {
      logger.info('LiteRouterModule', `Querying LiteRouter with model: ${model}...`);
      const requestBody = {
        model: model,
        messages: [{ role: 'user', content: prompt }]
      };
      if (options.jsonMode) {
        requestBody.response_format = { type: 'json_object' };
      }
      const response = await fetch('https://api.literouter.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(20000)
      });

      const latencyMs = Date.now() - t0;

      if (response.status === 429) {
        // Their cooldown is time-based (7s); let the broker rate limiter handle it
        const errText = await response.text().catch(() => '');
        const error = new Error(`LiteRouter Rate Limited (429) | ${errText}`);
        error.status = 429;
        throw error;
      }

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        lastError = new Error(`LiteRouter Error HTTP ${response.status}: ${response.statusText} | ${errText}`);
        continue;
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

  throw lastError || new Error('All LiteRouter models exhausted');
}

module.exports = queryLiteRouter;
