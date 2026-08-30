const { ACTIONS } = require('../../../shared/constants');

function evaluateDefend(senses, stats, persona = null, agentState = {}) {
  const hostiles = senses.getNearbyHostileMobs?.(16) || [];
  const alliedPlayers = senses.getNearbyPlayers?.(24) || [];
  const alliedAgents = alliedPlayers.filter(p => p.username !== senses.bot?.username);

  if (hostiles.length === 0) {
    return { name: ACTIONS.DEFEND, confidence: 0.0, reason: 'No hostiles nearby' };
  }

  const hasWeapon = senses.hasItem('iron_sword') || senses.hasItem('diamond_sword') ||
                    senses.hasItem('iron_axe') || senses.hasItem('diamond_axe') ||
                    senses.hasItem('stone_sword') || senses.hasItem('stone_axe');
  const hasShield = senses.hasItem('shield');

  const dangerLevel = hostiles.length >= 3 ? 0.9 : hostiles.length >= 2 ? 0.75 : 0.60;
  const healthFactor = stats.health < 10 ? -0.2 : stats.health < 15 ? -0.1 : 0;
  const caution = persona?.traits?.caution ?? 0.5;
  const ambition = persona?.traits?.ambition ?? 0.5;

  let confidence = dangerLevel + healthFactor + (caution * 0.15) + (ambition * 0.10);
  if (hasWeapon) confidence += 0.10;
  if (hasShield) confidence += 0.05;
  if (alliedAgents.length > 0) confidence += 0.08;

  const nearestHostile = hostiles.reduce((closest, mob) => {
    const dist = mob.position?.distanceTo(senses.bot?.entity?.position) || Infinity;
    return dist < (closest.dist || Infinity) ? { mob, dist } : closest;
  }, {}).mob;

  return {
    name: ACTIONS.DEFEND,
    confidence: Math.min(0.95, Number(confidence.toFixed(2))),
    target: nearestHostile,
    reason: `Defending against ${hostiles.length} hostile(s) — ${nearestHostile?.name || 'unknown threat'}`
  };
}

module.exports = evaluateDefend;