const logger = require('../../shared/logger');

// Z.ai (open.bigmodel.cn) — GLM-4.7-Flash & GLM-4.5-Flash are permanently free.
// Reasoning models: content may be empty, reasoning_content holds the thinking.
// Salvage JSON from reasoning trace when content is empty (same pattern as OllamaCloud gpt-oss).
async function queryZhipuAI(apiKey, prompt, options = {}) {
  if (!apiKey) throw new Error('ZHIPUAI_API_KEY is not configured');

  const candidateModels = [
    process.env.ZHIPUAI_MODEL,
    'GLM-4.7-Flash',
    'GLM-4.5-Flash'
  ].filter(Boolean);

  let lastError = null;
  const t0 = Date.now();

  for (const model of candidateModels) {
    try {
      logger.info('ZhipuAIProvider', `Querying Z.ai with model: ${model}...`);

      const body = {
        model,
        messages: [
          { role: 'system', content: 'You are a decision engine for an autonomous Minecraft agent. Reply ONLY with raw JSON matching the requested schema. No markdown, no explanations.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.4,
        max_tokens: 1024
      };
      if (options.jsonMode) body.response_format = { type: 'json_object' };

      const response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000)
      });

      const latencyMs = Date.now() - t0;

      if (response.status === 429 || response.status === 1305) {
        const errText = await response.text().catch(() => '');
        const error = new Error(`Z.ai Rate Limited (429/1305) | ${errText}`);
        error.status = 429;
        throw error;
      }

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        lastError = new Error(`Z.ai Error HTTP ${response.status}: ${response.statusText} | ${errText}`);
        continue;
      }

      const data = await response.json();
      const msg = data.choices?.[0]?.message;

      // Reasoning models may exhaust max_tokens thinking and leave content empty
      let text = msg?.content;
      if (!text && msg?.reasoning_content) {
        const m = String(msg.reasoning_content).match(/\{[\s\S]*\}/);
        if (m) text = m[0];
      }
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

  throw lastError || new Error('All Z.ai models exhausted');
}

module.exports = queryZhipuAI;
