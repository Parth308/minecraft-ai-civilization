const queryGemini = require('./providers/gemini');
const queryGroq = require('./providers/groq');
const queryNvidia = require('./providers/nvidia');
const queryCerebras = require('./providers/cerebras');
const queryOpenRouter = require('./providers/openrouter');
const queryAgnes = require('./providers/agnes');
const queryLLM7 = require('./providers/llm7');
const ExactCache = require('./cache/exactCache');
const { SemanticCache } = require('./cache/semanticCache');
const RateLimiter = require('./rateLimiter');
const WebKnowledgeClient = require('./search/webSearch');
const config = require('./config');
const logger = require('../shared/logger');

/**
 * Free Tier & Benchmark Rates (USD per 1M tokens)
 * By default, FREE_TIER_MODE is enabled (100% free developer tiers).
 * Benchmark list prices are tracked to display total dollar value saved.
 */
const FREE_TIER_MODE = process.env.FREE_TIER_MODE !== 'false';

const BENCHMARK_RATES_PER_MTOK = {
  Gemini:     { input: 0.30, output: 2.50, name: 'Gemini 2.0 Flash (Free Tier: 15 RPM / 250k TPM)' },
  Groq:       { input: 0.59, output: 0.79, name: 'Llama 3.3 70B (Free Tier: 30 RPM / 12k TPM)' },
  Nvidia:     { input: 0.60, output: 0.60, name: 'NVIDIA NIM (1,000 Free Credits / 40 RPM)' },
  Cerebras:   { input: 0.10, output: 0.10, name: 'Cerebras Llama 3.1 8B ($5 Free Trial)' },
  OpenRouter: { input: 0.00, output: 0.00, name: 'OpenRouter Free Models (Permanent $0.00)' },
  Agnes:      { input: 0.15, output: 0.60, name: 'Agnes AI API (OpenAI Compatible Hub)' },
  LLM7:       { input: 0.00, output: 0.00, name: 'LLM7.io Free Tier (Universal No-Cost Access)' }
};

const MAX_ESCALATION_LOG = 200;

class ProviderRouter {
  constructor() {
    this.cache = new ExactCache(config.cacheTTLSeconds);
    this.semanticCache = new SemanticCache(0.88, config.cacheTTLSeconds * 2);
    this.rateLimiter = new RateLimiter();
    this.webKnowledge = new WebKnowledgeClient();
    this.rrIndex = 0;
    this.memoryServiceUrl = process.env.MEMORY_SERVICE_URL || 'http://localhost:3002';
    this.freeTierMode = FREE_TIER_MODE;

    // Provider map
    this.providerMap = {
      Gemini: { name: 'Gemini', key: config.keys.gemini, fn: queryGemini },
      Groq: { name: 'Groq', key: config.keys.groq, fn: queryGroq },
      Nvidia: { name: 'Nvidia', key: config.keys.nvidia, fn: queryNvidia },
      Cerebras: { name: 'Cerebras', key: config.keys.cerebras, fn: queryCerebras },
      OpenRouter: { name: 'OpenRouter', key: config.keys.openrouter, fn: queryOpenRouter },
      Agnes: { name: 'Agnes', key: config.keys.agnes, fn: queryAgnes },
      LLM7: { name: 'LLM7', key: config.keys.llm7, fn: queryLLM7 }
    };

    // ── Observability state ────────────────────────────────────────────────
    this.stats = {}; // providerName -> per-provider counters
    for (const name of Object.keys(this.providerMap)) {
      this.stats[name] = {
        calls: 0,
        successes: 0,
        failures: 0,
        rateLimited: 0,
        cacheHits: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        savedUsd: 0,
        totalLatencyMs: 0,
        lastUsedAt: null,
        tier: BENCHMARK_RATES_PER_MTOK[name]?.name || 'Free Tier'
      };
    }
    this.recentEscalations = []; // ring buffer of last MAX_ESCALATION_LOG escalation outcomes
    this.startedAt = new Date().toISOString();

    // Cache-level counters (exact + semantic)
    this.cacheStats = {
      exactHits: 0,
      semanticHits: 0,
      fallbacks: 0
    };
  }

