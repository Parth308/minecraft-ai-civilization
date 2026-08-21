const logger = require('../../shared/logger');

class GoalManager {
  constructor(agentId, persona) {
    this.agentId = agentId;
    this.persona = persona;
    this.currentGoal = {
      description: 'Explore the immediate surroundings and gather basic survival resources',
      status: 'active',
      progress: 0,
      createdAt: new Date().toISOString()
    };
    this.lifeAspiration = `Thrive autonomously as a ${persona.seed} and build my personal legacy.`;
  }

  setGoal(description, details = {}) {
    this.currentGoal = {
      description,
      details,
      status: 'active',
      progress: 0,
      createdAt: new Date().toISOString()
    };
    logger.info('Goals', `[NEW GOAL] ${this.agentId} adopted objective: "${description}"`);
  }

  setAspiration(aspiration) {
    this.lifeAspiration = aspiration;
    logger.info('Goals', `[NEW LIFE ASPIRATION] ${this.agentId}: "${aspiration}"`);
  }

  markGoalCompleted(outcome = 'Success') {
    logger.info('Goals', `[GOAL ACCOMPLISHED] ${this.agentId}: "${this.currentGoal.description}" (${outcome})`);
    this.currentGoal.status = 'completed';
    this.currentGoal.completedAt = new Date().toISOString();
  }

  getGoalContext() {
    return {
      activeGoal: this.currentGoal.description,
      goalStatus: this.currentGoal.status,
      lifeAspiration: this.lifeAspiration
    };
  }
}

module.exports = GoalManager;
