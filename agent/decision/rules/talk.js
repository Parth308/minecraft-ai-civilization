const { ACTIONS } = require('../../../shared/constants');

let lastExecutedTalkTime = 0;

function evaluateTalk(senses, stats, persona = null) {
  const now = Date.now();
  // Cooldown of 25 seconds between autonomous initiated conversations
  if (now - lastExecutedTalkTime < 25000) {
    return { name: ACTIONS.TALK || 'TALK', confidence: 0.0, reason: 'Chat cooldown active' };
  }

  const nearbyPlayers = senses.getNearbyPlayers(24);
  if (nearbyPlayers && nearbyPlayers.length > 0) {
    const partner = nearbyPlayers[0];
    const sociability = persona?.traits?.sociability ?? 0.6;
    // Base confidence between 0.72 and 0.88 based on persona's sociability
    const confidence = Number((0.70 + sociability * 0.18).toFixed(2));
    return {
      name: ACTIONS.TALK || 'TALK',
      confidence,
      partner: partner.username || partner.name,
      reason: `Encountered ${partner.username || partner.name} nearby (${Math.round(senses.bot?.entity?.position?.distanceTo(partner.entity?.position || senses.bot.entity.position))}m) — initiating dialogue`
    };
  }

  // Spontaneous soliloquy / world broadcast when wandering or content
  if (stats.health >= 15 && stats.hunger >= 50 && stats.anger < 30) {
    const curiosity = persona?.traits?.curiosity ?? 0.5;
    if (Math.random() < 0.3) {
      return {
        name: ACTIONS.TALK || 'TALK',
        confidence: Number((0.60 + curiosity * 0.12).toFixed(2)),
        partner: 'World',
        reason: 'Spontaneous thought or observation about the environment'
      };
    }
  }

  return { name: ACTIONS.TALK || 'TALK', confidence: 0.0, reason: 'No players or agents nearby to converse with' };
}

function markTalkExecuted() {
  lastExecutedTalkTime = Date.now();
}

module.exports = evaluateTalk;
module.exports.markTalkExecuted = markTalkExecuted;
