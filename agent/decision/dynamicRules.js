const logger = require('../../shared/logger');

class DynamicRuleEngine {
  constructor(memoryClient = null) {
    this.learnedRules = [];
    this.memoryClient = memoryClient;
  }

  learnRule(situationPayload, decisionData) {
    if (!decisionData || !decisionData.action || decisionData.fallback) return;

    const action = decisionData.action;
    const situationName = situationPayload.topCandidate?.name || 'GENERIC';
    const ruleId = `learned_${situationName.toLowerCase()}_${this.learnedRules.length + 1}`;

    // Check if rule pattern was already learned
    const existing = this.learnedRules.find(r => r.patternSituation === situationName && r.action === action);
    if (existing) {
      existing.confidence = Math.min(0.95, existing.confidence + 0.05);
      existing.hitCount++;
      logger.info('DynamicRules', `Reinforced existing learned rule ${existing.id} (confidence: ${existing.confidence})`);
      return;
    }

    const newRule = {
      id: ruleId,
      patternSituation: situationName,
      action: action,
      confidence: 0.85,
      reason: `Learned from Broker LLM: ${decisionData.reason || 'Replicated decision'}`,
      hitCount: 1,
      createdAt: new Date().toISOString()
    };

    this.learnedRules.push(newRule);
    logger.info('DynamicRules', `[RULE REPLICATION] Learned dynamic rule ${ruleId} -> Action '${action}' (Confidence: 0.85)`);

    // If tactic statement is returned, record it as a durable skill memory
    if (decisionData.tacticLearned && this.memoryClient) {
      this.memoryClient.flushBuffer([{
        type: 'learnedTactic',
        payload: { tactic: decisionData.tacticLearned, action },
        summary: `[skill] Learned survival tactic: ${decisionData.tacticLearned}`
      }]);
    }
  }

  evaluateDynamicRules(senses, stats) {
    const candidateActions = [];

    for (const rule of this.learnedRules) {
      candidateActions.push({
        name: rule.action,
        confidence: rule.confidence,
        reason: `[Dynamic Learned Rule: ${rule.id}] ${rule.reason}`,
        isDynamic: true
      });
    }

    return candidateActions;
  }

  getRulesCount() {
    return this.learnedRules.length;
  }
}

module.exports = DynamicRuleEngine;
