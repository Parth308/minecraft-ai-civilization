const logger = require('../../shared/logger');

// Cloudflare Workers AI — 10,000 free Neurons/day on every account (resets 00:00 UTC).
// OpenAI-compatible REST endpoint scoped to the account. The fp8-fast models are
// neuron-cheap, making this the highest-volume free lane for social chatter.
const CANDIDATE_MODELS = [
  process.env.CLOUDFLARE_MODEL,
  '@cf/meta/llama-3.1-8b-instruct-fp8-fast',
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
].filter(Boolean);

async function queryCloudflare(apiKey, prompt, options = {}) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!apiKey || !accountId) throw new Error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID required');

  let lastError = null;
  const t0 = Date.now();
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/chat/completions`;

  for (const model of [...new Set(CANDIDATE_MODELS)]) {
    try {
      logger.info('CloudflareProvider', `Querying Workers AI with model: ${model}...`);
      const requestBody = {
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1024
      };
      // Workers AI rejects response_format on several chat models — rely on
      // the router's own JSON parsing instead of risking a 400.
      const response = await fetch(endpoint, {
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
        const error = new Error('Cloudflare Workers AI Rate Limit Exceeded (429)');
        error.status = 429;
        throw error;
      }
      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        lastError = new Error(`Cloudflare HTTP ${response.status}: ${response.statusText} | ${errText.slice(0, 150)}`);
        continue;
      }

      const data = await response.json();
      if (data.success === false) {
        lastError = new Error(`Cloudflare API errors: ${JSON.stringify(data.errors || []).slice(0, 150)}`);
        continue;
      }
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

  throw lastError || new Error('All Cloudflare models exhausted');
}

module.exports = queryCloudflare;
