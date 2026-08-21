const logger = require('../../shared/logger');

class BrainClient {
  constructor(brokerUrl = 'http://localhost:3001') {
    this.brokerUrl = brokerUrl;
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
      logger.error('BrainClient', `Failed to query Brain Broker: ${err.message}`);
      return {
        action: situationPayload.topCandidate?.name || 'WANDER',
        reason: 'Broker network connection error',
        fallback: true
      };
    }
  }
}

module.exports = BrainClient;
