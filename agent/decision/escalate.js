const logger = require('../../shared/logger');

class EscalationManager {
  constructor(brokerClient = null) {
    this.brokerClient = brokerClient;
  }

  escalate(situationContext) {
    logger.warn('Escalate', `[LOW CONFIDENCE ESCALATION] Situation: ${JSON.stringify(situationContext)}`);
    if (this.brokerClient) {
      return this.brokerClient.query(situationContext);
    }
    logger.info('Escalate', 'Broker client not connected yet (Phase 2 mode). Fallback to safe wander/idle.');
    return { action: 'WANDER', fallback: true };
  }
}

module.exports = EscalationManager;
