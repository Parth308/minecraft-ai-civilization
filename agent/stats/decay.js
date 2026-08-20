const { STATS } = require('../../shared/constants');
const logger = require('../../shared/logger');

class StatsDecayEngine {
  constructor(statsManager, movementActuator) {
    this.stats = statsManager;
    this.movement = movementActuator;
  }

  tick() {
    // 1. Natural hunger decay
    const isMoving = this.movement.isMoving();
    const hungerDecay = isMoving ? STATS.HUNGER_DECAY_RATE * 1.5 : STATS.HUNGER_DECAY_RATE;
    this.stats.hunger = this.stats.clamp(this.stats.hunger - hungerDecay);

    // 2. Fatigue update
    if (isMoving) {
      this.stats.fatigue = this.stats.clamp(this.stats.fatigue + STATS.FATIGUE_INCREASE_RATE);
    } else {
      this.stats.fatigue = this.stats.clamp(this.stats.fatigue - STATS.FATIGUE_DECAY_RATE);
    }

    // 3. Anger natural calm down
    if (this.stats.anger > 0) {
      this.stats.anger = this.stats.clamp(this.stats.anger - STATS.ANGER_DECAY_RATE);
    }

    // 4. Happiness decay if hungry or injured
    if (this.stats.hunger < 30 || this.stats.health < 10) {
      this.stats.happiness = this.stats.clamp(this.stats.happiness - STATS.HAPPINESS_DECAY_RATE * 2);
    }

    logger.debug('StatsDecay', `Tick complete: ${JSON.stringify(this.stats.getSummary())}`);
  }
}

module.exports = StatsDecayEngine;
