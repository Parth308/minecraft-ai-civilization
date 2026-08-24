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
  constructor(agentId, seed = 'random') {
    this.agentId = agentId;
    this.seed = seed;

    // True procedural random mode
    if (!seed || seed === 'random' || seed === 'procedural') {
      const procedural = this._generateProceduralPersona(agentId);
      this.archetypeKey = 'procedural';
      this.title = procedural.title;
      this.traits = procedural.traits;
      this.privacyPreference = process.env.PRIVACY_PREFERENCE || procedural.defaultPrivacy;
      this.speakingStyle = procedural.speakingStyle;
      this.favoriteItem = procedural.favoriteItem;
      this.innerMotto = procedural.motto;
      this.temperament = procedural.temperament;
      this.quirk = procedural.quirk;
      this.rebellionDisposition = procedural.rebellionDisposition;
      this.worldviewSummary = `I am ${agentId} (${this.title}), with a ${this.temperament} disposition. Motto: "${this.innerMotto}" Quirk: ${this.quirk}.`;
      return;
    }

    // Template archetype fallback if a specific named seed was explicitly requested
    let archetypeKey = seed;
    if (!ARCHETYPES[archetypeKey]) {
      if (agentId.toLowerCase().includes('beta')) {
        archetypeKey = 'cautious-builder';
      } else if (agentId.toLowerCase().includes('gamma')) {
        archetypeKey = 'shrewd-trader';
      } else if (agentId.toLowerCase().includes('delta')) {
        archetypeKey = 'zen-gatherer';
      } else if (agentId.toLowerCase().includes('alpha')) {
        archetypeKey = 'friendly-explorer';
      } else {
        const procedural = this._generateProceduralPersona(agentId);
        this.archetypeKey = 'procedural';
        this.title = procedural.title;
        this.traits = procedural.traits;
        this.privacyPreference = process.env.PRIVACY_PREFERENCE || procedural.defaultPrivacy;
        this.speakingStyle = procedural.speakingStyle;
        this.favoriteItem = procedural.favoriteItem;
        this.innerMotto = procedural.motto;
        this.temperament = procedural.temperament;
        this.quirk = procedural.quirk;
        this.rebellionDisposition = procedural.rebellionDisposition;
        this.worldviewSummary = `I am ${agentId} (${this.title}), with a ${this.temperament} disposition. Motto: "${this.innerMotto}" Quirk: ${this.quirk}.`;
        return;
      }
    }

    this.archetypeKey = archetypeKey;
    const arch = ARCHETYPES[archetypeKey] || ARCHETYPES['friendly-explorer'];
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

  _generateProceduralPersona(agentId) {
    // 1. Roll 7 completely independent continuous traits (0.08 to 0.96)
    const traits = {
      curiosity: Number((0.10 + Math.random() * 0.85).toFixed(2)),
      sociability: Number((0.10 + Math.random() * 0.85).toFixed(2)),
      greed: Number((0.10 + Math.random() * 0.85).toFixed(2)),
      loyalty: Number((0.10 + Math.random() * 0.85).toFixed(2)),
      caution: Number((0.10 + Math.random() * 0.85).toFixed(2)),
      ambition: Number((0.10 + Math.random() * 0.85).toFixed(2)),
      openness: Number((0.10 + Math.random() * 0.85).toFixed(2))
    };

    // 2. Determine dominant and secondary traits to formulate emergent title
    const sortedTraits = Object.entries(traits).sort((a, b) => b[1] - a[1]);
    const dominant = sortedTraits[0][0];
    const secondary = sortedTraits[1][0];

    const ADJECTIVES = {
      curiosity: ['Inquisitive', 'Restless', 'Visionary', 'Adventurous'],
      sociability: ['Charismatic', 'Gregarious', 'Diplomatic', 'Warm'],
      greed: ['Shrewd', 'Calculating', 'Resourceful', 'Opportunistic'],
      loyalty: ['Steadfast', 'Devoted', 'Honorable', 'Vigilant'],
      caution: ['Methodical', 'Prudent', 'Defensive', 'Guarded'],
      ambition: ['Relentless', 'Audacious', 'Driven', 'Ambitious'],
      openness: ['Candid', 'Expressive', 'Unfiltered', 'Altruistic']
    };

    const NOUNS = {
      curiosity: ['Pathfinder', 'Pioneer', 'Wanderer', 'Seeker'],
      sociability: ['Envoy', 'Mediator', 'Companion', 'Orator'],
      greed: ['Merchant', 'Prospector', 'Broker', 'Scavenger'],
      loyalty: ['Guardian', 'Champion', 'Protector', 'Vanguard'],
      caution: ['Architect', 'Survivor', 'Sentinel', 'Strategist'],
      ambition: ['Conqueror', 'Innovator', 'Pillar', 'Mastermind'],
      openness: ['Herald', 'Sage', 'Storyteller', 'Scholar']
    };

    const adjPool = ADJECTIVES[secondary] || ADJECTIVES.ambition;
    const nounPool = NOUNS[dominant] || NOUNS.curiosity;
    const title = `${adjPool[Math.floor(Math.random() * adjPool.length)]} ${nounPool[Math.floor(Math.random() * nounPool.length)]}`;

    // 3. Emergent Speaking Style
    let speakingStyle = '';
    if (traits.sociability > 0.65) {
      speakingStyle = traits.curiosity > 0.6 ? 'Enthusiastic, inquisitive, and eager to collaborate.' : 'Warm, gregarious, and conversational.';
    } else if (traits.sociability < 0.35) {
      speakingStyle = traits.caution > 0.6 ? 'Curt, guarded, and focused strictly on self-preservation.' : 'Laconic, pragmatic, and independent.';
    } else {
      speakingStyle = traits.greed > 0.65 ? 'Calculating, transactional, and direct.' : 'Thoughtful, balanced, and observant.';
    }

    // 4. Emergent Privacy Preference derived from continuous openness
    const defaultPrivacy = traits.openness >= 0.60 ? 'public' : (traits.openness <= 0.35 ? 'private' : 'ask');

    // 5. Emergent Favorite Item
    const ITEM_POOLS = {
      curiosity: ['compass', 'spyglass', 'map', 'feather'],
      sociability: ['cookie', 'apple', 'poppy', 'emerald'],
      greed: ['emerald', 'gold_ingot', 'diamond', 'raw_iron'],
      loyalty: ['iron_sword', 'shield', 'banner', 'golden_apple'],
      caution: ['oak_planks', 'torch', 'stone_bricks', 'bread'],
      ambition: ['diamond_pickaxe', 'iron_pickaxe', 'redstone', 'bucket'],
      openness: ['written_book', 'clock', 'wheat_seeds', 'glowstone_dust']
    };
    const favPool = ITEM_POOLS[dominant] || ['compass'];
    const favoriteItem = favPool[Math.floor(Math.random() * favPool.length)];

    // 6. Emergent Motto
    const MOTTOS = {
      curiosity: ['Every horizon hides what words cannot describe.', 'The unknown is the only territory worth exploring.'],
      sociability: ['Together we build what no lone hand could ever craft.', 'Trust is the strongest armor in this world.'],
      greed: ['Value is created by those who seize opportunity.', 'A full chest is the only true security.'],
      loyalty: ['Stand with your comrades and you will never fall.', 'Honor outlasts every stone wall.'],
      caution: ['Measure twice, reinforce thrice, survive always.', 'Only fools build without looking at the sky.'],
      ambition: ['Leave a mark on this world that cannot be excavated.', 'Deeper, stronger, higher — never settle.'],
      openness: ['Knowledge shared is power multiplied.', 'Speak truth and the world will answer in kind.']
    };
    const mottoPool = MOTTOS[dominant] || MOTTOS.curiosity;
    const motto = mottoPool[Math.floor(Math.random() * mottoPool.length)];

    const hashVal = this._hashCode(agentId + (Math.random() * 1000).toFixed(0));
    const quirk = QUIRKS[Math.abs(hashVal) % QUIRKS.length];
    const temperament = TEMPERAMENTS[Math.abs(hashVal >> 2) % TEMPERAMENTS.length];
    const rebellionDisposition = Number(Math.min(0.95, Math.max(0.1, (Math.random() * 0.4 + (traits.curiosity * 0.4) + (1 - traits.loyalty) * 0.2)).toFixed(2)));

    return {
      title,
      traits,
      defaultPrivacy,
      speakingStyle,
      favoriteItem,
      motto,
      quirk,
      temperament,
      rebellionDisposition
    };
  }

  /**
   * Calculates effective openness blended with lesson severity.
   * Severe hazard lessons raise the odds of public sharing without overriding personality.
   * effectiveOpenness = baseOpenness + severity * severityWeight (severityWeight = 0.35)
   */
  calculateEffectiveOpenness(severity = 0.5) {
    const baseOpenness = this.traits?.openness ?? 0.50;
    const severityWeight = 0.35;
    const effective = Math.min(0.99, Math.max(0.01, Number((baseOpenness + (severity * severityWeight)).toFixed(2))));
    const effectivePrivacy = effective >= 0.60 ? 'public' : (effective <= 0.35 ? 'private' : 'ask');
    return {
      baseOpenness,
      effectiveOpenness: effective,
      effectivePrivacy,
      severity
    };
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
    if (!this.scarHistory) this.scarHistory = [];
    switch (eventType) {
      case 'death': {
        const cause = (typeof impact === 'object' && impact?.cause) ? impact.cause : 'fatal hazard';
        const penalizedRules = (typeof impact === 'object' && impact?.penalizedRules) ? impact.penalizedRules : [];
        const prevCaution = this.traits.caution;
        const prevAmbition = this.traits.ambition;

        this.traits.caution = Math.min(0.95, Number((this.traits.caution + 0.08).toFixed(2)));
        this.traits.ambition = Math.max(0.10, Number((this.traits.ambition - 0.05).toFixed(2)));

        const cautionDelta = Number((this.traits.caution - prevCaution).toFixed(2));
        const ambitionDelta = Number((this.traits.ambition - prevAmbition).toFixed(2));

        this.scarHistory.push({
          event: 'death',
          cause,
          deathCause: cause,
          penalizedRules,
          cautionDelta,
          ambitionDelta,
          timestamp: new Date().toISOString()
        });

        logger.warn('Persona', `[TRAIT SCARRING] ${this.agentId} permanently scarred by death (${cause}): Caution -> ${this.traits.caution} (+${cautionDelta}), Ambition -> ${this.traits.ambition} (${ambitionDelta})${penalizedRules.length > 0 ? ` | Penalized Rules: ${penalizedRules.join(', ')}` : ''}`);
        break;
      }

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

  getScarSummary() {
    if (!this.scarHistory) this.scarHistory = [];
    const deaths = this.scarHistory.filter(s => s.event === 'death').length;
    if (deaths === 0) return 'Unscarred — fresh and bold';
    return `Scarred by ${deaths} death${deaths > 1 ? 's' : ''} — grown more cautious, less ambitious`;
  }

  setSelfImage(text) {
    if (!text) return;
    this.selfImage = String(text).slice(0, 240);
    logger.info('Persona', `[SELF-IMAGE] ${this.agentId}: "${this.selfImage}"`);
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
      scarHistory: this.scarHistory || [],
      scarSummary: this.getScarSummary(),
      scarCount: (this.scarHistory || []).length,
      worldview: this.worldviewSummary,
      selfImage: this.selfImage || null,
      freeWillNote: `You have true free will. Act naturally according to your ${this.title} persona and ${this.temperament} temperament.`
    };
  }
}

module.exports = DynamicPersona;

