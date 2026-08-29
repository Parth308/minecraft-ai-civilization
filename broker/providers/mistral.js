const logger = require('../../shared/logger');

// Mistral La Plateforme — "Experiment" free plan: ~1B tokens/month, ~60 RPM.
// Supports multiple comma-separated API keys in MISTRAL_API_KEY.
// On 429 (rate limit), rotates to the next key automatically.
async function queryMistral(apiKey, prompt, options = {}) {
  if (!apiKey) throw new Error('MISTRAL_API_KEY is not configured');

  // Parse multiple keys: "key1,key2,key3" → [key1, key2, key3]
  const keys = String(apiKey).split(',').map(k => k.trim()).filter(Boolean);

  const candidateModels = [
    process.env.MISTRAL_MODEL,
    'mistral-small-latest',
    'open-mistral-nemo',
    'mistral-large-latest'
  ].filter(Boolean);

  let lastError = null;
  const t0 = Date.now();

  // Try each key, and for each key try each model
  for (let ki = 0; ki < keys.length; ki++) {
    const currentKey = keys[ki];
    for (const model of candidateModels) {
      try {
        logger.info('MistralProvider', `Querying Mistral API with model: ${model} (key ${ki + 1}/${keys.length})...`);
        const requestBody = {
          model: model,
          messages: [{ role: 'user', content: prompt }]
        };
        if (options.jsonMode) {
          requestBody.response_format = { type: 'json_object' };
        }
        const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${currentKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(10000)
        });

        const latencyMs = Date.now() - t0;

        if (response.status === 429) {
          const errText = await response.text().catch(() => '');
          logger.warn('MistralProvider', `Key ${ki + 1}/${keys.length} rate-limited (429), rotating to next key...`);
          lastError = new Error(`Mistral API Rate Limit Exceeded (429) | ${errText}`);
          lastError.status = 429;
          break; // Break inner model loop, try next key
        }

        if (!response.ok) {
          const errText = await response.text().catch(() => '');
          lastError = new Error(`Mistral API Error HTTP ${response.status}: ${response.statusText} | ${errText}`);
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
        if (err.status === 429) {
          lastError = err;
          break; // Break inner model loop, try next key
        }
        lastError = err;
      }
    }
  }

  throw lastError || new Error('All Mistral keys and models exhausted');
}

module.exports = queryMistral;
