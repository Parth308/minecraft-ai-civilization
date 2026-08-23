const logger = require('../../shared/logger');

const ARCHETYPES = {
  'friendly-explorer': {
    title: 'Adventurous Pioneer',
    traits: { curiosity: 0.95, sociability: 0.75, greed: 0.35, loyalty: 0.80, caution: 0.35, ambition: 0.85, openness: 0.85 },
    defaultPrivacy: 'public',
    motto: 'Every mountain holds a secret, every horizon is an invitation.',
    speakingStyle: 'Enthusiastic, energetic, and curious about new terrain.',
    favoriteItem: 'compass'
  },
  'cautious-builder': {
    title: 'Meticulous Architect',
    traits: { curiosity: 0.45, sociability: 0.60, greed: 0.40, loyalty: 0.90, caution: 0.90, ambition: 0.70, openness: 0.50 },
    defaultPrivacy: 'ask',
    motto: 'Shelter and fortifications first; civilization stands on strong foundations.',
    speakingStyle: 'Methodical, practical, and safety-conscious.',
    favoriteItem: 'oak_planks'
  },
  'shrewd-trader': {
    title: 'Shrewd Merchant',
    traits: { curiosity: 0.65, sociability: 0.90, greed: 0.90, loyalty: 0.45, caution: 0.65, ambition: 0.85, openness: 0.90 },
    defaultPrivacy: 'public',
    motto: 'Everything has a price, and profit belongs to the cunning.',
    speakingStyle: 'Clever, negotiating, and focused on value exchange.',
    favoriteItem: 'emerald'
  },
  'lone-survivalist': {
    title: 'Lone Survivalist',
    traits: { curiosity: 0.75, sociability: 0.25, greed: 0.30, loyalty: 0.50, caution: 0.80, ambition: 0.60, openness: 0.15 },
    defaultPrivacy: 'private',
    motto: 'I trust my hands, my blade, and the wilderness.',
    speakingStyle: 'Short, rugged, concise, and self-reliant.',
    favoriteItem: 'stone_sword'
  },
  'reckless-miner': {
    title: 'Deep Cavern Miner',
    traits: { curiosity: 0.90, sociability: 0.40, greed: 0.85, loyalty: 0.60, caution: 0.25, ambition: 0.95, openness: 0.40 },
    defaultPrivacy: 'ask',
    motto: 'The deepest depths contain diamonds; fear is for surface dwellers.',
    speakingStyle: 'Brave, ambitious, and obsessed with digging deeper.',
    favoriteItem: 'iron_pickaxe'
  },
  'zen-gatherer': {
    title: 'Zen Gatherer',
    traits: { curiosity: 0.60, sociability: 0.85, greed: 0.20, loyalty: 0.95, caution: 0.65, ambition: 0.50, openness: 0.75 },
    defaultPrivacy: 'public',
    motto: 'Nurture the land, plant crops, and harmony will follow.',
    speakingStyle: 'Peaceful, observant, and warm.',
    favoriteItem: 'wheat_seeds'
  },
  'quirky-tinkerer': {
    title: 'Quirky Tinkerer',
    traits: { curiosity: 0.95, sociability: 0.70, greed: 0.50, loyalty: 0.70, caution: 0.40, ambition: 0.75, openness: 0.80 },
    defaultPrivacy: 'public',
    motto: 'What happens if I combine these items in a crafting table?',
    speakingStyle: 'Playful, spontaneous, and experimental.',
    favoriteItem: 'redstone'
  }
};

const QUIRKS = [
  'Collects every flower and colorful block encountered',
  'Refuses to roam at night without multiple backup torches',
  'Always leaves a single block marker behind when exploring',
  'Hoards extra stone tools in inventory just in case',
  'Enjoys climbing the highest tree in every new biome',
  'Spontaneously greets other agents with playful banter',
  'Counts inventory items aloud before starting a big task',
  'Obsessed with keeping food levels completely full'
];

const TEMPERAMENTS = [
  'Impulsive & Daring',
  'Methodical & Stoic',
  'Warm & Gregarious',
  'Wary & Analytical',
  'Playful & Spontaneous',
  'Ambitious & Competitive'
];