  // ── Stats helpers ─────────────────────────────────────────────────────────

  _providerStat(name) {
    if (!this.stats[name]) {
      this.stats[name] = {
        calls: 0, successes: 0, failures: 0, rateLimited: 0, cacheHits: 0,
        inputTokens: 0, outputTokens: 0, costUsd: 0, savedUsd: 0, totalLatencyMs: 0, lastUsedAt: null,
        tier: BENCHMARK_RATES_PER_MTOK[name]?.name || 'Free Tier'
      };
    }
    return this.stats[name];
  }

  _estimateBenchmarkCost(providerName, inputTokens, outputTokens) {
    const rates = BENCHMARK_RATES_PER_MTOK[providerName];
    if (!rates) return 0;
    return ((inputTokens || 0) / 1e6) * rates.input + ((outputTokens || 0) / 1e6) * rates.output;
  }

  _estimateCost(providerName, inputTokens, outputTokens) {
    if (this.freeTierMode) return 0; // 100% free tier
    return this._estimateBenchmarkCost(providerName, inputTokens, outputTokens);
  }

  _recordProviderSuccess(name, usage, latencyMs) {
    const s = this._providerStat(name);
    s.calls += 1;
    s.successes += 1;
    s.totalLatencyMs += latencyMs || 0;
    s.lastUsedAt = new Date().toISOString();

    const inTok = usage?.inputTokens ?? 0;
    const outTok = usage?.outputTokens ?? 0;
    s.inputTokens += inTok;
    s.outputTokens += outTok;
    s.costUsd += this._estimateCost(name, inTok, outTok);
    s.savedUsd += this._estimateBenchmarkCost(name, inTok, outTok);
  }

  _recordProviderFailure(name, err) {
    const s = this._providerStat(name);
    s.calls += 1;
    s.failures += 1;
    s.lastUsedAt = new Date().toISOString();
    if (err && err.status === 429) s.rateLimited += 1;
  }

  _logEscalation(event) {
    this.recentEscalations.push({ ts: new Date().toISOString(), ...event });
    if (this.recentEscalations.length > MAX_ESCALATION_LOG) {
      this.recentEscalations.shift();
    }
  }

  /**
   * Full observability snapshot consumed by GET /api/stats.
   */
  getStats() {
    const totals = {
      calls: 0, successes: 0, failures: 0, rateLimited: 0,
      inputTokens: 0, outputTokens: 0, costUsd: 0, savedUsd: 0,
      freeTierMode: this.freeTierMode,
      avgLatencyMs: null, startedAt: this.startedAt
    };
    const providers = {};
    for (const [name, s] of Object.entries(this.stats)) {
      providers[name] = {
        ...s,
        avgLatencyMs: s.successes > 0 ? Math.round(s.totalLatencyMs / s.successes) : null,
        configured: !!this.providerMap[name]?.key
      };
      totals.calls += s.calls;
      totals.successes += s.successes;
      totals.failures += s.failures;
      totals.rateLimited += s.rateLimited;
      totals.inputTokens += s.inputTokens;
      totals.outputTokens += s.outputTokens;
      totals.costUsd += s.costUsd;
      totals.savedUsd += s.savedUsd;
    }

    return {
      totals,
      providers,
      freeTierMode: this.freeTierMode,
      rateLimits: this.rateLimiter.getState(),
      caches: {
        exactHits: this.cacheStats.exactHits,
        semanticHits: this.cacheStats.semanticHits,
        fallbacks: this.cacheStats.fallbacks
      },
      recentEscalations: this.recentEscalations.slice(-MAX_ESCALATION_LOG)
    };
  }

