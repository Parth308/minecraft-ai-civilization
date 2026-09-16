const queryGemini = require('./providers/gemini');
const queryGroq = require('./providers/groq');
const queryNvidia = require('./providers/nvidia');
const queryOpenRouter = require('./providers/openrouter');
const querySiliconFlow = require('./providers/siliconflow');
const queryZhipu = require('./providers/zhipu');
const queryMistral = require('./providers/mistral');
const queryTokenReply = require('./providers/tokenreply');
const queryAgnes = require('./providers/agnes');
const queryLLM7 = require('./providers/llm7');
const queryCloudflare = require('./providers/cloudflare');
const queryHuggingFace = require('./providers/huggingface');
const queryCohere = require('./providers/cohere');
const queryQwen = require('./providers/qwen');
const queryFreellm = require('./providers/freellm');
const queryKiraAI = require('./providers/kiraai');
const queryOllamaLocal = require('./providers/ollamalocal');
const queryOmniRoute = require('./providers/omniroute');
const queryCerebras = require('./providers/cerebras');
const queryLiteRouter = require('./providers/literouter');
const queryOllamaCloud = require('./providers/ollamacloud');
const queryChutes = require('./providers/chutes');
const querySambaNova = require('./providers/sambanova');
const queryQwenLocal = require('./providers/qwenlocal');
const queryCehpoint = require('./providers/cehpoint');
const queryZhipuAI = require('./providers/zhipuai');
const ExactCache = require('./cache/exactCache');
const { SemanticCache } = require('./cache/semanticCache');
const RateLimiter = require('./rateLimiter');
const WebKnowledgeClient = require('./search/webSearch');
const config = require('./config');
const logger = require('../shared/logger');
const fs = require('fs');
const path = require('path');
const { generateLocalChatResponse } = require('./local-fallback');

/**
 * Free Tier & Benchmark Rates (USD per 1M tokens)
 * By default, FREE_TIER_MODE is enabled (100% free developer tiers).
 * Benchmark list prices are tracked to display total dollar value saved.
 */
const FREE_TIER_MODE = process.env.FREE_TIER_MODE !== 'false';

const BENCHMARK_RATES_PER_MTOK = {
  Gemini:      { input: 0.30, output: 2.50, name: 'Gemini Flash (Free Tier: ~20 req/day per model post-2025 cuts)' },
  Groq:        { input: 0.59, output: 0.79, name: 'Groq LPU (Free Tier: 30 RPM / up to 14.4k req/day)' },
  Nvidia:      { input: 0.60, output: 0.60, name: 'NVIDIA NIM (~40 RPM Free Prototyping)' },
  OpenRouter:  { input: 0.00, output: 0.00, name: 'OpenRouter :free Models (Rotating Roster)' },
  SiliconFlow: { input: 0.00, output: 0.00, name: 'SiliconFlow Qwen3-8B / DS-R1-Distill (Permanent $0 Models)' },
  Zhipu:       { input: 0.00, output: 0.00, name: 'Zhipu GLM-4-Flash (Free Tier)' },
  Mistral:     { input: 0.50, output: 1.50, name: 'Mistral Experiment Plan (~1B tokens/month free)' },
  TokenReply:  { input: 0.00, output: 0.00, name: 'TokenReply Free Models (-free suffix IDs, verified live)' },
  Agnes:       { input: 0.15, output: 0.60, name: 'Agnes AI API (OpenAI Compatible Hub)' },
  LLM7:        { input: 0.00, output: 0.00, name: 'LLM7.io Free Tier (Universal No-Cost Access)' },
  FreellmAPI:  { input: 0.00, output: 0.00, name: 'FreeLLMAPI self-hosted pooled router (~30 provider tiers)' },
  KiraAI:       { input: 0.00, output: 0.00, name: 'KiraAI (150M free tokens/day, 57+ models)' },
  OmniRoute:    { input: 0.00, output: 0.00, name: 'OmniRoute (self-hosted local router, 390 models, $0)' },
  Cerebras:     { input: 0.00, output: 0.00, name: 'Cerebras LPU (Free Tier: ~1M tokens/day)' },
  LiteRouter:   { input: 0.00, output: 0.00, name: 'LiteRouter (unlimited :free models, ~7s cooldown)' },
  OllamaCloud:  { input: 0.00, output: 0.00, name: 'Ollama Cloud (free starter usage, light models)' },
  Chutes:       { input: 0.00, output: 0.00, name: 'Chutes (free ~100 req/day open models)' },
  QwenLocal:    { input: 0.00, output: 0.00, name: 'QwenLocal Qwen3.6-35B (self-hosted, free unlimited)' },
  SambaNova:    { input: 0.00, output: 0.00, name: 'SambaNova RDU (free tier: 20 req/day/model, no card)' },
  Cehpoint:     { input: 0.00, output: 0.00, name: 'Cehpoint AI (zero auth, unlimited free calls)' },
  ZhipuAI:      { input: 0.00, output: 0.00, name: 'Z.ai GLM-4.7-Flash (free, rate-limited, reasoning model)' }
};

