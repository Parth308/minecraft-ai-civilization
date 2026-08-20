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
    ESCALATION_THRESHOLD: 0.6,    // Below this, escalate to LLM/Broker
    ALWAYS_EXECUTE_THRESHOLD: 0.8
  },
  ACTIONS: {
    EAT: 'EAT',
    FLEE: 'FLEE',
    FIGHT: 'FIGHT',
    SLEEP: 'SLEEP',
    MINE: 'MINE',
    WANDER: 'WANDER',
    IDLE: 'IDLE'
  }
};
