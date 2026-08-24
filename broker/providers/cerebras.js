const logger = require('../../shared/logger');

async function queryCerebras(apiKey, prompt, options = {}) {
  if (!apiKey) throw new Error('CEREBRAS_API_KEY is not configured');

  const candidateModels = [
    ...new Set([
      process.env.CEREBRAS_MODEL,
      'llama3.1-8b',
      'llama-3.3-70b',
      'llama-3.1-70b'
    ].filter(Boolean))
  ];

  let lastError = null;
  const t0 = Date.now();

  for (const model of candidateModels) {
    try {
      logger.info('CerebrasProvider', `Querying Cerebras API with model: ${model}...`);
      const requestBody = {
        model: model,
        messages: [{ role: 'user', content: prompt }]
      };
      if (options.jsonMode) {
        requestBody.response_format = { type: 'json_object' };
      }
      const response = await fetch('https://api.cerebras.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(8000)
      });

      const latencyMs = Date.now() - t0;

      if (response.status === 429) {
        const errText = await response.text().catch(() => '');
        const error = new Error(`Cerebras API Rate Limit Exceeded (429) | ${errText}`);
        error.status = 429;
        throw error;
      }

      if (response.status === 402 || response.status === 401) {
        const errText = await response.text().catch(() => '');
        const error = new Error(`Cerebras API Payment/Auth Error (${response.status}) | ${errText}`);
        error.status = response.status;
        throw error;
      }

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        if (errText.includes('payment_required')) {
          const error = new Error(`Cerebras API Payment Required | ${errText}`);
          error.status = 402;
          throw error;
        }
        lastError = new Error(`Cerebras API Error HTTP ${response.status}: ${response.statusText} | ${errText}`);
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

  throw lastError || new Error('All Cerebras models exhausted');
}

module.exports = queryCerebras;
