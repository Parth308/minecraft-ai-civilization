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
const buildAffordances = require('../perception/affordances');
const DynamicRuleEngine = require('./dynamicRules');
const ConfidenceEvaluator = require('./confidence');
const EscalationManager = require('./escalate');
const SocietyClient = require('../memory/societyClient');
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
      evaluateFight(senses, stats, persona),
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

    // Action loop & stagnation detector: prevent infinite repetitive actions.
    // FIGHT excluded on purpose — re-selecting combat every cycle is correct behavior.
    if (!this._actionHistory) this._actionHistory = [];
    this._actionHistory.push(topCandidate.name);
    if (this._actionHistory.length > 8) this._actionHistory.shift();

    const LOOPABLE_ACTIONS = new Set(['EXPLORE', 'WANDER', 'MINE', 'CRAFT', 'EAT', 'FLEE']);
    const isStuckInLoop = (
      this._actionHistory.length >= 6 &&
      this._actionHistory.every(a => a === topCandidate.name) &&
      LOOPABLE_ACTIONS.has(topCandidate.name)
    );

    if (isStuckInLoop) {
      logger.warn('DecisionTree', `[STUCK LOOP DETECTED] Agent repeated '${topCandidate.name}' 6 consecutive cycles without progress. Escalating to high-level PLAN.`);
      this._actionHistory = [];
    }

    logger.info('DecisionTree', `Evaluated top action '${topCandidate.name}' with confidence ${topCandidate.confidence} (${topCandidate.reason}) [Learned Rules: ${this.dynamicRuleEngine.getRulesCount()}]`);

    // Environmental Hazard Detection & Counter-Strategy Tagging
    const biomeLower = (agentState.biome || senses.getBiome?.() || '').toLowerCase();
    const isColdBiome = biomeLower.includes('snow') || biomeLower.includes('ice') || biomeLower.includes('frozen') || biomeLower.includes('peak') || biomeLower.includes('cold') || biomeLower.includes('grove');
    const isFreezingRisk = isColdBiome && (stats.health < 20 || (topCandidate.reason || '').toLowerCase().includes('snow') || (topCandidate.reason || '').toLowerCase().includes('freeze'));
    const isFireRisk = senses.isOnFire?.() || agentState.isOnFire || (topCandidate.reason || '').toLowerCase().includes('lava') || (topCandidate.reason || '').toLowerCase().includes('fire');
    const isWaterRisk = (senses.isInWater?.() || agentState.isInWater) && (stats.health < 16 || senses.bot?.oxygenLevel < 15);
    const isMobRisk = (senses.getNearbyHostileMobs?.(8)?.length || 0) >= 2 || (stats.health <= 10 && (senses.getNearbyHostileMobs?.(12)?.length || 0) > 0);

    const isHazard = isFreezingRisk || isFireRisk || isWaterRisk || isMobRisk;
    let hazardType = null;
    let hazardResearchQuery = null;

    if (isFreezingRisk) {
      hazardType = 'powder_snow';
      hazardResearchQuery = 'minecraft powder snow freezing damage counter leather boots';
    } else if (isFireRisk) {
      hazardType = 'lava';
      hazardResearchQuery = 'minecraft lava fire damage water bucket counter';
    } else if (isWaterRisk) {
      hazardType = 'drowning';
      hazardResearchQuery = 'minecraft drowning underwater oxygen torch air pocket counter';
    } else if (isMobRisk) {
      hazardType = 'mob_swarm';
      hazardResearchQuery = 'minecraft hostile mob swarm pillar defense tactics';
    }

    // Society knowledge snapshot (cached ~60s). Awareness, not instruction —
    // the LLM decides what conventions/pledges/reputation mean for this choice.
    let societyContext = null;
    try {
      const societyAgentId = senses.bot?.username || persona?.agentId || 'Agent';
      societyContext = await SocietyClient.forAgent(societyAgentId).getContext();
    } catch { /* society knowledge is optional */ }

    if (this.confidenceEvaluator.shouldEscalate(topCandidate.confidence) || isStuckInLoop || isHazard) {
      const isResearchNeeded = isHazard || (
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

      const taskType = isStuckInLoop ? 'PLAN' : (isHazard || isResearchNeeded ? 'RESEARCH' : (topCandidate.name === 'TALK' ? 'CHAT' : 'REASONING'));
      const taskHint = isStuckInLoop ? 'PLAN' : (isHazard || isResearchNeeded ? 'RESEARCH' : null);
      
      const payload = {
        agentId: senses.bot?.username || persona?.agentId || 'Agent',
        taskType,
        taskHint,
        isHazard,
        hazardType,
        researchQuery: hazardResearchQuery || null,
        isStuckInLoop,
        stuckWarning: isStuckInLoop ? `You have been looping on '${topCandidate.name}' for multiple cycles without finding trees/progress. Think like a real human player: break this loop. Formulate a multi-step objective, head towards high elevation/vantage point, punch tall grass for seeds, search near rivers, or find companions.` : null,
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
        lastActionResult: agentState.lastActionResult || null,
        affordances: buildAffordances.build(senses.bot, senses, stats),
        persona: persona?.getPersonaPromptContext ? persona.getPersonaPromptContext() : (persona || {}),
        society: societyContext ? {
          conventions: Object.fromEntries(Object.entries(societyContext.conventions || {}).map(([k, v]) => [k, v.value])),
          openPledges: (societyContext.openPledges || []).slice(0, 8).map(p => `${p.agentId}: ${p.description}`),
          recentNotices: (societyContext.notices || []).slice(0, 4).map(n => `[${n.type}] ${n.title}`),
          reputationHighlights: societyContext.reputationHighlights || []
        } : null
      };

      const escalationResult = await this.escalator.escalate(payload);

      // Replicate learned decision into local dynamic rule engine and long-term skills.md!
      this.dynamicRuleEngine.learnRule(payload, escalationResult);

      // If a severe hazard counter-strategy was learned, immediately seed into dynamic rules and share with ledger
      if (isHazard && escalationResult.tacticLearned) {
        const memUrl = process.env.MEMORY_SERVICE_URL || 'http://localhost:3002';
        fetch(`${memUrl}/api/ledger/lessons`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: senses.bot?.username || 'Agent',
            lesson: `[Hazard Counter-Strategy: ${hazardType || 'survival'}] ${escalationResult.tacticLearned}`,
            isPublic: true,
            severity: 0.90,
            confidence: 0.85,
            context: { isHazard: true, hazardType }
          })
        }).catch(() => {});
      }

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
        reason: escalationResult.reason || (isHazard ? `Autonomous hazard counter-strategy executed for ${hazardType}` : 'Escalated to LLM for autonomous reasoning'),
        tacticLearned: escalationResult.tacticLearned || null,
        chatMessage: escalationResult.chatMessage || null,
        newGoal: escalationResult.newGoal || null,
        steps: escalationResult.steps || null,
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
