const logger = require('../../shared/logger');

// Alibaba DashScope (Qwen) international — OpenAI-compatible mode.
// New accounts get ~1M free tokens PER MODEL (90-day validity), 60 RPM,
// login-only signup. Separate quotas per model make the candidate chain
// effectively multiply the free budget.
const CANDIDATE_MODELS = [
  process.env.QWEN_MODEL,
  'qwen-flash',
  'qwen-plus',
  'qwen-turbo'
].filter(Boolean);

async function queryQwen(apiKey, prompt, options = {}) {
  if (!apiKey) throw new Error('DASHSCOPE_API_KEY is not configured');

  let lastError = null;
  const t0 = Date.now();

  for (const model of [...new Set(CANDIDATE_MODELS)]) {
    try {
      logger.info('QwenProvider', `Querying Qwen with model: ${model}...`);
      const requestBody = {
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1024
      };
      if (options.jsonMode) {
        requestBody.response_format = { type: 'json_object' };
      }
      const response = await fetch('https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions', {
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
        const error = new Error('Qwen Rate Limit Exceeded (429)');
        error.status = 429;
        throw error;
      }
      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        lastError = new Error(`Qwen HTTP ${response.status}: ${response.statusText} | ${errText.slice(0, 150)}`);
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

  throw lastError || new Error('All Qwen models exhausted');
}

module.exports = queryQwen;
