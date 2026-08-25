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
    this.activePlan = null;
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

  setPlan(steps) {
    const clean = (steps || []).map(s => String(s).trim()).filter(Boolean).slice(0, 8);
    if (clean.length === 0) return false;
    this.activePlan = { steps: clean, idx: 0, consecutiveFailures: 0, createdAt: new Date().toISOString() };
    logger.info('Goals', `[NEW PLAN] ${this.agentId}: ${clean.length} steps — ${clean.map((s, i) => `${i + 1}. ${s}`).join(' | ')}`);
    return true;
  }

  getActivePlan() {
    return this.activePlan;
  }

  getCurrentPlanStep() {
    if (!this.activePlan || this.activePlan.idx >= this.activePlan.steps.length) return null;
    return this.activePlan.steps[this.activePlan.idx];
  }

  advancePlan() {
    if (!this.activePlan) return null;
    this.activePlan.idx += 1;
    this.activePlan.consecutiveFailures = 0;
    if (this.activePlan.idx >= this.activePlan.steps.length) {
      logger.info('Goals', `[PLAN COMPLETE] ${this.agentId} finished all ${this.activePlan.steps.length} steps.`);
      this.activePlan = null;
      return null;
    }
    return this.getCurrentPlanStep();
  }

  failCurrentStep() {
    if (!this.activePlan) return;
    this.activePlan.consecutiveFailures += 1;
    logger.warn('Goals', `[PLAN STEP FAILED x${this.activePlan.consecutiveFailures}] ${this.agentId}: "${this.getCurrentPlanStep()}"`);
  }

  clearPlan(reason = '') {
    if (!this.activePlan) return;
    logger.info('Goals', `[PLAN ABANDONED] ${this.agentId} cleared plan at step ${this.activePlan.idx + 1}/${this.activePlan.steps.length}${reason ? ` (${reason})` : ''}`);
    this.activePlan = null;
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

  toSnapshot() {
    return {
      currentGoal: this.currentGoal,
      lifeAspiration: this.lifeAspiration,
      activePlan: this.activePlan,
      savedAt: new Date().toISOString()
    };
  }

  restoreFromSnapshot(snap) {
    if (!snap || !snap.currentGoal || !snap.currentGoal.description) return false;
    this.currentGoal = snap.currentGoal;
    if (snap.currentGoal.status === 'active') {
      this.personalGoals = [this.currentGoal];
    }
    if (snap.lifeAspiration) this.lifeAspiration = snap.lifeAspiration;
    if (snap.activePlan && Array.isArray(snap.activePlan.steps) && snap.activePlan.idx < snap.activePlan.steps.length) {
      this.activePlan = snap.activePlan;
    }
    logger.info('Goals', `[GOAL RESTORED] ${this.agentId}: "${this.currentGoal.description}" (snapshot from ${snap.savedAt || 'unknown'})`);
    return true;
  }
}

module.exports = GoalManager;
