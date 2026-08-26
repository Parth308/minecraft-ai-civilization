const logger = require('../../shared/logger');

// Local emergency lane — qwen2.5:3b-instruct inside the existing ollama
// container. Benchmarked against real decision payloads: 6/6 strict-JSON,
// avg ~53s CPU latency, mediocre judgment. That trade is CORRECT for the
// absolute last position: a slow real decision strictly beats the old
// blind-WANDER fallbackHeuristic during total provider exhaustion.
// Deliberately NOT in SOCIAL_CHAT cascades — 50s replies kill conversations.
async function queryOllamaLocal(_unusedKey, prompt, options = {}) {
  const host = (process.env.OLLAMA_LOCAL_HOST || 'http://ollama:11434').replace(/\/$/, '');
  const model = process.env.OLLAMA_LOCAL_MODEL || 'qwen2.5:3b-instruct';
  const t0 = Date.now();

  const response = await fetch(`${host}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'You are a decision engine for an autonomous Minecraft agent. Reply ONLY with raw JSON matching the requested schema. No markdown, no explanations.' },
        { role: 'user', content: prompt }
      ],
      stream: false,
      format: 'json',
      options: { temperature: 0.4, num_predict: 260 }
    }),
    signal: AbortSignal.timeout(120000)
  });

  if (!response.ok) {
    throw new Error(`OllamaLocal HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();
  const text = data.message?.content;
  if (!text) throw new Error('OllamaLocal returned empty content');

  return {
    text,
    model,
    latencyMs: Date.now() - t0,
    usage: { inputTokens: data.prompt_eval_count ?? null, outputTokens: data.eval_count ?? null }
  };
}

module.exports = queryOllamaLocal;
