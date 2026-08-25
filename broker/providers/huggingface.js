const logger = require('../../shared/logger');

// HuggingFace Inference Providers router — one hf_ token (free account, no
// card) fronts ~19 partner backends via an OpenAI-compatible endpoint.
// Free-tier monthly credits are small, so this lane runs late in the cascade.
const CANDIDATE_MODELS = [
  process.env.HUGGINGFACE_MODEL,
  'meta-llama/Llama-3.1-8B-Instruct',
  'deepseek-ai/DeepSeek-V3-0324'
].filter(Boolean);

async function queryHuggingFace(apiKey, prompt, options = {}) {
  if (!apiKey) throw new Error('HF_TOKEN is not configured');

  let lastError = null;
  const t0 = Date.now();

  for (const model of [...new Set(CANDIDATE_MODELS)]) {
    try {
      logger.info('HuggingFaceProvider', `Querying HF router with model: ${model}...`);
      const requestBody = {
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1024
      };
      if (options.jsonMode) {
        requestBody.response_format = { type: 'json_object' };
      }
      const response = await fetch('https://router.huggingface.co/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(20000)
      });

      const latencyMs = Date.now() - t0;

      if (response.status === 429) {
        const error = new Error('HuggingFace Rate Limit Exceeded (429)');
        error.status = 429;
        throw error;
      }
      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        lastError = new Error(`HuggingFace HTTP ${response.status}: ${response.statusText} | ${errText.slice(0, 150)}`);
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

  throw lastError || new Error('All HuggingFace models exhausted');
}

module.exports = queryHuggingFace;
