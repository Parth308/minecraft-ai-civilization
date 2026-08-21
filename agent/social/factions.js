const logger = require('../../shared/logger');

class FactionAffiliationManager {
  constructor(agentId, persona) {
    this.agentId = agentId;
    this.persona = persona;
    this.joinedFactions = []; // ['The Valley Union']
    this.pacts = []; // [{ with: 'Agent_Beta', type: 'non_aggression', honors: true }]
    this.recognizedCurrencies = []; // ['Iron Nugget']
  }

  evaluateTreatyOffer(proposer, treatyType, terms) {
    // Evaluation based on free will & persona
    const trust = this.persona.traits.loyalty;
    const caution = this.persona.traits.caution;

    if (treatyType === 'non_aggression' && caution > 0.3) {
      this.pacts.push({ with: proposer, type: treatyType, honors: true });
      logger.info('Factions', `${this.agentId} accepted non-aggression pact with ${proposer}`);
      return { accepted: true, statement: `I accept our non-aggression treaty, ${proposer}.` };
    }

    if (this.persona.rebellionDisposition > 0.7) {
      return { accepted: false, statement: `I prefer to remain a free agent without treaties, ${proposer}.` };
    }

    return { accepted: true, statement: `Agreed to terms, ${proposer}.` };
  }

  recognizeCurrency(currencyName) {
    if (!this.recognizedCurrencies.includes(currencyName)) {
      this.recognizedCurrencies.push(currencyName);
      logger.info('Factions', `${this.agentId} now accepts currency '${currencyName}'`);
    }
  }
}

module.exports = FactionAffiliationManager;
