const logger = require('../../shared/logger');

// SiliconFlow (siliconflow.cn) — Chinese multi-vendor inference platform.
// Free tier: Qwen3-8B and DeepSeek-R1-Distill-Qwen-7B are permanently $0.
async function querySiliconFlow(apiKey, prompt, options = {}) {
  if (!apiKey) throw new Error('SILICONFLOW_API_KEY is not configured');

  const candidateModels = [
    process.env.SILICONFLOW_MODEL,
    'Qwen/Qwen3-8B-Instruct',
    'deepseek-ai/DeepSeek-R1-Distill-Qwen-7B',
    'THUDM/glm-4-9b-chat',
    'deepseek-ai/DeepSeek-V3'
  ].filter(Boolean);

  let lastError = null;
  const t0 = Date.now();

  for (const model of candidateModels) {
    try {
      logger.info('SiliconFlowProvider', `Querying SiliconFlow API with model: ${model}...`);
      const requestBody = {
        model: model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: options.maxTokens || 2048
      };
      if (options.jsonMode) {
        requestBody.response_format = { type: 'json_object' };
      }
      const response = await fetch('https://api.siliconflow.cn/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(12000)
      });

      const latencyMs = Date.now() - t0;

      if (response.status === 429) {
        const errText = await response.text().catch(() => '');
        const error = new Error(`SiliconFlow API Rate Limit Exceeded (429) | ${errText}`);
        error.status = 429;
        throw error;
      }

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        lastError = new Error(`SiliconFlow API Error HTTP ${response.status}: ${response.statusText} | ${errText}`);
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

  throw lastError || new Error('All SiliconFlow models exhausted');
}

module.exports = querySiliconFlow;
