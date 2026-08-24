const logger = require('../../shared/logger');

// TokenReply (tokenreply.com) — aggregator over 40+ upstreams, OpenAI-compatible.
// Default tier keeps free models available but paid allowances are check-in gated,
// so this is a bonus lane, never a workhorse.
async function queryTokenReply(apiKey, prompt, options = {}) {
  if (!apiKey) throw new Error('TOKENREPLY_API_KEY is not configured');

  // Verified against live /v1/models catalog — '-free' suffix models are callable
  // on the Default tier (2026-08-24).
  const candidateModels = [
    process.env.TOKENREPLY_MODEL,
    'deepseek-v4-flash-free',
    'gemini-3.7-flash-default-free',
    'nemotron-3-ultra-free',
    'mimo-v2.5-free',
    'deepseek-v4-flash-thinking-free'
  ].filter(Boolean);

  let lastError = null;
  const t0 = Date.now();

  for (const model of candidateModels) {
    try {
      logger.info('TokenReplyProvider', `Querying TokenReply with model: ${model}...`);
      const requestBody = {
        model: model,
        messages: [{ role: 'user', content: prompt }]
      };
      if (options.jsonMode) {
        requestBody.response_format = { type: 'json_object' };
      }
      const response = await fetch('https://api.tokenreply.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(15000)
      });

      const latencyMs = Date.now() - t0;

      if (response.status === 429) {
        const errText = await response.text().catch(() => '');
        const error = new Error(`TokenReply Rate Limited (429) | ${errText}`);
        error.status = 429;
        throw error;
      }

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        lastError = new Error(`TokenReply Error HTTP ${response.status}: ${response.statusText} | ${errText}`);
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

  throw lastError || new Error('All TokenReply models exhausted');
}

module.exports = queryTokenReply;
