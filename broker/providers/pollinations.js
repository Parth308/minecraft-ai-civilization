const logger = require('../../shared/logger');

// Pollinations.ai — anonymous, keyless text generation. Last-resort lane when
// every keyed provider is rate-limited. Quality is modest; availability is the point.
async function queryPollinations(_unusedKey, prompt, options = {}) {
  const t0 = Date.now();
  const model = process.env.POLLINATIONS_MODEL || 'openai';

  try {
    const response = await fetch('https://text.pollinations.ai/openai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }]
      }),
      signal: AbortSignal.timeout(20000)
    });

    const latencyMs = Date.now() - t0;

    if (response.status === 429) {
      const error = new Error('Pollinations Rate Limit Exceeded (429)');
      error.status = 429;
      throw error;
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Pollinations API Error HTTP ${response.status}: ${response.statusText} | ${errText}`);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error('Pollinations returned empty content');

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
    throw err;
  }
}

module.exports = queryPollinations;