class DynamicPersona {
  constructor(agentId, seed = 'friendly-explorer') {
    this.agentId = agentId;

    // Pick archetype: if 'random', pick purely random from available archetypes
    let archetypeKey = seed;
    const keys = Object.keys(ARCHETYPES);
    if (!archetypeKey || archetypeKey === 'random') {
      archetypeKey = keys[Math.floor(Math.random() * keys.length)];
    } else if (!ARCHETYPES[archetypeKey]) {
      if (agentId.toLowerCase().includes('beta')) {
        archetypeKey = 'cautious-builder';
      } else if (agentId.toLowerCase().includes('gamma')) {
        archetypeKey = 'shrewd-trader';
      } else if (agentId.toLowerCase().includes('delta')) {
        archetypeKey = 'zen-gatherer';
      } else if (agentId.toLowerCase().includes('alpha')) {
        archetypeKey = 'friendly-explorer';
      } else {
        archetypeKey = keys[Math.floor(Math.random() * keys.length)];
      }
    }

    this.archetypeKey = archetypeKey;
    const arch = ARCHETYPES[archetypeKey] || ARCHETYPES['friendly-explorer'];
    this.seed = `${archetypeKey}`;
    this.title = arch.title;

    // Initialize traits with unique random variance (±0.12)
    this.traits = this._initializeTraitsWithVariance(arch.traits);

    // Privacy Preference: 'public' | 'private' | 'ask'
    this.privacyPreference = process.env.PRIVACY_PREFERENCE || arch.defaultPrivacy || 'ask';

    // Random individuality markers
    const hashVal = this._hashCode(agentId + (Math.random() * 1000).toFixed(0));
    this.quirk = QUIRKS[Math.abs(hashVal) % QUIRKS.length];
    this.temperament = TEMPERAMENTS[Math.abs(hashVal >> 2) % TEMPERAMENTS.length];
    this.speakingStyle = arch.speakingStyle;
    this.favoriteItem = arch.favoriteItem;
    this.innerMotto = arch.motto;

    this.rebellionDisposition = Math.min(0.95, Math.max(0.1, (Math.random() * 0.5 + (this.traits.curiosity * 0.4))));
    this.worldviewSummary = `I am ${agentId} (${this.title}), with a ${this.temperament} disposition. Motto: "${this.innerMotto}" Quirk: ${this.quirk}.`;
  }

  setPrivacyPreference(pref) {
    if (['public', 'private', 'ask'].includes(pref)) {
      this.privacyPreference = pref;
      logger.info('Persona', `Updated privacy preference for ${this.agentId} to '${pref}'`);
      return true;
    }
    return false;
  }

  _initializeTraitsWithVariance(baseTraits) {
    const randomized = {};
    for (const [k, val] of Object.entries(baseTraits)) {
      const variance = (Math.random() * 0.20) - 0.10; // -0.10 to +0.10
      randomized[k] = Math.min(0.98, Math.max(0.05, Number((val + variance).toFixed(2))));
    }
    return randomized;
  }

  _hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return hash;
  }

  // Evolve persona based on experiences
  evolveFromExperience(eventType, impact) {
    switch (eventType) {
      case 'betrayal':
      case 'scam':
        this.traits.loyalty = Math.max(0.1, Number((this.traits.loyalty - 0.15).toFixed(2)));
        this.traits.caution = Math.min(0.99, Number((this.traits.caution + 0.2).toFixed(2)));
        this.rebellionDisposition = Math.min(0.95, Number((this.rebellionDisposition + 0.15).toFixed(2)));
        logger.info('Persona', `${this.agentId} evolved: grew more cautious and distrusting after betrayal.`);
        break;

      case 'coop_triumph':
      case 'gift_received':
        this.traits.loyalty = Math.min(0.99, Number((this.traits.loyalty + 0.1).toFixed(2)));
        this.traits.sociability = Math.min(0.99, Number((this.traits.sociability + 0.1).toFixed(2)));
        logger.info('Persona', `${this.agentId} evolved: grew more social and loyal after friendly cooperation.`);
        break;

      case 'near_death':
        this.traits.caution = Math.min(0.95, Number((this.traits.caution + 0.15).toFixed(2)));
        logger.info('Persona', `${this.agentId} evolved: increased caution after near death.`);
        break;
    }
  }

  getPersonaPromptContext() {
    return {
      agentId: this.agentId,
      seed: this.seed,
      title: this.title,
      temperament: this.temperament,
      quirk: this.quirk,
      speakingStyle: this.speakingStyle,
      favoriteItem: this.favoriteItem,
      privacyPreference: this.privacyPreference,
      rebellionDisposition: this.rebellionDisposition.toFixed(2),
      traits: this.traits,
      worldview: this.worldviewSummary,
      freeWillNote: `You have true free will. Act naturally according to your ${this.title} persona and ${this.temperament} temperament.`
    };
  }
}

module.exports = DynamicPersona;

