const evaluateEat = require('./rules/eat');
const evaluateFlee = require('./rules/flee');
const evaluateFight = require('./rules/fight');
const evaluateSleep = require('./rules/sleep');
const evaluateMine = require('./rules/mine');
const evaluateCraft = require('./rules/craft');
const evaluateExplore = require('./rules/explore');
const evaluateTrade = require('./rules/trade');
const evaluateTalk = require('./rules/talk');
const evaluateCooperate = require('./rules/cooperate');
const evaluateFarm = require('./rules/farm');
const DynamicRuleEngine = require('./dynamicRules');
const ConfidenceEvaluator = require('./confidence');
const EscalationManager = require('./escalate');
const logger = require('../../shared/logger');

class DecisionTree {
  constructor(threshold = 0.6, memoryClient = null, brainClient = null) {
    this.confidenceEvaluator = new ConfidenceEvaluator(threshold);
    this.escalator = new EscalationManager(brainClient);
    this.dynamicRuleEngine = new DynamicRuleEngine(memoryClient);
  }

  async evaluate(senses, statsManager, persona = null, agentState = {}) {
    const stats = statsManager.getSummary();

    if (!this._evalCount) this._evalCount = 0;
    this._evalCount++;
    if (this._evalCount % 30 === 0) {
      const agentId = senses.bot?.username || persona?.agentId || 'Agent';
      this.dynamicRuleEngine.pollRuleAdjustments(agentId, process.env.MEMORY_SERVICE_URL || 'http://localhost:3002');
    }

    const staticCandidates = [
      evaluateFlee(senses, stats),
      evaluateEat(senses, stats),
      evaluateFight(senses, stats),
      evaluateSleep(senses, stats, persona, agentState),
      evaluateCraft(senses, stats),
      evaluateMine(senses, stats),
      evaluateExplore(senses, stats),
      evaluateTrade(senses, stats, persona, agentState),
      evaluateTalk(senses, stats, persona, agentState),
      evaluateCooperate(senses, stats, persona, agentState),
      evaluateFarm(senses, stats, persona, agentState)
    ];

    // Include dynamically learned rules
    const dynamicCandidates = this.dynamicRuleEngine.evaluateDynamicRules(senses, stats);
    const rawCandidates = [...staticCandidates, ...dynamicCandidates];

    // Apply persona trait biases so different agents make distinct behavioral choices
    const candidates = rawCandidates.map(c => {
      let conf = c.confidence;
      if (persona && persona.traits) {
        const tr = persona.traits;
        if (c.name === 'EXPLORE') conf += (tr.curiosity - 0.5) * 0.25;
        if (c.name === 'FLEE') conf += (tr.caution - 0.5) * 0.20;
        if (c.name === 'CRAFT') conf += (tr.caution - 0.5) * 0.18 + (tr.curiosity - 0.5) * 0.10;
        if (c.name === 'MINE') conf += (tr.ambition - 0.5) * 0.20 + (tr.greed - 0.5) * 0.15;
        if (c.name === 'TRADE' || c.name === 'TALK') conf += (tr.sociability - 0.5) * 0.25 + (tr.greed - 0.5) * 0.15;
        if (c.name === 'FIGHT') conf += (0.5 - tr.caution) * 0.20 + (tr.ambition - 0.5) * 0.15;
      }
      return { ...c, confidence: Math.min(0.99, Math.max(0.01, Number(conf.toFixed(2)))) };
    });

    // Sort by highest confidence
    candidates.sort((a, b) => b.confidence - a.confidence);
    const topCandidate = candidates[0];

    logger.info('DecisionTree', `Evaluated top action '${topCandidate.name}' with confidence ${topCandidate.confidence} (${topCandidate.reason}) [Learned Rules: ${this.dynamicRuleEngine.getRulesCount()}]`);

    if (this.confidenceEvaluator.shouldEscalate(topCandidate.confidence)) {
      const isResearchNeeded = (
        topCandidate.name === 'CRAFT' ||
        topCandidate.name === 'BUILD' ||
        topCandidate.reason?.toLowerCase().includes('unknown') ||
        topCandidate.reason?.toLowerCase().includes('recipe') ||
        topCandidate.reason?.toLowerCase().includes('ingredient') ||
        topCandidate.reason?.toLowerCase().includes('cooldown') ||
        topCandidate.reason?.toLowerCase().includes('fail') ||
        agentState.activeGoal?.toLowerCase().includes('craft') ||
        agentState.activeGoal?.toLowerCase().includes('build')
      );

      const taskType = topCandidate.name === 'TALK' ? 'CHAT' : (isResearchNeeded ? 'RESEARCH' : 'REASONING');
      const taskHint = isResearchNeeded ? 'RESEARCH' : null;
      
      const payload = {
        agentId: senses.bot?.username || persona?.agentId || 'Agent',
        taskType,
        taskHint,
        topCandidate,
        allCandidates: candidates,
        stats,
        // Full environmental context for rich LLM reasoning
        inventory: agentState.inventory || [],
        position: agentState.position || {},
        biome: agentState.biome || 'unknown',
        timeOfDay: agentState.timeOfDay || 'day',
        isNight: agentState.isNight || false,
        isRaining: agentState.isRaining || false,
        activeGoal: agentState.activeGoal || '',
        nearby: {
          players: senses.getNearbyPlayers ? senses.getNearbyPlayers(32).map(p => p.username) : [],
          hostiles: senses.getNearbyHostileMobs ? senses.getNearbyHostileMobs(16).map(m => m.name || m.mobType || 'mob') : [],
          animals: senses.getNearbyPassiveMobs ? senses.getNearbyPassiveMobs(16).map(m => m.name || m.mobType || 'animal') : [],
          ores: senses.getNearbyOres ? senses.getNearbyOres(20).map(b => `${b.name}@Y${b.position.y}`) : [],
          trees: senses.getNearbyTrees ? senses.getNearbyTrees(16).map(b => `${b.name}@Y${b.position.y}`) : [],
          blocks: [
            senses.getNearbyBlock('crafting_table', 8) ? 'crafting_table nearby' : null,
            senses.getNearbyBlock('furnace', 8) ? 'furnace nearby' : null,
            senses.getNearbyBlock('chest', 12) ? 'chest nearby' : null,
            senses.getNearbyBlock('bed', 10) ? 'bed nearby' : null,
            senses.getNearbyBlock('water', 8) ? 'water nearby' : null
          ].filter(Boolean)
        },
        equipment: agentState.equipment || {},
        lightLevel: senses.getLightLevel ? senses.getLightLevel() : 15,
        isUnderground: senses.isUnderground ? senses.isUnderground() : false,
        recentEvents: (agentState.recentDecisions || []).slice(-5).map(d => `${d.action}(${d.source})`).join(' → '),
        persona: persona?.getPersonaPromptContext ? persona.getPersonaPromptContext() : (persona || {})
      };

      const escalationResult = await this.escalator.escalate(payload);

      // Replicate learned decision into local dynamic rule engine and long-term skills.md!
      this.dynamicRuleEngine.learnRule(payload, escalationResult);

      // Apply emotion updates if returned by LLM
      if (escalationResult.emotionDelta) {
        if (escalationResult.emotionDelta.anger) statsManager.addAnger(escalationResult.emotionDelta.anger);
        if (escalationResult.emotionDelta.happiness) statsManager.addHappiness(escalationResult.emotionDelta.happiness);
        if (escalationResult.emotionDelta.fatigue) statsManager.addFatigue(escalationResult.emotionDelta.fatigue);
      }

      const isCached = !!escalationResult.cached;
      const isFallback = !!escalationResult.fallback;
      const source = isCached ? 'cache' : (isFallback ? 'fallback' : 'llm');

      return {
        action: escalationResult.action || 'WANDER',
        confidence: topCandidate.confidence,
        escalated: true,
        source,
        provider: escalationResult.provider || (isCached ? 'Cache' : isFallback ? 'Local Fallback' : 'Broker'),
        model: escalationResult.model || null,
        cached: isCached,
        cacheType: escalationResult.cacheType || null,
        fallback: isFallback,
        costUsd: typeof escalationResult.costUsd === 'number' ? escalationResult.costUsd : null,
        latencyMs: typeof escalationResult.latencyMs === 'number' ? escalationResult.latencyMs : null,
        webKnowledgeUsed: !!escalationResult.webKnowledgeUsed,
        reason: escalationResult.reason || 'Escalated to LLM for autonomous reasoning',
        tacticLearned: escalationResult.tacticLearned || null,
        chatMessage: escalationResult.chatMessage || null,
        newGoal: escalationResult.newGoal || null,
        targetResource: escalationResult.targetResource || null,
        buildType: escalationResult.buildType || null,
        tradeOffer: escalationResult.tradeOffer || null,
        meta: {
          ...topCandidate,
          itemToCraft: escalationResult.itemToCraft || topCandidate.itemToCraft,
          targetBlock: topCandidate.targetBlock || null,
          threat: topCandidate.threat || null,
          target: topCandidate.target || null
        },
        allCandidates: candidates.map(c => ({
          name: c.name,
          confidence: c.confidence,
          reason: c.reason || '',
          isDynamic: !!c.isDynamic
        }))
      };
    }

    return {
      action: topCandidate.name,
      confidence: topCandidate.confidence,
      escalated: false,
      source: topCandidate.isDynamic ? 'learned_rule' : 'builtin_rule',
      provider: null,
      model: null,
      cached: false,
      cacheType: null,
      fallback: false,
      costUsd: 0,
      latencyMs: 0,
      reason: topCandidate.reason || '',
      ruleId: topCandidate.ruleId || topCandidate.meta?.ruleId || null,
      meta: topCandidate,
      allCandidates: candidates.map(c => ({
        name: c.name,
        confidence: c.confidence,
        reason: c.reason || '',
        isDynamic: !!c.isDynamic,
        ruleId: c.ruleId || c.meta?.ruleId || null
      }))
    };
  }
}

module.exports = DecisionTree;
