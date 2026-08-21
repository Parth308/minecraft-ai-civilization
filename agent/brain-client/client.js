const logger = require('../../shared/logger');

class BrainClient {
  constructor(brokerUrl = process.env.BROKER_URL || 'http://localhost:3001') {
    this.brokerUrl = brokerUrl;
  }

  async escalate(situationPayload) {
    return this.escalateSituation(situationPayload);
  }

  async escalateSituation(situationPayload) {
    try {
      logger.info('BrainClient', `Sending escalation payload to ${this.brokerUrl}/api/escalate...`);
      const response = await fetch(`${this.brokerUrl}/api/escalate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(situationPayload)
      });

      if (!response.ok) {
        throw new Error(`Broker error HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      logger.info('BrainClient', `Recv broker decision: ${JSON.stringify(data)}`);
      return data;
    } catch (err) {
      logger.warn('BrainClient', `Brain Broker unavailable (${err.message}). Gracefully executing local fallback rule.`);
      return {
        action: situationPayload.topCandidate?.name || 'WANDER',
        reason: `Local rule fallback (Broker offline: ${err.message})`,
        fallback: true,
        chatMessage: null,
        emotionDelta: { anger: 0, happiness: 0, fatigue: 0 }
      };
    }
  }
}

module.exports = BrainClient;
