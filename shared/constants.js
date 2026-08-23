module.exports = {
  STATS: {
    MIN: 0,
    MAX: 100,
    DECAY_INTERVAL_MS: 1000,
    HUNGER_DECAY_RATE: 0.2,       // per tick
    FATIGUE_INCREASE_RATE: 0.15,   // when moving
    FATIGUE_DECAY_RATE: 0.5,      // when resting/sleeping
    ANGER_DECAY_RATE: 0.3,        // natural calm down
    HAPPINESS_DECAY_RATE: 0.05
  },
  CONFIDENCE: {
    ESCALATION_THRESHOLD: 0.75,   // Below this, escalate to LLM/Broker + Web Knowledge
    ALWAYS_EXECUTE_THRESHOLD: 0.85
  },
  ACTIONS: {
    EAT: 'EAT',
    FLEE: 'FLEE',
    FIGHT: 'FIGHT',
    SLEEP: 'SLEEP',
    MINE: 'MINE',
    CRAFT: 'CRAFT',
    WANDER: 'WANDER',
    IDLE: 'IDLE',
    TRADE: 'TRADE',
    EXPLORE: 'EXPLORE',
    BUILD: 'BUILD',
    TALK: 'TALK'
  },
  SCARCE_RESOURCES: {
    emerald: { scarcityWeight: 2.8, baseValue: 50 },
    diamond: { scarcityWeight: 3.5, baseValue: 90 },
    ancient_debris: { scarcityWeight: 5.0, baseValue: 150 },
    netherite_scrap: { scarcityWeight: 5.0, baseValue: 160 },
    gold_ingot: { scarcityWeight: 1.8, baseValue: 30 },
    iron_ingot: { scarcityWeight: 1.4, baseValue: 20 },
    lapis_lazuli: { scarcityWeight: 1.5, baseValue: 18 }
  }
};