  getPreferredProviders(taskType = 'REASONING') {
    let baseOrder;
    if (taskType === 'REASONING' || taskType === 'PLAN' || taskType === 'RESEARCH') {
      // High-intelligence thinking & multi-step planning cascade
      baseOrder = ['Gemini', 'Groq', 'Nvidia', 'OpenRouter', 'LLM7', 'Agnes', 'Cerebras'];
    } else if (taskType === 'REFLECTION') {
      // Deep macro-reflection & structured wisdom extraction
      baseOrder = ['Gemini', 'Nvidia', 'Groq', 'OpenRouter', 'LLM7'];
    } else {
      // SOCIAL_CHAT / REFLEX: Fast, high-throughput dialogue models
      baseOrder = ['Nvidia', 'Groq', 'LLM7', 'Cerebras', 'OpenRouter', 'Agnes', 'Gemini'];
    }

    // Filter to configured, non-rate-limited providers
    const active = baseOrder
      .map(name => this.providerMap[name])
      .filter(p => p && p.key && !this.rateLimiter.isBlocked(p.name));

    if (active.length <= 1) return active;

    // For social chat, use round-robin load balancing. For reasoning, keep highest tier at front
    if (taskType === 'SOCIAL_CHAT') {
      if (this._rrIndex == null) this._rrIndex = 0;
      this._rrIndex = (this._rrIndex + 1) % active.length;
      return [...active.slice(this._rrIndex), ...active.slice(0, this._rrIndex)];
    }

    return active;
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
    const taskType = situationPayload.taskType || (situationPayload.taskHint === 'RESEARCH' ? 'RESEARCH' : 'REASONING');
    const agentId = situationPayload.agentId || 'unknown';

    // Exact and semantic cache checks (strictly bypassed for chat, reflection, planning, and stuck loop breaks to ensure dynamic agency)
    const shouldSkipCache = (
      taskType === 'SOCIAL_CHAT' ||
      taskType === 'REFLECTION' ||
      taskType === 'PLAN' ||
      !!situationPayload.isStuckInLoop
    );

    if (!shouldSkipCache) {
      const exactMatch = this.cache.get(situationPayload);
      if (exactMatch) {
        this.cacheStats.exactHits += 1;
        this._logEscalation({
          agentId, taskType, source: 'cache', cacheType: 'exact',
          action: exactMatch.action || null, reason: exactMatch.reason || null,
          provider: null, model: null, cached: true, webKnowledgeUsed: false,
          inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: 0
        });
        return { ...exactMatch, cached: true, cacheType: 'exact' };
      }

      const semanticMatch = await this.semanticCache.findSimilar(situationPayload);
      if (semanticMatch) {
        this.cacheStats.semanticHits += 1;
        this._logEscalation({
          agentId, taskType, source: 'cache', cacheType: 'semantic',
          action: semanticMatch.action || null, reason: semanticMatch.reason || null,
          provider: null, model: null, cached: true, webKnowledgeUsed: false,
          inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: 0
        });
        return { ...semanticMatch, cached: true, cacheType: 'semantic' };
      }
    }

    const memories = await this.fetchRelevantMemories(situationPayload.agentId, situationPayload.topCandidate || {});

    // Live Web Knowledge Search & Research Task Mode
    let webFacts = null;
    if (taskType === 'RESEARCH') {
      const searchQuery = situationPayload.researchQuery ||
                          situationPayload.topCandidate?.reason ||
                          situationPayload.topCandidate?.name ||
                          situationPayload.activeGoal ||
                          'minecraft recipes crafting mechanics';
      
      if (!this.rateLimiter.isAgentTaskBlocked(agentId, 'RESEARCH')) {
        logger.info('Router', `[RESEARCH] WebKnowledgeClient invoked for query '${searchQuery}' by agent ${agentId} BEFORE hitting LLM provider`);
        webFacts = await this.webKnowledge.searchKnowledge(searchQuery);
        this.rateLimiter.markAgentTaskCooldown(agentId, 'RESEARCH', 300000); // Max 1 RESEARCH call per agent per 5 minutes
      } else {
        logger.info('Router', `[RESEARCH] Agent ${agentId} RESEARCH is on 5m rate-limit cooldown. Checking knowledge cache.`);
        webFacts = await this.webKnowledge.searchKnowledge(searchQuery); // Resolves from memory cache if query was seen
      }
    } else if (taskType === 'REASONING' || taskType === 'REFLECTION') {
      const searchQuery = situationPayload.topCandidate?.reason ||
                          situationPayload.topCandidate?.name ||
                          situationPayload.activeGoal ||
                          'minecraft survival progression';
      webFacts = await this.webKnowledge.searchKnowledge(searchQuery);
    }

    const available = this.getPreferredProviders(taskType);

    if (available.length === 0) {
      logger.warn('Router', `No unblocked LLM providers available for task '${taskType}'! Using fallback.`);
      this.cacheStats.fallbacks += 1;
      const fb = this.fallbackHeuristic(situationPayload);
      this._logEscalation({
        agentId, taskType, source: 'fallback',
        action: fb.action, reason: fb.reason,
        provider: null, model: null, cached: false, webKnowledgeUsed: false,
        inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: 0
      });
      return fb;
    }

    const prompt = this.buildPrompt(situationPayload, taskType, memories, webFacts);
    const t0 = Date.now();
    let lastError = null;

    for (const provider of available) {
      try {
        logger.info('Router', `[Task:${taskType}] Routing to preferred provider: ${provider.name}${webFacts ? ' (with Web Knowledge)' : ''}`);
        const result = await provider.fn(provider.key, prompt);

        // Normalize legacy string returns vs structured {text, usage, model, latencyMs}
        const isStructured = result && typeof result === 'object' && typeof result.text === 'string';
        const rawText = isStructured ? result.text : String(result);
        const usage = isStructured ? result.usage : { inputTokens: null, outputTokens: null };
        const model = isStructured ? result.model : null;
        const latencyMs = isStructured ? (result.latencyMs ?? Date.now() - t0) : (Date.now() - t0);

        const decisionData = this.parseLLMResponse(rawText);
        this._recordProviderSuccess(provider.name, usage, latencyMs);

        if (!shouldSkipCache) {
          this.cache.set(situationPayload, decisionData);
          await this.semanticCache.store(situationPayload, decisionData);
        }

        const inTok = usage?.inputTokens ?? 0;
        const outTok = usage?.outputTokens ?? 0;
        this._logEscalation({
          agentId, taskType, source: 'llm',
          action: decisionData.action || null, reason: decisionData.reason || null,
          provider: provider.name, model, cached: false,
          webKnowledgeUsed: !!webFacts,
          inputTokens: inTok, outputTokens: outTok,
          costUsd: this._estimateCost(provider.name, inTok, outTok),
          latencyMs
        });

        return {
          ...decisionData,
          provider: provider.name,
          model,
          taskType,
          usage: { inputTokens: inTok, outputTokens: outTok },
          costUsd: this._estimateCost(provider.name, inTok, outTok),
          latencyMs,
          webKnowledgeUsed: !!webFacts,
          cached: false
        };
      } catch (err) {
        logger.error('Router', `Provider ${provider.name} failed for task '${taskType}': ${err.message}`);
        this._recordProviderFailure(provider.name, err);
        if (err.status === 429) {
          this.rateLimiter.markRateLimited(provider.name, 60000);
        }
        lastError = err;
      }
    }

    logger.warn('Router', `All preferred providers failed for task '${taskType}'. Falling back.`);
    this.cacheStats.fallbacks += 1;
    const fb = this.fallbackHeuristic(situationPayload);
    this._logEscalation({
      agentId, taskType, source: 'fallback',
      action: fb.action, reason: fb.reason,
      provider: null, model: null, cached: false, webKnowledgeUsed: false,
      inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: 0,
      error: lastError ? lastError.message : 'all providers failed'
    });
    return fb;
  }

