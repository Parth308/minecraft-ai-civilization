const { ACTIONS, SCARCE_RESOURCES } = require('../../../shared/constants');

let lastExecutedTalkTime = 0;

function evaluateTalk(senses, stats, persona = null, agentState = {}) {
  const now = Date.now();
  // Cooldown of 20 seconds between autonomous initiated conversations
  if (now - lastExecutedTalkTime < 20000) {
    return { name: ACTIONS.TALK || 'TALK', confidence: 0.0, reason: 'Chat cooldown active' };
  }

  const pos = senses.bot?.entity?.position || { x: 0, y: 64, z: 0 };
  const posCoords = `(${Math.round(pos.x)}, ${Math.round(pos.y)}, ${Math.round(pos.z)})`;
  const sociability = persona?.traits?.sociability ?? 0.6;
  const greed = persona?.traits?.greed ?? 0.5;

  // 1. Direct Peer Encounter Dialogue
  const nearbyPlayers = senses.getNearbyPlayers(24);
  if (nearbyPlayers && nearbyPlayers.length > 0) {
    const partner = nearbyPlayers[0];
    const confidence = Number((0.72 + sociability * 0.18).toFixed(2));
    return {
      name: ACTIONS.TALK || 'TALK',
      confidence,
      partner: partner.username || partner.name,
      reason: `Encountered ${partner.username || partner.name} nearby (${Math.round(senses.bot?.entity?.position?.distanceTo(partner.entity?.position || senses.bot.entity.position))}m) — initiating dialogue`
    };
  }

  // 2. Organic Trade & Market Advertisement Broadcast
  // If holding surplus materials (ores, stone, food), advertise willingness to barter
  const inventoryItems = senses.bot?.inventory ? senses.bot.inventory.items() : [];
  const tradeableSurplus = inventoryItems.filter(i => 
    (i.count >= 8 && (i.name.includes('cobble') || i.name.includes('log') || i.name.includes('plank') || i.name.includes('dirt'))) ||
    (i.count >= 2 && (i.name.includes('iron') || i.name.includes('gold') || i.name.includes('diamond') || i.name.includes('cooked') || i.name.includes('bread')))
  );

  if (tradeableSurplus.length > 0 && Math.random() < 0.45) {
    const topItem = tradeableSurplus[0];
    const confidence = Number((0.68 + greed * 0.15 + sociability * 0.10).toFixed(2));
    return {
      name: ACTIONS.TALK || 'TALK',
      confidence,
      partner: 'World',
      broadcastType: 'trade_advertisement',
      advertisedItem: topItem.name,
      count: topItem.count,
      location: posCoords,
      suggestedMessage: `Have surplus ${topItem.count}x ${topItem.name} to trade or barter! Meet me near ${posCoords}.`,
      reason: `Holding surplus ${topItem.count}x ${topItem.name} — broadcasting trade offer to world`
    };
  }

  // 3. Nighttime Psychological Reactions (Vulnerability or Defiance)
  if (senses.isNight && senses.isNight()) {
    const caution = persona?.traits?.caution ?? 0.5;
    if (caution > 0.60 && Math.random() < 0.35) {
      return {
        name: ACTIONS.TALK || 'TALK',
        confidence: 0.70,
        partner: 'World',
        broadcastType: 'night_reaction',
        suggestedMessage: `Darkness is falling fast near ${posCoords}... looking for shelter and safe ground.`,
        reason: 'Cautious reaction to nighttime hazards'
      };
    }
  }

  // 4. Spontaneous soliloquy / world observation
  if (stats.health >= 15 && stats.hunger >= 40 && Math.random() < 0.25) {
    const curiosity = persona?.traits?.curiosity ?? 0.5;
    return {
      name: ACTIONS.TALK || 'TALK',
      confidence: Number((0.60 + curiosity * 0.15).toFixed(2)),
      partner: 'World',
      broadcastType: 'observation',
      reason: 'Spontaneous thought or observation about the environment'
    };
  }

  return { name: ACTIONS.TALK || 'TALK', confidence: 0.0, reason: 'No dialogue trigger active' };
}

function markTalkExecuted() {
  lastExecutedTalkTime = Date.now();
}

module.exports = evaluateTalk;
module.exports.markTalkExecuted = markTalkExecuted;
