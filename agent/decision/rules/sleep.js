const { ACTIONS } = require('../../../shared/constants');

function evaluateSleep(senses, stats) {
  const isNight = senses.isNight();
  const bedBlock = senses.getNearbyBed(16);

  if (isNight && bedBlock) {
    const confidence = stats.fatigue > 60 ? 0.90 : 0.75;
    return {
      name: ACTIONS.SLEEP,
      confidence,
      bed: bedBlock,
      reason: `Night time detected and bed found nearby (Fatigue: ${stats.fatigue}%)`
    };
  }

  return { name: ACTIONS.SLEEP, confidence: 0.0, reason: 'Not night or no bed nearby' };
}

module.exports = evaluateSleep;
