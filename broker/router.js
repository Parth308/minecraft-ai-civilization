const queryGemini = require('./providers/gemini');
const queryGroq = require('./providers/groq');
const queryCerebras = require('./providers/cerebras');
const queryOpenRouter = require('./providers/openrouter');
const ExactCache = require('./cache/exactCache');
const RateLimiter = require('./rateLimiter');
const config = require('./config');
const logger = require('../shared/logger');

class ProviderRouter {
  constructor() {
    this.cache = new ExactCache(config.cacheTTLSeconds);
    this.rateLimiter = new RateLimiter();
    this.rrIndex = 0;

    // Define provider pool
    this.providers = [
      { name: 'Gemini', key: config.keys.gemini, fn: queryGemini },
      { name: 'Groq', key: config.keys.groq, fn: queryGroq },
      { name: 'Cerebras', key: config.keys.cerebras, fn: queryCerebras },
      { name: 'OpenRouter', key: config.keys.openrouter, fn: queryOpenRouter }
    ];
  }

  getAvailableProviders() {
    return this.providers.filter(p => p.key && !this.rateLimiter.isBlocked(p.name));
  }

  async processEscalation(situationPayload) {
    // 1. Check exact-match cache
    const cachedResult = this.cache.get(situationPayload);
    if (cachedResult) {
      return { ...cachedResult, cached: true };
    }

    // 2. Build prompt for LLM decision
    const prompt = this.buildPrompt(situationPayload);

    // 3. Try available providers via Round-Robin with Automatic Failover
    const available = this.getAvailableProviders();
    if (available.length === 0) {
      logger.warn('Router', 'No configured or unblocked LLM providers available in pool! Using heuristic fallback.');
      return this.fallbackHeuristic(situationPayload);
    }

    let lastError = null;
    for (let attempts = 0; attempts < available.length; attempts++) {
      const providerIndex = (this.rrIndex + attempts) % available.length;
      const provider = available[providerIndex];

      try {
        logger.info('Router', `Dispatching escalation request to provider: ${provider.name}`);
        const rawText = await provider.fn(provider.key, prompt);

        // Update round robin index for next request
        this.rrIndex = (providerIndex + 1) % available.length;

        const decisionData = this.parseLLMResponse(rawText);
        
        // Save to exact-match cache
        this.cache.set(situationPayload, decisionData);

        return { ...decisionData, provider: provider.name, cached: false };
      } catch (err) {
        logger.error('Router', `Provider ${provider.name} failed: ${err.message}`);

        if (err.status === 429) {
          this.rateLimiter.markRateLimited(provider.name, 60000); // 60s cooldown
        }
        lastError = err;
      }
    }

    logger.warn('Router', `All LLM providers failed. Last error: ${lastError?.message}. Falling back to default.`);
    return this.fallbackHeuristic(situationPayload);
  }

  buildPrompt(payload) {
    return `You are a Minecraft AI agent decision engine.
Agent Status: ${JSON.stringify(payload.stats || {})}
Current Situation: ${JSON.stringify(payload.topCandidate || {})}
Available Candidates: ${JSON.stringify(payload.allCandidates || [])}

Analyze the situation and reply ONLY with a valid JSON object with no markdown formatting:
{
  "action": "EAT" | "FLEE" | "FIGHT" | "SLEEP" | "MINE" | "WANDER" | "IDLE",
  "reason": "short explanation",
  "chatMessage": "optional public chat message to announce"
}`;
  }

  parseLLMResponse(rawText) {
    try {
      const cleanJson = rawText.replace(/```json|```/g, '').trim();
      return JSON.parse(cleanJson);
    } catch (err) {
      logger.warn('Router', 'Failed to parse JSON response from LLM, returning raw message');
      return {
        action: 'WANDER',
        reason: rawText.substring(0, 100),
        chatMessage: 'I am thinking about my next move...'
      };
    }
  }

  fallbackHeuristic(payload) {
    return {
      action: payload.topCandidate?.name || 'WANDER',
      reason: 'Fallback baseline decision due to provider unavailability',
      chatMessage: null,
      fallback: true
    };
  }
}

module.exports = ProviderRouter;
