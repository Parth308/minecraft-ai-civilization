const { ACTIONS } = require('../../../shared/constants');

let lastChatTime = 0;

function evaluateTalk(senses, stats) {
  const now = Date.now();
  // Cooldown of 15 seconds between autonomous greetings to prevent spam
  if (now - lastChatTime < 15000) {
    return { name: ACTIONS.TALK || 'TALK', confidence: 0.0, reason: 'Chat cooldown active' };
  }

  const nearbyPlayers = senses.getNearbyPlayers(10);
  if (nearbyPlayers && nearbyPlayers.length > 0) {
    const partner = nearbyPlayers[0];
    lastChatTime = now;
    return {
      name: ACTIONS.TALK || 'TALK',
      confidence: 0.76,
      partner: partner.username || partner.name,
      reason: `Encountered ${partner.username || partner.name} nearby — initiating social dialogue`
    };
  }

  return { name: ACTIONS.TALK || 'TALK', confidence: 0.0, reason: 'No players or agents nearby to converse with' };
}

module.exports = evaluateTalk;
