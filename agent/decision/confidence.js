const { CONFIDENCE } = require('../../shared/constants');

class ConfidenceEvaluator {
  constructor(threshold = CONFIDENCE.ESCALATION_THRESHOLD) {
    this.threshold = threshold;
  }

  shouldEscalate(confidence) {
    return confidence < this.threshold;
  }

  formatEvaluation(ruleName, confidence, context) {
    return {
      rule: ruleName,
      confidence: parseFloat(confidence.toFixed(2)),
      escalate: this.shouldEscalate(confidence),
      context
    };
  }
}

module.exports = ConfidenceEvaluator;
