const { ACTIONS, SCARCE_RESOURCES } = require('../../../shared/constants');

function evaluateTrade(senses, stats, persona = null, agentState = {}) {
  const players = (senses.getNearbyPlayers(12) || []).filter(p => p && p.username && !/spectate/i.test(p.username));
  if (!players || players.length === 0) {
    return { name: ACTIONS.TRADE || 'TRADE', confidence: 0.0, reason: 'No trading partner nearby' };
  }

  // Score partners: closer is better, recent chat requests win. Never blind players[0].
  const recentChat = agentState?.recentChat || [];
  const myPos = senses.bot?.entity?.position;
  let partner = players[0];
  let bestScore = -Infinity;
  for (const p of players) {
    let score = 0;
    try {
      if (myPos && p.position && typeof myPos.distanceTo === 'function') {
        score += Math.max(0, 12 - myPos.distanceTo(p.position)) / 12;
      }
    } catch { /* distance optional */ }
    const spoke = recentChat.slice(-10).some(c =>
      (c.username === p.username) &&
      /trade|swap|need|want|give|offer|buy|sell/i.test(c.message || '')
    );
    if (spoke) score += 1.0;
    if (score > bestScore) { bestScore = score; partner = p; }
  }
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
  } else {
    // Empty pockets: stay a weak candidate so escrowed/promise trades still
    // surface, but never outbid real work (fixes no-inventory TRADE spam).
    confidence = Math.min(confidence, 0.40);
    reason = `Near ${partner.username} but holding nothing tradable — weak trade interest`;
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
