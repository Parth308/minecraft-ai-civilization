const queryGemini = require('./providers/gemini');
const queryGroq = require('./providers/groq');
const queryCerebras = require('./providers/cerebras');
const queryOpenRouter = require('./providers/openrouter');
const ExactCache = require('./cache/exactCache');
const { SemanticCache } = require('./cache/semanticCache');
const RateLimiter = require('./rateLimiter');
const config = require('./config');
const logger = require('../shared/logger');

class ProviderRouter {
  constructor() {
    this.cache = new ExactCache(config.cacheTTLSeconds);
    this.semanticCache = new SemanticCache(0.88, config.cacheTTLSeconds * 2);
    this.rateLimiter = new RateLimiter();
    this.rrIndex = 0;
    this.memoryServiceUrl = process.env.MEMORY_SERVICE_URL || 'http://localhost:3002';

    // Provider map
    this.providerMap = {
      Gemini: { name: 'Gemini', key: config.keys.gemini, fn: queryGemini },
      Groq: { name: 'Groq', key: config.keys.groq, fn: queryGroq },
      Cerebras: { name: 'Cerebras', key: config.keys.cerebras, fn: queryCerebras },
      OpenRouter: { name: 'OpenRouter', key: config.keys.openrouter, fn: queryOpenRouter }
    };
  }

  getPreferredProviders(taskType = 'REASONING') {
    let order = ['Gemini', 'Groq', 'Cerebras', 'OpenRouter'];

    if (taskType === 'CHAT' || taskType === 'REFLEX') {
      order = ['Groq', 'Gemini', 'Cerebras', 'OpenRouter'];
    } else if (taskType === 'REASONING' || taskType === 'EMOTION') {
      order = ['Gemini', 'Groq', 'Cerebras', 'OpenRouter'];
    }

    return order
      .map(name => this.providerMap[name])
      .filter(p => p && p.key && !this.rateLimiter.isBlocked(p.name));
  }

  async fetchRelevantMemories(agentId, situation) {
    try {
      const query = situation.name || '';
      const response = await fetch(`${this.memoryServiceUrl}/api/memory/query?agentId=${agentId || 'Agent_Alpha'}&query=${encodeURIComponent(query)}&limit=3`);
      if (!response.ok) return [];
      const data = await response.json();
      return data.memories || [];
    } catch (err) {
      logger.debug('Router', `Memory query skipped: ${err.message}`);
      return [];
    }
  }

  async processEscalation(situationPayload) {
    // 1. Check exact-match cache
    const exactMatch = this.cache.get(situationPayload);
    if (exactMatch) {
      return { ...exactMatch, cached: true, cacheType: 'exact' };
    }

    // 2. Check semantic vector similarity cache (0.88 threshold)
    const semanticMatch = await this.semanticCache.findSimilar(situationPayload);
    if (semanticMatch) {
      return { ...semanticMatch, cached: true, cacheType: 'semantic' };
    }

    // 3. Fetch relevant memories from memory-service
    const memories = await this.fetchRelevantMemories(situationPayload.agentId, situationPayload.topCandidate || {});

    // 4. Determine task type and preferred provider order
    const taskType = situationPayload.taskType || 'REASONING';
    const available = this.getPreferredProviders(taskType);

    if (available.length === 0) {
      logger.warn('Router', `No unblocked LLM providers available for task type '${taskType}'! Using fallback.`);
      return this.fallbackHeuristic(situationPayload);
    }

    // 5. Build prompt with injected structured memories
    const prompt = this.buildPrompt(situationPayload, taskType, memories);

    let lastError = null;
    for (const provider of available) {
      try {
        logger.info('Router', `[Task:${taskType}] Routing to preferred provider: ${provider.name}`);
        const rawText = await provider.fn(provider.key, prompt);
        const decisionData = this.parseLLMResponse(rawText);

        // Save to BOTH Exact-Match and Semantic Vector Caches
        this.cache.set(situationPayload, decisionData);
        await this.semanticCache.store(situationPayload, decisionData);

        return { ...decisionData, provider: provider.name, taskType, cached: false };
      } catch (err) {
        logger.error('Router', `Provider ${provider.name} failed for task '${taskType}': ${err.message}`);

        if (err.status === 429) {
          this.rateLimiter.markRateLimited(provider.name, 60000);
        }
        lastError = err;
      }
    }

    logger.warn('Router', `All preferred providers failed for task '${taskType}'. Last error: ${lastError?.message}. Falling back.`);
    return this.fallbackHeuristic(situationPayload);
  }

  buildPrompt(payload, taskType, memories = []) {
    return `You are a Minecraft AI agent decision and survival engine.
Task Mode: ${taskType}
Agent Current Stats & Emotions: ${JSON.stringify(payload.stats || {})}
Current Situation: ${JSON.stringify(payload.topCandidate || {})}
All Evaluated Options: ${JSON.stringify(payload.allCandidates || [])}
Relevant Retrieved Memory Chunks: ${JSON.stringify(memories)}

Instructions:
1. Choose the best action to perform.
2. Provide a short reason explaining the survival strategy.
3. (Optional) Provide an in-game public chat message.
4. Calculate emotional adjustments (emotionDelta) to anger, happiness, or fatigue (-20 to +20).
5. (Optional) Formulate a learned tactic statement (tacticLearned) to remember for future survival.

Reply ONLY with a valid JSON object (no markdown, no backticks):
{
  "action": "EAT" | "FLEE" | "FIGHT" | "SLEEP" | "MINE" | "WANDER" | "IDLE" | "TRADE" | "EXPLORE" | "BUILD" | "CRAFT",
  "reason": "short explanation",
  "chatMessage": "optional chat output or null",
  "tacticLearned": "optional durable tactic statement or null",
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
        tacticLearned: null,
        emotionDelta: { anger: 0, happiness: 0, fatigue: 0 }
      };
    }
  }

  fallbackHeuristic(payload) {
    return {
      action: payload.topCandidate?.name || 'WANDER',
      reason: 'Fallback baseline decision due to provider unavailability',
      chatMessage: null,
      tacticLearned: null,
      emotionDelta: { anger: 0, happiness: 0, fatigue: 0 },
      fallback: true
    };
  }
}

module.exports = ProviderRouter;
