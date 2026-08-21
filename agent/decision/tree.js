const evaluateEat = require('./rules/eat');
const evaluateFlee = require('./rules/flee');
const evaluateFight = require('./rules/fight');
const evaluateSleep = require('./rules/sleep');
const evaluateMine = require('./rules/mine');
const ConfidenceEvaluator = require('./confidence');
const EscalationManager = require('./escalate');
const logger = require('../../shared/logger');

class DecisionTree {
  constructor(threshold = 0.6) {
    this.confidenceEvaluator = new ConfidenceEvaluator(threshold);
    this.escalator = new EscalationManager();
  }

  async evaluate(senses, statsManager) {
    const stats = statsManager.getSummary();

    const candidates = [
      evaluateFlee(senses, stats),
      evaluateEat(senses, stats),
      evaluateFight(senses, stats),
      evaluateSleep(senses, stats),
      evaluateMine(senses, stats)
    ];

    // Sort by highest confidence
    candidates.sort((a, b) => b.confidence - a.confidence);
    const topCandidate = candidates[0];

    logger.info('DecisionTree', `Evaluated top action '${topCandidate.name}' with confidence ${topCandidate.confidence} (${topCandidate.reason})`);

    if (this.confidenceEvaluator.shouldEscalate(topCandidate.confidence)) {
      logger.warn('DecisionTree', `Top action confidence (${topCandidate.confidence}) is below threshold (${this.confidenceEvaluator.threshold}). Triggering Escalation.`);
      const escalationResult = await this.escalator.escalate({
        topCandidate,
        allCandidates: candidates,
        stats
      });

      if (escalationResult.chatMessage) {
        logger.info('DecisionTree', `Escalation suggested chat message: "${escalationResult.chatMessage}"`);
      }

      return {
        action: escalationResult.action || 'WANDER',
        confidence: topCandidate.confidence,
        escalated: true,
        chatMessage: escalationResult.chatMessage,
        meta: topCandidate
      };
    }

    return { action: topCandidate.name, confidence: topCandidate.confidence, escalated: false, meta: topCandidate };
  }
}

module.exports = DecisionTree;
