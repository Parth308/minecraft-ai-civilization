const { ACTIONS } = require('../../../shared/constants');

function evaluateSleep(senses, stats, persona = null, agentState = {}) {
  const isNight = senses.isNight();
  if (!isNight) {
    return { name: ACTIONS.SLEEP, confidence: 0.0, reason: 'Daytime — wide awake and active' };
  }

  const bedBlock = senses.getNearbyBed(16);
  const hostiles = typeof senses.getNearbyHostileMobs === 'function' ? senses.getNearbyHostileMobs(16) : [];
  const hostileCount = Array.isArray(hostiles) ? hostiles.length : 0;
  
  const caution = persona?.traits?.caution ?? 0.5;
  const ambition = persona?.traits?.ambition ?? 0.5;
  const scarCount = persona?.scarCount || (Array.isArray(persona?.scarHistory) ? persona.scarHistory.length : 0);

  // Perceived threat index [0.0 - 1.0]
  let threatLevel = 0.35; // base darkness threat
  threatLevel += hostileCount * 0.15;
  threatLevel += (caution - 0.5) * 0.30;
  threatLevel += scarCount * 0.08;
  threatLevel -= (ambition - 0.5) * 0.15;
  threatLevel = Math.max(0.10, Math.min(0.99, threatLevel));

  // If a bed is nearby and agent feels fatigue or high threat
  if (bedBlock) {
    let confidence = 0.70 + (threatLevel * 0.20) + (stats.fatigue > 50 ? 0.10 : 0.0);
    return {
      name: ACTIONS.SLEEP,
      confidence: Math.min(0.95, Number(confidence.toFixed(2))),
      bed: bedBlock,
      threatLevel: Number(threatLevel.toFixed(2)),
      reason: `Night darkness detected (Threat: ${Math.round(threatLevel * 100)}%, Fatigue: ${stats.fatigue}%). Resting in nearby bed.`
    };
  }

  // If no bed is nearby but threat is high, cautious agents prioritize seeking shelter / hiding
  if (threatLevel >= 0.65) {
    return {
      name: ACTIONS.FLEE,
      confidence: Number((0.65 + threatLevel * 0.20).toFixed(2)),
      threatLevel: Number(threatLevel.toFixed(2)),
      reason: `Pitch black night with high perceived danger (${Math.round(threatLevel * 100)}% threat, ${hostileCount} hostiles nearby). Seeking shelter/torchlight.`
    };
  }

  // Bold / Ambitious agent chooses to brave the night
  return {
    name: ACTIONS.SLEEP,
    confidence: 0.10,
    threatLevel: Number(threatLevel.toFixed(2)),
    reason: `Nighttime, but feeling brave (Threat: ${Math.round(threatLevel * 100)}%, Ambition: ${Math.round(ambition * 100)}%). Continuing operations.`
  };
}

module.exports = evaluateSleep;
