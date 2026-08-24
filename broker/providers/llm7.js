const logger = require('../../shared/logger');

// LLM7.io — anonymous free lane. Model catalog rotates; IDs verified against
// GET https://api.llm7.io/v1/models (2026-08-24).
async function queryLLM7(apiKey, prompt) {
  const effectiveKey = apiKey || 'unused';

  const candidateModels = [
    process.env.LLM7_MODEL,
    'DeepSeek-V4-Flash-0731',
    'Inkling',
    'claude-fable-5',
    'default'
  ].filter(Boolean);

  let lastError = null;
  for (const model of candidateModels) {
    const t0 = Date.now();
    try {
      logger.info('LLM7Provider', `Querying LLM7.io API with model: ${model}...`);
      const response = await fetch('https://api.llm7.io/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${effectiveKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.6,
          max_tokens: 1024
        }),
        signal: AbortSignal.timeout(30000)
      });

      const latencyMs = Date.now() - t0;

      if (response.status === 429) {
        const errText = await response.text().catch(() => '');
        const error = new Error(`LLM7 Rate Limit Exceeded (429) | ${errText}`);
        error.status = 429;
        throw error;
      }

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        lastError = new Error(`LLM7 Error HTTP ${response.status} | ${errText.slice(0, 200)}`);
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

  throw lastError || new Error('All LLM7 models exhausted');
}

module.exports = queryLLM7;
