const { ACTIONS } = require('../../../shared/constants');

function evaluateFlee(senses, stats) {
  const hostiles = senses.getNearbyHostileMobs(12);

  // If health is critically low (< 6) and enemies nearby
  if (stats.health <= 6 && hostiles.length > 0) {
    return {
      name: ACTIONS.FLEE,
      confidence: 0.98,
      threat: hostiles[0],
      reason: `Critical health (${stats.health}/20) with ${hostiles.length} hostiles nearby`
    };
  }

  // Overwhelmed by 3+ hostiles
  if (hostiles.length >= 3) {
    return {
      name: ACTIONS.FLEE,
      confidence: 0.90,
      threat: hostiles[0],
      reason: `Overwhelmed by ${hostiles.length} hostiles`
    };
  }

  return { name: ACTIONS.FLEE, confidence: 0.05, reason: 'No imminent mortality threat' };
}

module.exports = evaluateFlee;
