const evaluateEat = require('./rules/eat');
const evaluateFlee = require('./rules/flee');
const evaluateFight = require('./rules/fight');
const evaluateSleep = require('./rules/sleep');
const evaluateMine = require('./rules/mine');
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

      return {
        action: escalationResult.action || 'WANDER',
        confidence: topCandidate.confidence,
        escalated: true,
        chatMessage: escalationResult.chatMessage,
        meta: topCandidate,
        allCandidates: candidates.map(c => ({ name: c.name, confidence: c.confidence, reason: c.reason || '' }))
      };
    }

    return { action: topCandidate.name, confidence: topCandidate.confidence, escalated: false, meta: topCandidate, allCandidates: candidates.map(c => ({ name: c.name, confidence: c.confidence, reason: c.reason || '' })) };
  }
}

module.exports = DecisionTree;
