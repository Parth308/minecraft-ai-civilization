const logger = require('../../shared/logger');
const BrainClient = require('../brain-client/client');

class EscalationManager {
  constructor(brokerClient = null) {
    this.brokerClient = brokerClient || new BrainClient();
  }

  async escalate(situationContext) {
    logger.warn('Escalate', `[LOW CONFIDENCE ESCALATION] Situation: ${JSON.stringify(situationContext.topCandidate)}`);
    return await this.brokerClient.escalateSituation(situationContext);
  }
}

module.exports = EscalationManager;
