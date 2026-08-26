const { ACTIONS, SCARCE_RESOURCES } = require('../../../shared/constants');

function evaluateTrade(senses, stats, persona = null, agentState = {}) {
  const players = senses.getNearbyPlayers(12);
  if (!players || players.length === 0) {
    return { name: ACTIONS.TRADE || 'TRADE', confidence: 0.0, reason: 'No trading partner nearby' };
  }

  const partner = players[0];
  // Base must stay competitive with MINE/CRAFT (0.90+ base): a partner in range
  // IS an opportunity cost — historically this rule capped at 0.85 and never
  // once won, leaving the entire ledger economy unwritten.
  let confidence = players.length > 1 ? 0.62 : 0.55;
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
    confidence = 0.94; // Peer verbally asked for what we hold — act on it NOW
    reason = `${partner.username} asked for '${requestedItems[0]}' which we hold (${scarceItemsHeld.find(s => s.name === requestedItems[0])?.count ?? '?'}x)`;
  } else if (scarceItemsHeld.length > 0) {
    confidence = 0.80; // Holding valuable scarce trading commodities near a partner
    reason = `Holding valuable scarce resources (${scarceItemsHeld.map(s => `${s.count}x ${s.name}`).join(', ')}) to barter with ${partner.username}`;
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
