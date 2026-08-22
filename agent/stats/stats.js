const { STATS } = require('../../shared/constants');

class StatsManager {
  constructor(initialStats = {}) {
    this.health = initialStats.health !== undefined ? initialStats.health : 20; // 0 - 20 (MC scale)
    this.hunger = initialStats.hunger !== undefined ? initialStats.hunger : 100; // 0 - 100 (%)
    this.anger = initialStats.anger !== undefined ? initialStats.anger : 0;     // 0 - 100 (%)
    this.happiness = initialStats.happiness !== undefined ? initialStats.happiness : 80; // 0 - 100 (%)
    this.fatigue = initialStats.fatigue !== undefined ? initialStats.fatigue : 0;   // 0 - 100 (%)
  }

  clamp(value, min = STATS.MIN, max = STATS.MAX) {
    return Math.max(min, Math.min(max, value));
  }

  updateHealth(mcHealth) {
    if (typeof mcHealth === 'number' && !isNaN(mcHealth)) {
      this.health = Math.max(0, Math.min(20, mcHealth));
    }
  }

  updateHungerFromMC(mcFoodLevel) {
    if (typeof mcFoodLevel === 'number' && !isNaN(mcFoodLevel)) {
      this.hunger = Math.round((mcFoodLevel / 20) * 100);
    }
  }

  addAnger(amount) {
    this.anger = this.clamp(this.anger + amount);
  }

  addHappiness(amount) {
    this.happiness = this.clamp(this.happiness + amount);
  }

  addFatigue(amount) {
    this.fatigue = this.clamp(this.fatigue + amount);
  }

  getSummary() {
    return {
      health: this.health,
      hunger: Math.round(this.hunger),
      anger: Math.round(this.anger),
      happiness: Math.round(this.happiness),
      fatigue: Math.round(this.fatigue)
    };
  }
}

module.exports = StatsManager;