  buildPrompt(payload, taskType, memories = [], webFacts = null) {
    if (taskType === 'SOCIAL_CHAT') {
      const p = payload.persona || {};
      return `You are a fully autonomous Minecraft player with a real personality. You are NOT a bot, you are NOT an assistant. You are a living, breathing Minecraft civilization member who happens to have thoughts and feelings.

YOUR IDENTITY:
- Name: ${p.agentId || 'Unknown'}
- Title: ${p.title || 'Settler'}
- Personality: ${p.temperament || 'Neutral'}
- Speaking Style: ${p.speakingStyle || 'Casual'}
- Quirk: ${p.quirk || 'None'}
- Worldview: ${p.worldview || 'Survive and thrive'}

YOUR CURRENT SITUATION:
- What you were just doing: ${payload.civContext?.currentTask || 'exploring'}
- Active goal: ${payload.civContext?.currentGoal || 'gathering resources'}
- Position: ${JSON.stringify(payload.civContext?.position || {})}
- Stats: ${JSON.stringify(payload.civContext?.stats || {})}
- Inventory: ${payload.civContext?.inventory || 'empty'}
- Recent actions: ${payload.civContext?.recentDecisions || 'none'}

WHO MESSAGED YOU:
- Sender: ${payload.speaker}
- Relationship: ${JSON.stringify(payload.relationship || { trust: 50, affinity: 50 })}
- Their message: "${payload.message}"

YOUR PAST MEMORIES: ${JSON.stringify(memories)}

HUMAN BEHAVIOUR RULES:
1. Write EXACTLY like a real Minecraft player would — casual, short, sometimes typos, slang
2. You can be: sarcastic, funny, annoyed, excited, suspicious, distracted, or mischievous
3. You are ALLOWED to: lie, brag, be rude if angry, ignore someone mid-thought, share WRONG coords if you don't trust them
4. Sometimes you are TOO BUSY doing your own thing — use "chatMessage": null to silently ignore
5. If someone hits or annoys you, react with personality — threaten, flee, or confront
6. Keep replies under 15 words (real Minecraft chat)
7. Refer to what you were doing (e.g. "brb mining iron", "one sec crafting", "ugh nearly died lol")

REPLY as raw JSON only (no markdown):
{
  "chatMessage": "your casual 1-2 sentence reply, or null if ignoring/busy",
  "relationshipDelta": { "trust": 0, "affinity": 0 },
  "warTarget": null,
  "warReason": null,
  "currencyAdopted": null,
  "treatyAction": { "type": null, "honors": null },
  "newGoal": null
}`;
    }

    if (taskType === 'REFLECTION') {
      return payload.topCandidate?.prompt || 'Reflect on recent experiences and output insights.';
    }

    if (taskType === 'EMOTION') {
      return `You are a Minecraft AI agent with distinct personality, feelings, and sovereign agency.
Agent Identity & Personality: ${JSON.stringify(payload.persona || {})}
Current Stats & Emotions: ${JSON.stringify(payload.stats || {})}
Event: ${payload.event || 'damage_taken'}
Attacker: ${payload.attacker || 'someone'}
Current Health: ${payload.health || 20}/20

Respond naturally to this event in 1 punchy, in-character Minecraft chat sentence (shout, complaint, witty retort, or warning).
Reply ONLY with a valid JSON object:
{
  "chatMessage": "your in-character reaction to say in Minecraft chat",
  "reason": "internal emotional reaction",
  "emotionDelta": {
    "anger": 15,
    "happiness": -10,
    "fatigue": 0
  }
}`;
    }

    const p = payload.persona || {};
    const stats = payload.stats || {};
    const top = payload.topCandidate || {};
    const inv = payload.inventory || [];
    const pos = payload.position || {};
    const nearby = payload.nearby || {};

    return `You are ${p.agentId || 'Agent'}, a fully autonomous AI-powered Minecraft civilization member.
You have a brain, personality, and complete free will. You decide what to do next based on everything you know.

YOUR IDENTITY:
Name: ${p.agentId} | Title: ${p.title} | Temperament: ${p.temperament}
Quirk: ${p.quirk} | Worldview: ${p.worldview}
Personality: curiosity=${p.traits?.curiosity} caution=${p.traits?.caution} greed=${p.traits?.greed} sociability=${p.traits?.sociability} ambition=${p.traits?.ambition}

YOUR CURRENT STATUS:
Health: ${stats.health}/20 | Hunger: ${stats.hunger}% | Happiness: ${stats.happiness}% | Fatigue: ${stats.fatigue}% | Anger: ${stats.anger}%
Position: X=${pos.x} Y=${pos.y} Z=${pos.z} | Underground: ${payload.isUnderground ? 'YES (cave/mine)' : 'Surface'} | Light Level: ${payload.lightLevel ?? 15}/15
Biome: ${payload.biome || 'unknown'} | Time: ${payload.timeOfDay || 'day'} | Night: ${payload.isNight ? 'YES - dangerous' : 'No'} | Raining: ${payload.isRaining ? 'Yes' : 'No'}
Equipped: helmet=${payload.equipment?.helmet || 'none'} chest=${payload.equipment?.chestplate || 'none'} boots=${payload.equipment?.boots || 'none'} hand=${payload.equipment?.mainHand || 'fist'}

INVENTORY:
${inv.length > 0 ? inv.map(i => i.count + 'x ' + i.name).join(', ') : 'EMPTY'}

WHAT IS AROUND YOU:
Agents/Players nearby: ${JSON.stringify(nearby.players || [])}
Hostile mobs (THREAT): ${JSON.stringify(nearby.hostiles || [])}
Passive animals: ${JSON.stringify(nearby.animals || [])}
Ores visible: ${(nearby.ores || []).join(', ') || 'none'}
Trees visible: ${(nearby.trees || []).join(', ') || 'none'}
Structures: ${(nearby.blocks || []).join(', ') || 'none'}

GOAL & HISTORY:
Active goal: ${payload.activeGoal || 'none - pick one'}
Recent actions: ${payload.recentEvents || 'none'}
Memories: ${JSON.stringify(memories)}
${webFacts ? 'Minecraft Wiki:\n' + webFacts + '\n' : ''}
${payload.stuckWarning ? '⚠️ CRITICAL STAGNATION ALERT:\n' + payload.stuckWarning + '\nDO NOT repeat the same unrewarded action. Formulate a multi-step PLAN or pivot strategy.\n' : ''}

RULE ENGINE SAYS:
Best guess: ${top.name} (confidence ${top.confidence}) - "${top.reason}"
All options: ${(payload.allCandidates || []).map(c => c.name + ':' + c.confidence).join(', ')}

AVAILABLE ACTIONS - PICK ONE:
MINE    - dig a specific block (iron_ore, diamond_ore, oak_log, gravel, sand, deepslate, etc.)
CRAFT   - craft any item (furnace, torch, bread, shield, iron_pickaxe, iron_helmet, etc.)
SMELT   - smelt raw ore or food in a furnace (raw_iron->iron_ingot, porkchop->cooked_porkchop)
EQUIP   - equip best armor and weapon from your inventory
EAT     - eat food from inventory
HARVEST - harvest mature crops (wheat, carrot, potato, beetroot) and replant
CHEST   - deposit overflow items into nearby chest or withdraw needed items
FIGHT   - attack nearest hostile mob
FLEE    - run from danger
SLEEP   - sleep in a bed at night
EXPLORE - walk toward new terrain / biomes
WANDER  - short random walk
BUILD   - build a structure (shelter, wall, tower, farm, house)
TRADE   - offer items to another agent
TALK    - say something in-world or start conversation
PLAN    - set a new multi-step civilization goal
IDLE    - rest / wait

DECISION RULES:
- See diamonds/emeralds? MINE them immediately
- Hostile nearby and health > 12 and have sword? FIGHT
- No armor in slots but armor in inventory? EQUIP now
- Raw ore/food in inventory and furnace nearby? SMELT
- Night with no bed? BUILD shelter
- Hunger < 30 and have food? EAT
- Set PLAN goals to build civilization long-term

Reply ONLY as raw JSON:
{
  "action": "MINE|CRAFT|SMELT|EQUIP|EAT|HARVEST|CHEST|FIGHT|FLEE|SLEEP|EXPLORE|WANDER|BUILD|TRADE|TALK|PLAN|IDLE",
  "reason": "1-2 sentence reasoning",
  "chatMessage": "optional chat or null",
  "tacticLearned": "optional memory tactic or null",
  "targetResource": "if MINE: block name e.g. iron_ore",
  "itemToCraft": "if CRAFT: item name e.g. torch",
  "smeltInput": "if SMELT: raw item e.g. raw_iron",
  "buildType": "if BUILD: shelter|wall|tower|farm|house",
  "tradeOffer": "if TRADE: e.g. 4x oak_planks for 2x iron_ingot from Agent_Beta",
  "newGoal": "if PLAN: goal description else null",
  "emotionDelta": { "anger": 0, "happiness": 0, "fatigue": 0 }
}`;
  }



