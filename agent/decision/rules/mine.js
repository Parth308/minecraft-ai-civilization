const { ACTIONS } = require('../../../shared/constants');

function evaluateMine(senses, stats) {
  // If idle, healthy, and not exhausted, offer mining at mild confidence
  if (stats.health > 15 && stats.fatigue < 50 && stats.hunger > 40) {
    const targetBlock = senses.getNearbyBlock('log', 16) || senses.getNearbyBlock('coal_ore', 16);
    if (targetBlock) {
      return {
        name: ACTIONS.MINE,
        confidence: 0.65,
        targetBlock,
        reason: `Discovered mineable block ${targetBlock.name} nearby`
      };
    }
  }

  return { name: ACTIONS.MINE, confidence: 0.2, reason: 'No immediate mining priority' };
}

module.exports = evaluateMine;
