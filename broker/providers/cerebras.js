const logger = require('../../shared/logger');

const PREFERRED_MODELS = [
  'llama-3.3-70b',
  'qwen-3-32b',
  'gpt-oss-120b',
  'gpt-oss-20b',
  'llama3.1-8b'
];

let modelListCache = null;

// Model names on Cerebras rotate without notice (404 "Model does not exist").
// Discovering the live catalog turns hard failures into automatic selection.
async function fetchAvailableModels(apiKey) {
  if (modelListCache && Date.now() - modelListCache.at < 3600000) {
    return modelListCache.ids;
  }
  const res = await fetch('https://api.cerebras.ai/v1/models', {
    headers: { 'Authorization': `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(5000)
  });
  if (!res.ok) throw new Error(`Cerebras models list HTTP ${res.status}`);
  const data = await res.json();
  const ids = (data.data || []).map(m => m.id);
  if (!Array.isArray(ids) || ids.length === 0) throw new Error('Cerebras models list empty');
  modelListCache = { at: Date.now(), ids };
  logger.info('CerebrasProvider', `Discovered ${ids.length} available models: ${ids.slice(0, 8).join(', ')}${ids.length > 8 ? '...' : ''}`);
  return ids;
}

function pickCandidates(envModel, availableIds) {
  const wanted = [...new Set([envModel, ...PREFERRED_MODELS].filter(Boolean))];
  if (!availableIds) return wanted;
  const usable = wanted.filter(m => availableIds.includes(m));
  return usable.length > 0 ? usable : wanted;
}

async function queryCerebras(apiKey, prompt, options = {}) {
  if (!apiKey) throw new Error('CEREBRAS_API_KEY is not configured');

  let availableIds = null;
  try {
    availableIds = await fetchAvailableModels(apiKey);
  } catch (err) {
    logger.debug('CerebrasProvider', `Model discovery skipped (${err.message}) — using preference list`);
  }

  const candidateModels = pickCandidates(process.env.CEREBRAS_MODEL, availableIds);

  let lastError = null;
  const t0 = Date.now();

  for (const model of candidateModels) {
    try {
      logger.info('CerebrasProvider', `Querying Cerebras API with model: ${model}...`);
      const requestBody = {
        model: model,
        messages: [{ role: 'user', content: prompt }]
      };
      if (options.jsonMode) {
        requestBody.response_format = { type: 'json_object' };
      }
      const response = await fetch('https://api.cerebras.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(8000)
      });

      const latencyMs = Date.now() - t0;

      if (response.status === 429 || response.status === 402 || response.status === 403) {
        // Rate/quota/access blocks apply account-wide — trying more models cannot help
        const errText = await response.text().catch(() => '');
        const error = new Error(`Cerebras API blocked (HTTP ${response.status}) | ${errText.slice(0, 150)}`);
        error.status = response.status;
        throw error;
      }

      if (response.status === 402 || response.status === 401) {
        const errText = await response.text().catch(() => '');
        const error = new Error(`Cerebras API Payment/Auth Error (${response.status}) | ${errText}`);
        error.status = response.status;
        throw error;
      }

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        if (errText.includes('payment_required')) {
          const error = new Error(`Cerebras API Payment Required | ${errText}`);
          error.status = 402;
          throw error;
        }
        lastError = new Error(`Cerebras API Error HTTP ${response.status}: ${response.statusText} | ${errText}`);
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

  throw lastError || new Error('All Cerebras models exhausted');
}

module.exports = queryCerebras;
