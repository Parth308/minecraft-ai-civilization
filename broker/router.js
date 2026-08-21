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

    // Provider map
    this.providerMap = {
      Gemini: { name: 'Gemini', key: config.keys.gemini, fn: queryGemini },
      Groq: { name: 'Groq', key: config.keys.groq, fn: queryGroq },
      Cerebras: { name: 'Cerebras', key: config.keys.cerebras, fn: queryCerebras },
      OpenRouter: { name: 'OpenRouter', key: config.keys.openrouter, fn: queryOpenRouter }
    };
  }

  // Model preference order by task type
  getPreferredProviders(taskType = 'REASONING') {
    let order = ['Gemini', 'Groq', 'Cerebras', 'OpenRouter'];

    if (taskType === 'CHAT' || taskType === 'REFLEX') {
      // Groq prioritized for fast dialogue/reflex actions
      order = ['Groq', 'Gemini', 'Cerebras', 'OpenRouter'];
    } else if (taskType === 'REASONING' || taskType === 'EMOTION') {
      // Gemini Flash prioritized for complex reasoning and emotion updates
      order = ['Gemini', 'Groq', 'Cerebras', 'OpenRouter'];
    }

    return order
      .map(name => this.providerMap[name])
      .filter(p => p && p.key && !this.rateLimiter.isBlocked(p.name));
  }

  async processEscalation(situationPayload) {
    // 1. Check exact-match cache
    const cachedResult = this.cache.get(situationPayload);
    if (cachedResult) {
      return { ...cachedResult, cached: true };
    }

    // 2. Determine task type and provider priority order
    const taskType = situationPayload.taskType || 'REASONING';
    const available = this.getPreferredProviders(taskType);

    if (available.length === 0) {
      logger.warn('Router', `No unblocked LLM providers available for task type '${taskType}'! Using fallback.`);
      return this.fallbackHeuristic(situationPayload);
    }

    // 3. Build task-specific prompt
    const prompt = this.buildPrompt(situationPayload, taskType);

    let lastError = null;
    for (const provider of available) {
      try {
        logger.info('Router', `[Task:${taskType}] Routing to preferred provider: ${provider.name}`);
        const rawText = await provider.fn(provider.key, prompt);
        const decisionData = this.parseLLMResponse(rawText);

        // Save to exact-match cache
        this.cache.set(situationPayload, decisionData);

        return { ...decisionData, provider: provider.name, taskType, cached: false };
      } catch (err) {
        logger.error('Router', `Provider ${provider.name} failed for task '${taskType}': ${err.message}`);

        if (err.status === 429) {
          this.rateLimiter.markRateLimited(provider.name, 60000); // 60s cooldown
        }
        lastError = err;
      }
    }

    logger.warn('Router', `All preferred providers failed for task '${taskType}'. Last error: ${lastError?.message}. Falling back.`);
    return this.fallbackHeuristic(situationPayload);
  }

  buildPrompt(payload, taskType) {
    return `You are a Minecraft AI agent decision and personality engine.
Task Mode: ${taskType}
Agent Current Stats & Emotions: ${JSON.stringify(payload.stats || {})}
Current Situation: ${JSON.stringify(payload.topCandidate || {})}
All Evaluated Options: ${JSON.stringify(payload.allCandidates || [])}

Instructions:
1. Choose the best action to perform.
2. Provide a short reason.
3. (Optional) Provide a natural in-game public chat message.
4. Calculate emotional adjustments (emotionDelta) to anger, happiness, or fatigue based on the situation (-20 to +20).

Reply ONLY with a valid JSON object (no markdown, no backticks):
{
  "action": "EAT" | "FLEE" | "FIGHT" | "SLEEP" | "MINE" | "WANDER" | "IDLE" | "TRADE" | "EXPLORE" | "BUILD",
  "reason": "short explanation",
  "chatMessage": "optional chat output or null",
  "emotionDelta": {
    "anger": 0,
    "happiness": 0,
    "fatigue": 0
  }
}`;
  }

  parseLLMResponse(rawText) {
    try {
      const cleanJson = rawText.replace(/```json|```/g, '').trim();
      return JSON.parse(cleanJson);
    } catch (err) {
      logger.warn('Router', 'Failed to parse JSON response from LLM, returning default structure');
      return {
        action: 'WANDER',
        reason: rawText.substring(0, 100),
        chatMessage: null,
        emotionDelta: { anger: 0, happiness: 0, fatigue: 0 }
      };
    }
  }

  fallbackHeuristic(payload) {
    return {
      action: payload.topCandidate?.name || 'WANDER',
      reason: 'Fallback baseline decision due to provider unavailability',
      chatMessage: null,
      emotionDelta: { anger: 0, happiness: 0, fatigue: 0 },
      fallback: true
    };
  }
}

module.exports = ProviderRouter;
