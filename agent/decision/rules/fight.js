const { ACTIONS } = require('../../../shared/constants');

function evaluateFight(senses, stats) {
  const hostiles = senses.getNearbyHostileMobs(8);

  if (hostiles.length > 0 && stats.health > 8) {
    return {
      name: ACTIONS.FIGHT,
      confidence: 0.85,
      target: hostiles[0],
      reason: `Hostile mob ${hostiles[0].name || 'enemy'} within melee distance`
    };
  }

  // Fight back when anger is high (> 70) and health decent
  if (stats.anger >= 70 && stats.health > 10 && hostiles.length > 0) {
    return {
      name: ACTIONS.FIGHT,
      confidence: 0.80,
      target: hostiles[0],
      reason: `Anger level high (${stats.anger}%) - engaging nearby enemy`
    };
  }

  return { name: ACTIONS.FIGHT, confidence: 0.0, reason: 'No hostiles to attack' };
}

module.exports = evaluateFight;
