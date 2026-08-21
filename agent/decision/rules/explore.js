const { ACTIONS } = require('../../../shared/constants');

function evaluateExplore(senses, stats) {
  // If healthy and not exhausted, exploring the surrounding environment is a natural autonomous action
  if (stats.health > 12 && stats.fatigue < 70 && stats.hunger > 30) {
    return {
      name: ACTIONS.EXPLORE || 'EXPLORE',
      confidence: 0.68,
      reason: `Healthy condition (HP:${stats.health}/20, Stamina:${100 - stats.fatigue}%) — exploring biome and scouting resources`
    };
  }

  // Low confidence fallback if exhausted or injured
  return { name: ACTIONS.EXPLORE || 'EXPLORE', confidence: 0.20, reason: 'Fatigued or resting' };
}

module.exports = evaluateExplore;
