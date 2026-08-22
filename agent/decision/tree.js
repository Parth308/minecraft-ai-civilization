const evaluateEat = require('./rules/eat');
const evaluateFlee = require('./rules/flee');
const evaluateFight = require('./rules/fight');
const evaluateSleep = require('./rules/sleep');
const evaluateMine = require('./rules/mine');
const evaluateCraft = require('./rules/craft');
const evaluateExplore = require('./rules/explore');
const evaluateTrade = require('./rules/trade');
const DynamicRuleEngine = require('./dynamicRules');
const ConfidenceEvaluator = require('./confidence');
const EscalationManager = require('./escalate');
const logger = require('../../shared/logger');

class DecisionTree {
  constructor(threshold = 0.6, memoryClient = null) {
    this.confidenceEvaluator = new ConfidenceEvaluator(threshold);
    this.escalator = new EscalationManager();
    this.dynamicRuleEngine = new DynamicRuleEngine(memoryClient);
  }

  async evaluate(senses, statsManager) {
    const stats = statsManager.getSummary();

    const staticCandidates = [
      evaluateFlee(senses, stats),
      evaluateEat(senses, stats),
      evaluateFight(senses, stats),
      evaluateSleep(senses, stats),
      evaluateCraft(senses, stats),
      evaluateMine(senses, stats),
      evaluateExplore(senses, stats),
      evaluateTrade(senses, stats)
    ];

    // Include dynamically learned rules
    const dynamicCandidates = this.dynamicRuleEngine.evaluateDynamicRules(senses, stats);
    const candidates = [...staticCandidates, ...dynamicCandidates];

    // Sort by highest confidence
    candidates.sort((a, b) => b.confidence - a.confidence);
    const topCandidate = candidates[0];

    logger.info('DecisionTree', `Evaluated top action '${topCandidate.name}' with confidence ${topCandidate.confidence} (${topCandidate.reason}) [Learned Rules: ${this.dynamicRuleEngine.getRulesCount()}]`);

    if (this.confidenceEvaluator.shouldEscalate(topCandidate.confidence)) {
      logger.warn('DecisionTree', `Top action confidence (${topCandidate.confidence}) is below threshold (${this.confidenceEvaluator.threshold}). Triggering Escalation.`);
      
      const payload = {
        taskType: topCandidate.name === 'TALK' ? 'CHAT' : 'REASONING',
        topCandidate,
        allCandidates: candidates,
        stats
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
        meta: {
          ...topCandidate,
          itemToCraft: escalationResult.itemToCraft || topCandidate.itemToCraft
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
      meta: topCandidate,
      allCandidates: candidates.map(c => ({
        name: c.name,
        confidence: c.confidence,
        reason: c.reason || '',
        isDynamic: !!c.isDynamic
      }))
    };
  }
}

module.exports = DecisionTree;
