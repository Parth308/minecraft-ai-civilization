const { ACTIONS } = require('../../../shared/constants');

function evaluateGuard(senses, stats, persona = null, agentState = {}) {
  const alliedPlayers = senses.getNearbyPlayers?.(24) || [];
  const alliedAgents = alliedPlayers.filter(p => p.username !== senses.bot?.username);
  const hostiles = senses.getNearbyHostileMobs?.(16) || [];

  const hasAllies = alliedAgents.length > 0;
  const hasThreats = hostiles.length > 0;

  const caution = persona?.traits?.caution ?? 0.5;
  const sociability = persona?.traits?.sociability ?? 0.5;

  if (!hasAllies && !hasThreats) {
    return { name: ACTIONS.GUARD, confidence: 0.0, reason: 'No allies to guard, no threats present' };
  }

  let confidence = 0.40;
  if (hasAllies) confidence += 0.15 + (sociability * 0.12);
  if (hasThreats) confidence += 0.20 + (caution * 0.15);

  if (stats.health < 10) confidence -= 0.15;
  if (stats.hunger < 30) confidence -= 0.10;

  const guardedTarget = hasAllies ? alliedAgents[0] : null;
  const threatTarget = hasThreats ? hostiles[0] : null;

  return {
    name: ACTIONS.GUARD,
    confidence: Math.min(0.85, Number(confidence.toFixed(2))),
    guardedTarget: guardedTarget?.username || null,
    threatTarget: threatTarget?.name || null,
    reason: hasThreats
      ? `Guarding against ${threatTarget?.name} near ${guardedTarget?.username || 'area'}`
      : `Standing guard near ${guardedTarget?.username}`
  };
}

module.exports = evaluateGuard;