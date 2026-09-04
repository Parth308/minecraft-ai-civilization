const logger = require('../../shared/logger');

async function queryQwenLocal(apiKey, prompt, options = {}) {
  const baseUrl = (apiKey && apiKey.startsWith('http') ? apiKey : null)
    || process.env.QWENLOCAL_BASE_URL
    || 'http://10.10.2.10:8080/v1';
  const model = process.env.QWENLOCAL_MODEL || '/mnt/models/Qwen3.6-35B-A3B-UD-Q4_K_M.gguf';
  logger.info('QwenLocalProvider', `Querying QwenLocal with model: ${model}...`);
  const t0 = Date.now();

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'You are a decision engine for an autonomous Minecraft agent. Reply ONLY with raw JSON matching the requested schema. No markdown, no explanations.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.4,
      max_tokens: 768,
      // Thinking model: disable chain-of-thought so the JSON answer lands
      // in content within seconds instead of timing out mid-reasoning.
      chat_template_kwargs: { enable_thinking: false }
    }),
    signal: AbortSignal.timeout(90000)
  });

  const latencyMs = Date.now() - t0;

  if (response.status === 429) {
    const errText = await response.text().catch(() => '');
    const error = new Error(`QwenLocal Rate Limit Exceeded (429) | ${errText}`);
    error.status = 429;
    throw error;
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`QwenLocal Error HTTP ${response.status}: ${response.statusText} | ${errText}`);
  }

  const data = await response.json();
  const msg = data.choices?.[0]?.message;
  // Thinking model: content can come back empty with the answer only in
  // reasoning_content (llama.cpp field) — salvage trailing JSON from it.
  let text = msg?.content;
  if (!text && msg?.reasoning_content) {
    const m = String(msg.reasoning_content).match(/\{[\s\S]*\}/);
    if (m) text = m[0];
  }
  if (!text) throw new Error('Invalid response structure from QwenLocal API');

  return {
    text,
    model: data.model || model,
    latencyMs,
    usage: {
      inputTokens: data.usage?.prompt_tokens ?? null,
      outputTokens: data.usage?.completion_tokens ?? null
    }
  };
}

module.exports = queryQwenLocal;
