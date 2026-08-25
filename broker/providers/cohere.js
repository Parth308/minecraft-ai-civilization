const logger = require('../../shared/logger');

// Cohere — permanent free evaluation tier: 20 RPM, ~1,000 calls/month, no card.
// OpenAI-compatible endpoint. Command models handle JSON mode well.
const CANDIDATE_MODELS = [
  process.env.COHERE_MODEL,
  'command-a-02-2025',
  'command-r7b-12-2024'
].filter(Boolean);

async function queryCohere(apiKey, prompt, options = {}) {
  if (!apiKey) throw new Error('COHERE_API_KEY is not configured');

  let lastError = null;
  const t0 = Date.now();

  for (const model of [...new Set(CANDIDATE_MODELS)]) {
    try {
      logger.info('CohereProvider', `Querying Cohere with model: ${model}...`);
      const requestBody = {
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1024
      };
      if (options.jsonMode) {
        requestBody.response_format = { type: 'json_object' };
      }
      const response = await fetch('https://api.cohere.ai/compatibility/v1/chat/completions', {
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
        const error = new Error('Cohere Rate Limit Exceeded (429)');
        error.status = 429;
        throw error;
      }
      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        lastError = new Error(`Cohere HTTP ${response.status}: ${response.statusText} | ${errText.slice(0, 150)}`);
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

  throw lastError || new Error('All Cohere models exhausted');
}

module.exports = queryCohere;
