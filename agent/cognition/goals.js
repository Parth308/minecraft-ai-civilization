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
    this.activeSharedGoalId = null;
    this.personalGoals = [this.currentGoal];
  }

  get personalGoalLoad() {
    return this.personalGoals.filter(g => g.status === 'active').length;
  }

  setGoal(description, details = {}) {
    this.currentGoal = {
      description,
      details,
      status: 'active',
      progress: 0,
      createdAt: new Date().toISOString()
    };
    this.personalGoals = [this.currentGoal];
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

  async proposeSharedGoal(description, requiredAgents = 2, requiredContributions = [{ item: 'cobblestone', count: 16 }], location = null, memoryServiceUrl = 'http://localhost:3002') {
    try {
      const res = await fetch(`${memoryServiceUrl}/api/ledger/shared-goals/propose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creatorAgentId: this.agentId,
          description,
          requiredAgents,
          requiredContributions,
          location
        })
      });
      if (res.ok) {
        const data = await res.json();
        this.activeSharedGoalId = data.goal?.id;
        logger.info('Goals', `[SHARED GOAL INITIATED] ${this.agentId} initiated "${description}"`);
        return data.goal;
      }
    } catch (err) {
      logger.debug('Goals', `Failed to propose shared goal: ${err.message}`);
    }
    return null;
  }

  async joinSharedGoal(goalId, memoryServiceUrl = 'http://localhost:3002') {
    try {
      const res = await fetch(`${memoryServiceUrl}/api/ledger/shared-goals/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goalId, agentId: this.agentId })
      });
      if (res.ok) {
        this.activeSharedGoalId = goalId;
        logger.info('Goals', `[SHARED GOAL ENLISTED] ${this.agentId} joined collaborative effort ${goalId}`);
        return true;
      }
    } catch (err) {
      logger.debug('Goals', `Failed to join shared goal: ${err.message}`);
    }
    return false;
  }

  async contributeToSharedGoal(goalId, itemName, count = 1, memoryServiceUrl = 'http://localhost:3002') {
    try {
      const res = await fetch(`${memoryServiceUrl}/api/ledger/shared-goals/contribute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goalId, agentId: this.agentId, itemName, count })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.completed) {
          logger.info('Goals', `[SHARED GOAL COMPLETED] Goal ${goalId} marked complete after contribution from ${this.agentId}!`);
        }
        return data;
      }
    } catch (err) {
      logger.debug('Goals', `Failed to contribute to shared goal: ${err.message}`);
    }
    return null;
  }

  getGoalContext() {
    return {
      activeGoal: this.currentGoal.description,
      goalStatus: this.currentGoal.status,
      activeSharedGoalId: this.activeSharedGoalId,
      personalGoalLoad: this.personalGoalLoad,
      lifeAspiration: this.lifeAspiration
    };
  }
}

module.exports = GoalManager;
