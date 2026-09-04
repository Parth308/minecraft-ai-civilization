const logger = require('../../shared/logger');

async function querySambaNova(apiKey, prompt, options = {}) {
  if (!apiKey) throw new Error('SAMBANOVA_API_KEY is not configured');

  const candidateModels = [
    process.env.SAMBANOVA_MODEL,
    'MiniMax-M2.7',
    'DeepSeek-V3.1'
  ].filter(Boolean);

  let lastError = null;
  const t0 = Date.now();

  for (const model of candidateModels) {
    try {
      logger.info('SambaNovaProvider', `Querying SambaNova with model: ${model}...`);
      const requestBody = {
        model: model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.6,
        max_tokens: 1024
      };
      if (options.jsonMode) {
        requestBody.response_format = { type: 'json_object' };
      }
      const response = await fetch('https://api.sambanova.ai/v1/chat/completions', {
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
        const error = new Error(`SambaNova Rate Limited (429) | ${errText}`);
        error.status = 429;
        throw error;
      }

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        lastError = new Error(`SambaNova Error HTTP ${response.status}: ${response.statusText} | ${errText}`);
        if (response.status === 402) lastError.status = 402;
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

  throw lastError || new Error('All SambaNova models exhausted');
}

module.exports = querySambaNova;
