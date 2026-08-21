const { ACTIONS } = require('../../../shared/constants');

function evaluateExplore(senses, stats) {
  // If happiness is low or agent is curious/idle with high stamina
  if (stats.happiness < 50 && stats.fatigue < 40 && stats.health > 15) {
    return {
      name: ACTIONS.EXPLORE || 'EXPLORE',
      confidence: 0.60,
      reason: `Low happiness (${stats.happiness}%) and high stamina - explore surrounding area`
    };
  }

  return { name: ACTIONS.EXPLORE || 'EXPLORE', confidence: 0.15, reason: 'No urge to explore' };
}

module.exports = evaluateExplore;
