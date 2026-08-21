const { ACTIONS } = require('../../../shared/constants');

function evaluateTrade(senses, stats) {
  const players = senses.getNearbyPlayers(5);

  // If a high-trust player is right next to the bot, evaluate trade opportunity
  if (players.length > 0) {
    return {
      name: ACTIONS.TRADE || 'TRADE',
      confidence: 0.55,
      partner: players[0],
      reason: `Nearby player ${players[0].username} within interaction distance`
    };
  }

  return { name: ACTIONS.TRADE || 'TRADE', confidence: 0.0, reason: 'No trading partner nearby' };
}

module.exports = evaluateTrade;