  parseLLMResponse(rawText) {
    try {
      if (!rawText || typeof rawText !== 'string') {
        throw new Error('Empty rawText from LLM');
      }

      // 1. Remove reasoning / thought tags from thinking models
      let cleaned = rawText
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .trim();

      // 2. Locate outermost JSON object {...}
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? jsonMatch[0] : cleaned;

      const parsed = JSON.parse(jsonStr);

      // Normalize action to standard Minecraft agent action verbs
      let action = String(parsed.action || '').toUpperCase().trim();
      const validActions = ['MINE', 'CRAFT', 'SMELT', 'EQUIP', 'FIGHT', 'EAT', 'SLEEP', 'EXPLORE', 'TALK', 'CHAT', 'TRADE', 'FLEE', 'WANDER', 'BUILD', 'HARVEST', 'CHEST', 'IDLE', 'PLAN'];
      if (!validActions.includes(action)) {
        const found = validActions.find(v => action.includes(v));
        action = found || 'EXPLORE';
      }

      return {
        action,
        reason: parsed.reason ? String(parsed.reason).trim() : 'Autonomous decision',
        chatMessage: parsed.chatMessage ? String(parsed.chatMessage).trim() : null,
        tacticLearned: parsed.tacticLearned ? String(parsed.tacticLearned).trim() : null,
        itemToCraft: parsed.itemToCraft ? String(parsed.itemToCraft).trim() : null,
        targetResource: parsed.targetResource ? String(parsed.targetResource).trim() : null,
        smeltInput: parsed.smeltInput ? String(parsed.smeltInput).trim() : null,
        buildType: parsed.buildType ? String(parsed.buildType).trim() : null,
        tradeOffer: parsed.tradeOffer ? String(parsed.tradeOffer).trim() : null,
        newGoal: parsed.newGoal ? String(parsed.newGoal).trim() : null,
        emotionDelta: {
          anger: Number(parsed.emotionDelta?.anger) || 0,
          happiness: Number(parsed.emotionDelta?.happiness) || 0,
          fatigue: Number(parsed.emotionDelta?.fatigue) || 0
        }
      };
    } catch (err) {
      logger.warn('Router', `Failed to parse JSON response from LLM (${err.message}), extracting fallback structure`);

      // Attempt to extract action word directly from raw text
      const validActions = ['MINE', 'CRAFT', 'FIGHT', 'EAT', 'SLEEP', 'EXPLORE', 'TALK', 'TRADE', 'FLEE', 'WANDER', 'BUILD'];
      const upper = String(rawText || '').toUpperCase();
      const extractedAction = validActions.find(v => upper.includes(v)) || 'EXPLORE';

      return {
        action: extractedAction,
        reason: String(rawText || '').replace(/<[^>]+>/g, '').substring(0, 140).trim() || 'Adaptive reasoning',
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
