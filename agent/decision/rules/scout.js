const { ACTIONS } = require('../../../shared/constants');

function evaluateScout(senses, stats, persona = null, agentState = {}) {
  const hostiles = senses.getNearbyHostileMobs?.(32) || [];
  const ores = senses.getNearbyOres?.(24) || [];
  const players = senses.getNearbyPlayers?.(48) || [];
  const alliedAgents = players.filter(p => p.username !== senses.bot?.username);

  const lastScout = agentState.lastScoutTime || 0;
  const scoutCooldown = 120000;
  if (Date.now() - lastScout < scoutCooldown) {
    return { name: ACTIONS.SCOUT, confidence: 0.0, reason: 'Scouting on cooldown' };
  }

  const curiosity = persona?.traits?.curiosity ?? 0.5;
  const caution = persona?.traits?.caution ?? 0.5;

  const dangerLevel = hostiles.length >= 3 ? 0.30 : hostiles.length >= 2 ? 0.20 : hostiles.length >= 1 ? 0.10 : 0;
  const explorationNeed = ores.length === 0 ? 0.15 : 0;
  const socialNeed = alliedAgents.length === 0 ? 0.10 : 0;

  let confidence = 0.35 + dangerLevel + explorationNeed + socialNeed + (curiosity * 0.20) + (caution * 0.10);

  if (stats.health < 12) confidence -= 0.20;
  if (stats.hunger < 30) confidence -= 0.15;
  if (senses.isNight()) confidence -= 0.10;

  return {
    name: ACTIONS.SCOUT,
    confidence: Math.min(0.82, Number(confidence.toFixed(2))),
    reason: `Scouting area — ${hostiles.length} hostiles, ${ores.length} ores, ${alliedAgents.length} allies nearby`
  };
}

module.exports = evaluateScout;