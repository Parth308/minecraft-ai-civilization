const logger = require('../../shared/logger');

/**
 * OmniRoute — standalone Node.js router running on the VPS host
 * OpenAI-compatible /v1/chat/completions endpoint.
 *
 * - Auto-routing models (auto/best-fast, auto/best-chat, auto/best-coding,
 *   auto/best-reasoning, auto/best-vision) let OmniRoute pick the cheapest
 *   working upstream per request — no manual key rotation.
 * - Reasoning models (openai/gpt-oss-120b via nvidia) put ~70 tokens of chain
 *   into `reasoning_content` BEFORE `content`; we force max_tokens ≥ 512 so
 *   the response actually arrives before the budget is spent.
 * - Specific oc/* model IDs (e.g. oc/claude-sonnet-5-low) currently 401
 *   "Model X is not supported" — only the auto/* lane is known to work with
 *   the current VPS API key.
 */
async function queryOmniRoute(apiKey, prompt, options = {}) {
  if (!apiKey) throw new Error('OMNIROUTE_API_KEY is not configured');

  const baseUrl = (process.env.OMNIROUTE_BASE_URL || 'http://host.docker.internal:20128').replace(/\/+$/, '');
  const model = options.model || process.env.OMNIROUTE_MODEL || 'auto/best-fast';
  // Reasoning models chew tokens on chain-of-thought; 512 leaves headroom.
  const maxTokens = options.maxTokens || 512;

  logger.info('OmniRouteProvider', `Querying ${baseUrl} with model: ${model} (max_tokens=${maxTokens})...`);
  const t0 = Date.now();

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: options.temperature ?? 0.6,
      max_tokens: maxTokens,
      stream: false
    }),
    // Reasoning chains can take 10-20s; 30s headroom keeps it from tearing
    // down on the first slow nvidia round-trip.
    signal: AbortSignal.timeout(options.timeoutMs || 30000)
  });

  const latencyMs = Date.now() - t0;

  if (response.status === 429) {
    const errText = await response.text().catch(() => '');
    const error = new Error(`OmniRoute Rate Limit Exceeded (429) | ${errText}`);
    error.status = 429;
    throw error;
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    // OmniRoute surfaces "Model X is not supported" as 401 — treat as a model
    // rejection so the broker's circuit breaker doesn't quarantine the lane
    // for an hour on a key that's fine for auto/* routes.
    const error = new Error(`OmniRoute Error HTTP ${response.status}: ${response.statusText} | ${errText}`);
    error.status = response.status;
    if (response.status === 401 && /is not supported/i.test(errText)) {
      error.modelUnsupported = true;
    }
    throw error;
  }

  const data = await response.json();
  // Reasoning models populate `content` AFTER `reasoning_content`; either can
  // be null, but the agent needs SOMETHING to read.
  const text = data.choices?.[0]?.message?.content
    ?? data.choices?.[0]?.message?.reasoning_content
    ?? data.choices?.[0]?.reasoning
    ?? null;

  if (!text) throw new Error('Invalid response structure from OmniRoute (no content or reasoning)');

  // OmniRoute mirrors the routed upstream's name (e.g. "openai/gpt-oss-120b")
  // — keep it so the dashboard costs panel can attribute tokens correctly.
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

module.exports = queryOmniRoute;
