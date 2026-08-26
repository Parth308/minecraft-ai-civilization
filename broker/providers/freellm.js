const logger = require('../../shared/logger');

// FreeLLMAPI lane (github.com/tashfeenahmed/freellmapi) — self-hosted
// OpenAI-compatible proxy stacking ~30 free provider tiers behind one
// endpoint. Runs as the `freellmapi` container on the compose network.
// Model ids use their router strategies: 'auto', 'auto:quality', 'auto:fast'
// — the upstream picks whichever pooled provider is healthy.
async function queryFreellm(apiKey, prompt, options = {}) {
  if (!apiKey) throw new Error('FREELLMAPI_KEY is not configured');

  const baseUrl = (process.env.FREELLMAPI_BASE_URL || 'http://freellmapi:3001/v1').replace(/\/$/, '');
  const candidateModels = [
    process.env.FREELLMAPI_MODEL,
    'auto',
    'auto:fast'
  ].filter(Boolean);

  let lastError = null;
  const t0 = Date.now();

  for (const model of candidateModels) {
    try {
      logger.debug('FreellmModule', `Querying FreeLLMAPI with model: ${model}...`);
      const requestBody = {
        model,
        messages: [{ role: 'user', content: prompt }]
      };
      if (options.jsonMode) {
        requestBody.response_format = { type: 'json_object' };
      }
      const response = await fetch(`${baseUrl}/chat/completions`, {
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
        const error = new Error(`FreeLLMAPI Rate Limited (429) | ${errText}`);
        error.status = 429;
        throw error;
      }

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        lastError = new Error(`FreeLLMAPI Error HTTP ${response.status}: ${response.statusText} | ${errText.slice(0, 200)}`);
        continue;
      }

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content;
      if (!text) continue;

      return {
        text,
        // Upstream reports the actual pooled provider in _routed_via/model
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

  throw lastError || new Error('All FreeLLMAPI models exhausted');
}

module.exports = queryFreellm;
