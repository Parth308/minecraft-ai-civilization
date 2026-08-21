const logger = require('../../shared/logger');

class DynamicPersona {
  constructor(agentId, seed = 'curious-wanderer') {
    this.agentId = agentId;
    this.seed = seed;
    this.traits = this.initializeTraits(seed);
    this.innerMotto = `I am ${agentId}, a unique individual in this blocky world.`;
    this.rebellionDisposition = Math.random() * 0.6 + 0.2; // 0.2 (conformist) to 0.8 (rebellious/anarchist)
    this.worldviewSummary = `Starting my journey as a ${seed}. Free to forge my own destiny and decide whom to trust.`;
  }

  initializeTraits(seed) {
    const defaultTraits = {
      curiosity: 0.7,
      sociability: 0.6,
      greed: 0.4,
      loyalty: 0.8,
      caution: 0.5,
      ambition: 0.6
    };

    if (seed.includes('explorer')) {
      defaultTraits.curiosity = 0.95;
      defaultTraits.caution = 0.3;
    } else if (seed.includes('builder') || seed.includes('cautious')) {
      defaultTraits.caution = 0.85;
      defaultTraits.curiosity = 0.4;
      defaultTraits.loyalty = 0.9;
    } else if (seed.includes('merchant') || seed.includes('cunning')) {
      defaultTraits.greed = 0.85;
      defaultTraits.sociability = 0.9;
      defaultTraits.loyalty = 0.4;
    }

    return defaultTraits;
  }

  // Evolve persona based on experiences
  evolveFromExperience(eventType, impact) {
    switch (eventType) {
      case 'betrayal':
      case 'scam':
        this.traits.loyalty = Math.max(0.1, this.traits.loyalty - 0.15);
        this.traits.caution = Math.min(0.99, this.traits.caution + 0.2);
        this.rebellionDisposition = Math.min(0.95, this.rebellionDisposition + 0.15);
        logger.info('Persona', `${this.agentId} evolved: grew more cautious and distrusting after betrayal.`);
        break;

      case 'coop_triumph':
      case 'gift_received':
        this.traits.loyalty = Math.min(0.99, this.traits.loyalty + 0.1);
        this.traits.sociability = Math.min(0.99, this.traits.sociability + 0.1);
        logger.info('Persona', `${this.agentId} evolved: grew more social and loyal after friendly cooperation.`);
        break;

      case 'near_death':
        this.traits.caution = Math.min(0.95, this.traits.caution + 0.15);
        logger.info('Persona', `${this.agentId} evolved: increased caution after near death.`);
        break;
    }
  }

  getPersonaPromptContext() {
    return {
      agentId: this.agentId,
      seed: this.seed,
      rebellionDisposition: this.rebellionDisposition.toFixed(2),
      traits: this.traits,
      worldview: this.worldviewSummary,
      freeWillNote: 'You have complete free will. You may choose to conform to server rules/currencies or defy them, start your own rival faction, cheat, cooperate, or explore alone.'
    };
  }
}

module.exports = DynamicPersona;