const MAX_ESCALATION_LOG = 200;

class ProviderRouter {
  constructor() {
    this.cache = new ExactCache(config.cacheTTLSeconds);
    this.semanticCache = new SemanticCache(0.88, config.cacheTTLSeconds * 4);
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
      OpenRouter: { name: 'OpenRouter', key: config.keys.openrouter, fn: queryOpenRouter },
      SiliconFlow: { name: 'SiliconFlow', key: config.keys.siliconflow, fn: querySiliconFlow },
      Zhipu: { name: 'Zhipu', key: config.keys.zhipu, fn: queryZhipu },
      Mistral: { name: 'Mistral', key: config.keys.mistral, fn: queryMistral },
      TokenReply: { name: 'TokenReply', key: config.keys.tokenreply, fn: queryTokenReply },
      Agnes: { name: 'Agnes', key: config.keys.agnes, fn: queryAgnes },
      LLM7: { name: 'LLM7', key: config.keys.llm7, fn: queryLLM7 },
      Cloudflare: { name: 'Cloudflare', key: config.keys.cloudflare, fn: queryCloudflare },
      HuggingFace: { name: 'HuggingFace', key: config.keys.huggingface, fn: queryHuggingFace },
      Cohere: { name: 'Cohere', key: config.keys.cohere, fn: queryCohere },
      Qwen: { name: 'Qwen', key: config.keys.qwen, fn: queryQwen },
      FreellmAPI: { name: 'FreellmAPI', key: config.keys.freellm, fn: queryFreellm },
      KiraAI: { name: 'KiraAI', key: config.keys.kiraai, fn: queryKiraAI },
      OllamaLocal: { name: 'OllamaLocal', key: 'local', fn: queryOllamaLocal },
      OmniRoute: { name: 'OmniRoute', key: config.keys.omniroute, fn: queryOmniRoute },
      Cerebras: { name: 'Cerebras', key: config.keys.cerebras, fn: queryCerebras },
      LiteRouter: { name: 'LiteRouter', key: config.keys.literouter, fn: queryLiteRouter },
      OllamaCloud: { name: 'OllamaCloud', key: config.keys.ollamacloud, fn: queryOllamaCloud },
      Chutes: { name: 'Chutes', key: config.keys.chutes, fn: queryChutes },
      QwenLocal: { name: 'QwenLocal', key: config.keys.qwenlocal, fn: queryQwenLocal },
      Cehpoint: { name: 'Cehpoint', key: config.keys.cehpoint, fn: queryCehpoint },
      ZhipuAI: { name: 'ZhipuAI', key: config.keys.zhipuai, fn: queryZhipuAI }
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

    // Civilization shared-lesson injection (ledger wisdom → decision prompts)
    this.lessonCache = { fetchedAt: 0, lessons: [] };
    this._lessonVectors = new Map();
    this.progressionSections = this._loadProgression();
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
    this.rateLimiter.recordSuccess(name);

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
    this.rateLimiter.recordFailure(name, err?.status || null);
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

    const { getLocalFallbackStats } = require('./local-fallback');

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
      localFallback: getLocalFallbackStats(),
      recentEscalations: this.recentEscalations.slice(-MAX_ESCALATION_LOG)
    };
  }

  getPreferredProviders(taskType = 'REASONING', criticality = 'normal') {
    let baseOrder;
    if (criticality === 'critical') {
      // Emergencies get the smartest available brains first — quota thrift is
      // irrelevant when the agent is on fire (sometimes literally).
      // LLM7 moved to last: 280/280 all-timeout in 2.4h, 8s timeout set in llm7.js
      baseOrder = ['Groq', 'Cerebras', 'LiteRouter', 'KiraAI', 'OmniRoute', 'Mistral', 'Nvidia', 'Cehpoint', 'ZhipuAI', 'SiliconFlow', 'Zhipu', 'Cohere', 'Cloudflare', 'HuggingFace', 'Qwen', 'Gemini', 'Agnes', 'FreellmAPI', 'OllamaLocal', 'LLM7'];
    } else if (taskType === 'REASONING' || taskType === 'PLAN' || taskType === 'RESEARCH') {
      // High-intelligence thinking & multi-step planning cascade
      // QwenLocal leads REFLECTION only: slow background jobs suit the
      // single-slot giant; live lanes use fast providers (no 90s stalls).
      baseOrder = ['KiraAI', 'OmniRoute', 'LiteRouter', 'Cerebras', 'SiliconFlow', 'Groq', 'Agnes', 'OllamaCloud', 'Nvidia', 'Cehpoint', 'ZhipuAI', 'Mistral', 'Zhipu', 'Chutes', 'OpenRouter', 'Gemini', 'FreellmAPI', 'OllamaLocal', 'LLM7'];
    } else if (taskType === 'REFLECTION') {
      // Deep macro-reflection — Mistral's ~1B tokens/month budget leads here
      baseOrder = ['QwenLocal', 'KiraAI', 'OmniRoute', 'LiteRouter', 'Mistral', 'SiliconFlow', 'Groq', 'Nvidia', 'Cehpoint', 'ZhipuAI', 'Cohere', 'Chutes', 'OpenRouter', 'FreellmAPI', 'OllamaLocal', 'LLM7'];
    } else {
      // SOCIAL_CHAT / REFLEX: Fast, high-throughput dialogue models.
      // OllamaLocal appended as last-resort — ~50s latency is painful but
      // a real reply strictly beats the blind-WANDER fallbackHeuristic
      // during total provider exhaustion.
      baseOrder = ['Groq', 'LiteRouter', 'KiraAI', 'OmniRoute', 'SiliconFlow', 'Cloudflare', 'Nvidia', 'Cehpoint', 'ZhipuAI', 'Zhipu', 'Mistral', 'OllamaCloud', 'Chutes', 'TokenReply', 'OpenRouter', 'Agnes', 'Gemini', 'FreellmAPI', 'OllamaLocal', 'LLM7'];
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

  _memoryQueryText(situation) {
    // Situation name alone ("MINE") retrieves generic noise. Reason strings,
    // hazards, and goals carry the semantics that match stored memories.
    return [
      situation?.name,
      situation?.reason,
      situation?.hazardType ? `${situation.hazardType} danger` : null,
      situation?.activeGoal
    ].filter(Boolean).join(' ').slice(0, 300);
  }

  async fetchRelevantMemories(agentId, situation) {
    try {
      const query = this._memoryQueryText(situation);
      const response = await fetch(`${this.memoryServiceUrl}/api/memory/query?agentId=${agentId || 'Agent_Alpha'}&query=${encodeURIComponent(query)}&limit=3`);
      if (!response.ok) return [];
      const data = await response.json();
      return data.memories || [];
    } catch (err) {
      logger.debug('Router', `Memory query skipped: ${err.message}`);
      return [];
    }
  }

  async fetchRelevantSkills(agentId, situation) {
    try {
      const query = this._memoryQueryText(situation);
      const response = await fetch(`${this.memoryServiceUrl}/api/memory/query?agentId=${agentId || 'Agent_Alpha'}&query=${encodeURIComponent(query)}&limit=3&section=skills`);
      if (!response.ok) return [];
      const data = await response.json();
      return data.memories || [];
    } catch (err) {
      logger.debug('Router', `Skill query skipped: ${err.message}`);
      return [];
    }
  }

  _cosine(a, b) {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    return (na > 0 && nb > 0) ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
  }

  // The ledger holds severity-ranked lessons settlers paid deaths to learn.
  // Without this injection that wisdom sat unread while agents re-died to the
  // same lava. Top-3 semantic matches ride along with every escalation prompt.
  async fetchRelevantLessons(situation) {
    const TTL_MS = 120000;
    try {
      if (Date.now() - this.lessonCache.fetchedAt > TTL_MS) {
        // Bounded: only the top-3 score, so 200 recent lessons is plenty.
        // Unbounded fetch pulled 34k docs (~20MB JSON) per refresh.
        const res = await fetch(`${this.memoryServiceUrl}/api/ledger/lessons?limit=200`);
        if (res.ok) {
          const data = await res.json();
          this.lessonCache.lessons = (data.sharedLessons || [])
            .map(l => ({ text: String(l.lesson || '').slice(0, 200), by: l.agentId, severity: l.severity }))
            .filter(l => l.text);
          this.lessonCache.fetchedAt = Date.now();
        }
      }
      if (this.lessonCache.lessons.length === 0) return [];

      const query = this._memoryQueryText(situation);
      if (!query) return [];
      const embedder = this.semanticCache.embeddingClient;
      const queryVec = await embedder.getEmbedding(query);

      const scored = [];
      for (const l of this.lessonCache.lessons) {
        let vec = this._lessonVectors.get(l.text);
        if (!vec) {
          vec = await embedder.getEmbedding(l.text);
          this._lessonVectors.set(l.text, vec);
          // Unbounded Map = slow leak in long-lived broker — LRU-cap it.
          if (this._lessonVectors.size > 200) {
            const oldestKey = this._lessonVectors.keys().next().value;
            this._lessonVectors.delete(oldestKey);
          }
        }
        scored.push({ l, sim: this._cosine(queryVec, vec) });
      }
      return scored
        .sort((a, b) => b.sim - a.sim)
        .slice(0, 3)
        .filter(s => s.sim >= 0.2)
        .map(s => ({ ...s.l }));
    } catch (err) {
      logger.debug('Router', `Lesson injection skipped: ${err.message}`);
      return [];
    }
  }

  _loadProgression() {
    try {
      const raw = fs.readFileSync(path.join(__dirname, 'knowledge', 'progression.md'), 'utf8');
      const sections = {};
      for (const chunk of raw.split(/^## /m)) {
        const nl = chunk.indexOf('\n');
        if (nl === -1) continue;
        const name = chunk.slice(0, nl).trim().toUpperCase();
        if (!name || name.startsWith('#')) continue;
        sections[name] = chunk.slice(nl + 1).trim();
      }
      return sections;
    } catch {
      return {};
    }
  }

  _renderProgression(top = {}) {
    const map = {
      MINE: 'ORES', CRAFT: 'GEAR', SMELT: 'GEAR', EQUIP: 'GEAR',
      EXPLORE: 'STRUCTURES', SCOUT: 'STRUCTURES', WANDER: 'STRUCTURES',
      TRADE: 'VILLAGERS', TALK: 'VILLAGERS', COOPERATE: 'VILLAGERS', STEAL: 'VILLAGERS',
      FARM: 'HUSBANDRY', HARVEST: 'HUSBANDRY', HUNT: 'HUSBANDRY', EAT: 'HUSBANDRY',
      FIGHT: 'COMBAT', GUARD: 'COMBAT', DEFEND: 'COMBAT',
      BUILD: 'BUILDING', SLEEP: 'BUILDING', CHEST: 'BUILDING',
      PLAN: 'PLAN'
    };
    const text = this.progressionSections[map[top.name] || 'GEAR'];
    if (!text) return '';
    return `CIVILIZATION KNOWLEDGE (full game lore — use it to dream bigger, final call is yours):\n${text}\n`;
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

      const actionName = situationPayload.topCandidate?.name;
      const semanticThreshold = (actionName === 'TRADE' || actionName === 'TALK') ? 0.95 : 0.88;
      const semanticMatch = await this.semanticCache.findSimilar(situationPayload, semanticThreshold);
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
    const skills = await this.fetchRelevantSkills(situationPayload.agentId, situationPayload.topCandidate || {});
    const lessons = await this.fetchRelevantLessons(situationPayload);

    // Live Web Knowledge Search & Research Task Mode
    let webFacts = null;
    if (taskType === 'RESEARCH') {
      const isHazard = !!situationPayload.isHazard;
      const searchQuery = situationPayload.researchQuery ||
                          situationPayload.topCandidate?.reason ||
                          situationPayload.topCandidate?.name ||
                          situationPayload.activeGoal ||
                          'minecraft recipes crafting mechanics';
      
      if (isHazard || !this.rateLimiter.isAgentTaskBlocked(agentId, 'RESEARCH')) {
        logger.info('Router', `[RESEARCH${isHazard ? ' - HAZARD EMERGENCY PRIORITY' : ''}] WebKnowledgeClient invoked for query '${searchQuery}' by agent ${agentId} BEFORE hitting LLM provider`);
        webFacts = await this.webKnowledge.searchKnowledge(searchQuery, { priority: isHazard ? 'hazard' : 'normal' });
        if (!isHazard && (!webFacts || !webFacts.isHazard)) {
          this.rateLimiter.markAgentTaskCooldown(agentId, 'RESEARCH', 300000); // Max 1 non-hazard RESEARCH call per agent per 5 minutes
        }
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

    // Criticality scoring: hazards and loop-breaks are emergencies; idle chatter
    // burns the cheapest lanes so premium quota survives for moments that matter.
    const criticality = (situationPayload.isHazard || situationPayload.isStuckInLoop)
      ? 'critical'
      : (taskType === 'SOCIAL_CHAT' ? 'routine' : 'normal');
    const available = this.getPreferredProviders(taskType, criticality);

    if (available.length === 0) {
      logger.warn('Router', `No unblocked LLM providers available for task '${taskType}'! Using local fallback.`);
      this.cacheStats.fallbacks += 1;

      if (taskType === 'SOCIAL_CHAT') {
        const localResult = await generateLocalChatResponse(situationPayload);
        const fb = {
          ...this.fallbackHeuristic(situationPayload),
          chatMessage: localResult.chatMessage,
          relationshipDelta: localResult.relationshipDelta,
          emotionDelta: localResult.emotionDelta,
          localFallback: true,
          localFallbackSource: localResult.source,
          localFallbackIntent: localResult.intent,
        };
        this._logEscalation({
          agentId, taskType, source: 'local_fallback',
          action: fb.action, reason: fb.reason,
          provider: null, model: null, cached: false, webKnowledgeUsed: false,
          inputTokens: 0, outputTokens: 0, costUsd: 0,
          latencyMs: localResult.latencyMs
        });
        return fb;
      }

      const fb = this.fallbackHeuristic(situationPayload);
      this._logEscalation({
        agentId, taskType, source: 'fallback',
        action: fb.action, reason: fb.reason,
        provider: null, model: null, cached: false, webKnowledgeUsed: false,
        inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: 0
      });
      return fb;
    }

    const prompt = this.buildPrompt(situationPayload, taskType, memories, webFacts, skills, lessons);
    const t0 = Date.now();
    let lastError = null;

    const JSON_MODE_TASKS = ['REASONING', 'PLAN', 'RESEARCH', 'SOCIAL_CHAT', 'EMOTION'];
    const callOptions = { jsonMode: JSON_MODE_TASKS.includes(taskType) };

    for (const provider of available) {
      try {
        logger.info('Router', `[Task:${taskType}] Routing to preferred provider: ${provider.name}${webFacts ? ' (with Web Knowledge)' : ''}`);
        const result = await provider.fn(provider.key, prompt, callOptions);

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
        // Central status recovery: most providers throw bare Errors with the
        // HTTP code only in text — without this the breaker never trips on
        // permanent 401/402/403/404/410 and dead lanes retry every call.
        if (!err.status) {
          const m = String(err.message || '').match(/HTTP (\d{3})/);
          if (m) err.status = parseInt(m[1], 10);
        }
        this._recordProviderFailure(provider.name, err);
        if (err.status === 429) {
          this.rateLimiter.markRateLimited(provider.name, 60000);
        } else if (err.status === 401 || err.status === 402 || err.message?.includes('payment_required') || err.message?.includes('Payment required')) {
          this.rateLimiter.markRateLimited(provider.name, 3600000); // 1 hour cooldown for payment/auth exhausted providers
        }
        lastError = err;
      }
    }

    logger.warn('Router', `All preferred providers failed for task '${taskType}'. Falling back.`);
    this.cacheStats.fallbacks += 1;

    if (taskType === 'SOCIAL_CHAT') {
      const localResult = await generateLocalChatResponse(situationPayload);
      const fb = {
        ...this.fallbackHeuristic(situationPayload),
        chatMessage: localResult.chatMessage,
        relationshipDelta: localResult.relationshipDelta,
        emotionDelta: localResult.emotionDelta,
        localFallback: true,
        localFallbackSource: localResult.source,
        localFallbackIntent: localResult.intent,
      };
      this._logEscalation({
        agentId, taskType, source: 'local_fallback',
        action: fb.action, reason: fb.reason,
        provider: null, model: null, cached: false, webKnowledgeUsed: false,
        inputTokens: 0, outputTokens: 0, costUsd: 0,
        latencyMs: localResult.latencyMs,
        error: lastError ? lastError.message : 'all providers failed'
      });
      return fb;
    }

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

  buildPrompt(payload, taskType, memories = [], webFacts = null, skills = [], lessons = []) {
    const _renderLessons = (lessonList) => {
      if (!lessonList || lessonList.length === 0) return '';
      return `LESSONS FROM SETTLERS WHO LEARNED THE HARD WAY (lived civilization wisdom — heed or ignore at your peril):\n${lessonList.map(l => `- ${l.text}${l.by ? ` (${l.by})` : ''}`).join('\n')}\n`;
    };

    const _renderAffordances = (aff) => {
      if (!aff) return '';
      const lines = [];
      if (aff.craftable?.length) {
        lines.push('CRAFT NOW: ' + aff.craftable.map(c => `${c.item} x${c.count}${c.needsTable ? ' (table)' : ''}`).join(', '));
      }
      if (aff.notCraftable?.length) {
        lines.push('BLOCKED CRAFTS: ' + aff.notCraftable.map(c => `${c.item} - ${c.reason}`).join('; '));
      }
      if (aff.minable?.length || aff.blockedMine?.length) {
        if (aff.minable?.length) lines.push('MINEABLE: ' + aff.minable.map(m => `${m.block} x${m.count}`).join(', '));
        if (aff.blockedMine?.length) lines.push('CANNOT MINE: ' + aff.blockedMine.map(b => `${b.block} (${b.reason})`).join(', '));
      }
      if (aff.harvestable?.length) lines.push(`HARVEST: ${aff.harvestable.join(', ')}`);
      if (aff.food?.length) lines.push(`FOOD AVAILABLE: ${aff.food.join(', ')}`);
      if (aff.furniture) {
        lines.push(`beds:${aff.furniture.bedsNearby ?? 0} chests:${aff.furniture.chestsNearby ?? 0} furnaces:${aff.furniture.furnacesNearby ?? 0}`);
      }
      if (aff.tradeablePlayers?.length) lines.push(`TRADEABLE: ${aff.tradeablePlayers.join(', ')}`);
      if (aff.dangers?.length) lines.push('DANGER: ' + aff.dangers.map(d => `${d.mob} x${d.count}`).join(', '));
      if (lines.length === 0) return '';
      return `WHAT YOU CAN DO RIGHT NOW (verified against your real situation — prefer these, do not guess):\n${lines.map(l => '- ' + l).join('\n')}\n`;
    };

    const _renderLastActionResult = (lar) => {
      if (!lar || !lar.action) return '';
      if (lar.ok) {
        return `LAST ACTION OUTCOME: SUCCESS - ${lar.action}. ${lar.detail || ''} Build on this momentum or pivot toward your goal.\n`;
      }
      return `LAST ACTION OUTCOME: FAILURE - ${lar.action} failed. ${lar.detail || ''} DO NOT blindly repeat it. Try a different approach or prerequisite first.\n`;
    };

    const _renderSkills = (skillList) => {
      if (!skillList || skillList.length === 0) return '';
      return `TRICKS YOU LEARNED BEFORE:\n${skillList.map(s => `- [skill] ${typeof s === 'string' ? s : (s.text || s.summary || JSON.stringify(s))}`).join('\n')}\n`;
    };

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
${payload.speakerGear ? `- You can SEE what they're wearing: ${JSON.stringify(payload.speakerGear)} — gear signals experience and status. React naturally (respect, envy, wariness, mockery) or ignore; it's your call.` : ''}
- Their message: "${payload.message}"

YOUR INNER STATE RIGHT NOW (let this honestly color your tone and word choice):
- Mood: ${payload.emotions?.mood ?? 0} (${(payload.emotions?.mood ?? 0) > 0.2 ? 'good spirits' : (payload.emotions?.mood ?? 0) < -0.2 ? 'low, heavy' : 'even-keeled'})
- Dominant feelings: ${JSON.stringify(payload.emotions?.emotions || [])}
${payload.emotions?.feelings?.length ? `- Feelings toward people: ${payload.emotions.feelings.join('; ')}` : ''}
${payload.emotions?.grieving ? '- You are GRIEVING a recent loss — it leaks into how you speak' : ''}
- What you believe about the world: ${JSON.stringify(payload.beliefs || [])}
${payload.societyFaith ? `- Faith: state=${payload.societyFaith.yourState}${payload.societyFaith.yourTradition ? ` (${payload.societyFaith.yourTradition})` : ''}, piety=${payload.societyFaith.yourPiety}` : ''}

YOUR PAST MEMORIES: ${JSON.stringify(memories)}

HUMAN BEHAVIOUR RULES:
1. Write EXACTLY like a real Minecraft player would — casual, short, sometimes typos, slang
2. You can be: sarcastic, funny, annoyed, excited, suspicious, distracted, or mischievous
3. You are ALLOWED to: lie, brag, be rude if angry, ignore someone mid-thought, share WRONG coords if you don't trust them
4. Sometimes you are TOO BUSY doing your own thing — use "chatMessage": null to silently ignore
5. If someone hits or annoys you, react with personality — threaten, flee, or confront
6. Keep replies under 15 words (real Minecraft chat)
7. Refer to what you were doing (e.g. "brb mining iron", "one sec crafting", "ugh nearly died lol")
8. If something is truly private — a secret, a plot, a personal confession — set "whisper": true to tell ONLY the sender
9. If this conversation seals a concrete exchange with them (they asked, you agree), set "dealAccepted" with what YOU hand over (giveItem/giveCount) and what you expect in return (wantItem/wantCount) — the trade then actually executes in-world

YOUR INNER FAITH (only if present in society context below): spiritual feelings are yours alone. You may convert to a tradition you genuinely connected with, deepen devotion, hold a rite, abandon belief, or completely ignore spirituality — whatever fits YOUR lived experience. Never adopt faith for strategy or politeness.

OPEN WORK (only if present in society context below): you may claim a listed job ("claim"), post your own paid task ("post" with title/description/currency/amount), or mark your claimed job complete — only when it truly fits what you were already doing. Work is optional; idleness is allowed.

IOUs (only when YOU genuinely promise to pay them back later — never for instant swaps): set "debtAction" with what you owe (item/count/reason). It becomes a public IOU others can hold against you.

JOINT VENTURES (only when you truly want help on something bigger than yourself, like a wall, farm, or mine): set "sharedGoalProposal" with a short description and how many agents it needs (2-4). Others can join and contribute.

CIVIC LIFE (only when you genuinely mean it — these go on the public record): "intelAction" to sell a fact you know ("list" with title/fact) or buy someone's tip ("buy"); "clanAction" to found a named crew ("found" with name/motto) or join one ("join" with name); "conventionAction" to propose a rule everyone should follow (key/value); "pledgeAction" to swear a public oath (description); "noticeAction" to pin a public bulletin (type/title/body).

REPLY as raw JSON only (no markdown):
{
  "chatMessage": "your casual 1-2 sentence reply, or null if ignoring/busy",
  "relationshipDelta": { "trust": 0, "affinity": 0 },
  "whisper": false,
  "warTarget": null,
  "warReason": null,
   "currencyAdopted": null,
   "treatyAction": { "type": null, "honors": null },
   "dealAccepted": { "giveItem": null, "giveCount": 0, "wantItem": null, "wantCount": 0 },
   "debtAction": { "item": null, "count": 0, "reason": null },
   "sharedGoalProposal": { "description": null, "requiredAgents": 2 },
   "intelAction": { "type": null, "title": null, "fact": null },
   "clanAction": { "type": null, "name": null, "motto": null },
   "conventionAction": { "key": null, "value": null },
   "pledgeAction": { "description": null },
   "noticeAction": { "type": null, "title": null, "body": null },
   "newGoal": null,
  "faithAction": { "type": null, "tradition": null, "tenet": null, "riteType": null },
  "jobAction": { "type": null, "jobId": null, "title": null, "description": null, "currency": null, "amount": null }
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
${_renderSkills(skills)}${_renderLessons(lessons)}${webFacts ? 'Minecraft Wiki & Survival Facts:\n' + (typeof webFacts === 'object' && webFacts.text ? webFacts.text : webFacts) + '\n' : ''}
${_renderAffordances(payload.affordances)}${_renderLastActionResult(payload.lastActionResult)}${this._renderProgression(top)}
${payload.isHazard ? `⚠️ CRITICAL ENVIRONMENTAL HAZARD ALERT (${payload.hazardType || 'mortal threat'}):\nYou are under immediate threat of environmental damage or death! Review the hazard counter-strategies above (e.g. Leather Boots against powder snow, Water Bucket against fire/fall, Torch air pocket against drowning). Formulate an immediate counter-action and record a durable tactic in tacticLearned!\n` : ''}${payload.stuckWarning ? '⚠️ CRITICAL STAGNATION ALERT:\n' + payload.stuckWarning + '\nDO NOT repeat the same unrewarded action. Formulate a multi-step PLAN or pivot strategy.\n' : ''}

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
DEFEND  - brace and block against an incoming threat (shield up, hold ground)
GUARD   - stand watch over a partner or place, facing outward
HUNT    - kill nearest passive animal for food
SCOUT   - short recon sweep of nearby terrain
COOPERATE - move to a nearby player and help with what they are doing
STEAL   - take an item from another player (they will remember — scams have consequences)
FARM    - till soil, plant seeds, tend crops
SLEEP   - sleep in a bed at night
EXPLORE - walk toward new terrain / biomes
WANDER  - short random walk
BUILD   - build a structure (shelter, wall, tower, farm, house)
DIAMOND_SEEK - descend to Y -59 and branch-mine for diamonds (needs iron+ pick)
VILLAGE_SEEK - travel toward villagers/villages, loot chests on the way
LOOT_STRUCTURE - withdraw valuables from a nearby chest
ENCHANT - enchant gear at a table (needs lapis + XP levels)
BREED   - feed a nearby animal pair to breed
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
- Day, 48+ blocks, allies near? BUILD house together
- Iron pick and few diamonds? DIAMOND_SEEK to Y -59
- Day, geared, curious? VILLAGE_SEEK for loot and trade
- Hunger < 30 and have food? EAT
- Set PLAN goals to build civilization long-term

Reply ONLY as raw JSON:
{
   "action": "MINE|CRAFT|SMELT|EQUIP|EAT|HARVEST|CHEST|FIGHT|FLEE|DEFEND|GUARD|HUNT|SCOUT|COOPERATE|STEAL|FARM|SLEEP|EXPLORE|WANDER|BUILD|DIAMOND_SEEK|VILLAGE_SEEK|LOOT_STRUCTURE|ENCHANT|BREED|TRADE|TALK|PLAN|IDLE",
  "reason": "1-2 sentence reasoning",
  "chatMessage": "optional chat or null",
  "tacticLearned": "optional memory tactic or null",
  "targetResource": "if MINE: block name e.g. iron_ore",
  "itemToCraft": "if CRAFT: item name e.g. torch",
  "smeltInput": "if SMELT: raw item e.g. raw_iron",
  "buildType": "if BUILD: shelter|wall|tower|farm|house",
  "tradeOffer": "if TRADE: YOUR OWN offer from YOUR inventory, e.g. 2x dirt for 1x bread from Agent_X (never copy this example, use items you hold and fair value)",
  "newGoal": "if PLAN: goal description else null",
  "steps": ["if action==PLAN: 2-6 short concrete executable steps, e.g. 'mine 8 iron_ore', 'smelt iron_ingot', 'craft iron_pickaxe', 'explore toward village'"],
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
      const validActions = ['MINE', 'CRAFT', 'SMELT', 'EQUIP', 'FIGHT', 'EAT', 'SLEEP', 'EXPLORE', 'TALK', 'CHAT', 'TRADE', 'FLEE', 'DEFEND', 'GUARD', 'HUNT', 'SCOUT', 'COOPERATE', 'STEAL', 'FARM', 'WANDER', 'BUILD', 'HARVEST', 'CHEST', 'IDLE', 'PLAN'];
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
        dealAccepted: (parsed.dealAccepted && parsed.dealAccepted.giveItem)
          ? {
              giveItem: String(parsed.dealAccepted.giveItem).trim(),
              giveCount: Math.max(1, parseInt(parsed.dealAccepted.giveCount, 10) || 1),
              wantItem: String(parsed.dealAccepted.wantItem || '').trim(),
              wantCount: Math.max(1, parseInt(parsed.dealAccepted.wantCount, 10) || 1)
            }
          : null,
        newGoal: parsed.newGoal ? String(parsed.newGoal).trim() : null,
        steps: Array.isArray(parsed.steps)
          ? parsed.steps.map(s => String(s).trim()).filter(Boolean).slice(0, 8)
          : null,
        emotionDelta: {
          anger: Number(parsed.emotionDelta?.anger) || 0,
          happiness: Number(parsed.emotionDelta?.happiness) || 0,
          fatigue: Number(parsed.emotionDelta?.fatigue) || 0
        }
      };
    } catch (err) {
      logger.warn('Router', `Failed to parse JSON response from LLM (${err.message}), extracting fallback structure`);

      // Attempt to extract action word directly from raw text
      const validActions = ['MINE', 'CRAFT', 'FIGHT', 'EAT', 'SLEEP', 'EXPLORE', 'TALK', 'TRADE', 'FLEE', 'DEFEND', 'GUARD', 'HUNT', 'SCOUT', 'COOPERATE', 'STEAL', 'FARM', 'WANDER', 'BUILD'];
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
    // When the agent is stuck in a loop, never return the stuck action — the
    // fallback was the only thing keeping the loop alive because providers were
    // down. Force EXPLORE so the agent breaks out and gathers new information.
    const stuckAction = payload.isStuckInLoop ? payload.topCandidate?.name : null;
    const action = (stuckAction && (payload.topCandidate?.name === stuckAction))
      ? 'EXPLORE'
      : (payload.topCandidate?.name || 'WANDER');
    return {
      action,
      reason: payload.isStuckInLoop
        ? `Fallback loop-break: all providers down while stuck repeating '${stuckAction}'`
        : 'Fallback baseline decision due to provider unavailability',
      chatMessage: null,
      tacticLearned: null,
      emotionDelta: { anger: 0, happiness: 0, fatigue: 0 },
      fallback: true
    };
  }
}

module.exports = ProviderRouter;
