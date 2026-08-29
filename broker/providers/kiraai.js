const logger = require('../../shared/logger');

async function queryKiraAI(apiKey, prompt, options = {}) {
  if (!apiKey) throw new Error('KIRA_API_KEY is not configured');

  const candidateModels = [
    process.env.KIRA_MODEL,
    'kira-3.5-flash',
    'kira-3.5-pro',
    'kira-2.5-flash',
    'kira-2.5-pro'
  ].filter(Boolean);

  let lastError = null;
  const t0 = Date.now();

  for (const model of candidateModels) {
    try {
      logger.info('KiraAIProvider', `Querying KiraAI API with model: ${model}...`);
      const requestBody = {
        model: model,
        messages: [{ role: 'user', content: prompt }]
      };
      if (options.jsonMode) {
        requestBody.response_format = { type: 'json_object' };
      }
      const response = await fetch('https://kiraai.vn/api/v1/chat/completions', {
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
        const error = new Error(`KiraAI API Rate Limit Exceeded (429) | ${errText}`);
        error.status = 429;
        throw error;
      }

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        lastError = new Error(`KiraAI API Error HTTP ${response.status}: ${response.statusText} | ${errText}`);
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

  throw lastError || new Error('All KiraAI models exhausted');
}

module.exports = queryKiraAI;
