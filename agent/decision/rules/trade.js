const { ACTIONS, SCARCE_RESOURCES } = require('../../../shared/constants');

function evaluateTrade(senses, stats, persona = null, agentState = {}) {
  const players = senses.getNearbyPlayers(6);
  if (!players || players.length === 0) {
    return { name: ACTIONS.TRADE || 'TRADE', confidence: 0.0, reason: 'No trading partner nearby' };
  }

  const partner = players[0];
  let confidence = 0.50;
  let reason = `Nearby player ${partner.username} within interaction distance`;

  // Scan inventory for scarce resource surplus
  const scarceItemsHeld = [];
  for (const scarceName of Object.keys(SCARCE_RESOURCES || {})) {
    if (senses.hasItem(scarceName) && senses.countItem(scarceName) > 0) {
      scarceItemsHeld.push({ name: scarceName, count: senses.countItem(scarceName) });
    }
  }

  // Check if nearby partner or recent chat explicitly mentioned/requested any item
  const recentChat = agentState?.recentChat || [];
  const requestedItems = [];
  for (const chatMsg of recentChat.slice(-10)) {
    const text = (chatMsg.message || '').toLowerCase();
    for (const scarce of scarceItemsHeld) {
      if (text.includes(scarce.name) || (scarce.name === 'gold_ingot' && text.includes('gold')) || (scarce.name === 'iron_ingot' && text.includes('iron'))) {
        requestedItems.push(scarce.name);
      }
    }
  }

  if (requestedItems.length > 0) {
    confidence = 0.85; // High confidence: we hold scarce goods explicitly sought by peers
    reason = `Holding scarce resource '${requestedItems[0]}' requested by nearby players in chat`;
  } else if (scarceItemsHeld.length > 0) {
    confidence = 0.68; // Moderate-high confidence: holding valuable scarce trading commodities
    reason = `Holding valuable scarce resources (${scarceItemsHeld.map(s => `${s.count}x ${s.name}`).join(', ')}) to barter`;
  }

  return {
    name: ACTIONS.TRADE || 'TRADE',
    confidence,
    partner,
    meta: {
      partner: partner.username,
      scarceCommodities: scarceItemsHeld,
      targetedRequests: requestedItems
    },
    reason
  };
}

module.exports = evaluateTrade;
