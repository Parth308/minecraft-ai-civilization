const { ACTIONS } = require('../../../shared/constants');

function evaluateEnchant(senses, stats, persona = null, agentState = {}) {
  const table = senses.getNearbyBlock?.('enchanting_table', 10);
  if (!table) {
    return { name: ACTIONS.ENCHANT, confidence: 0.0, reason: 'No enchanting table nearby' };
  }
  if ((senses.countItem('lapis_lazuli') || 0) < 1) {
    return { name: ACTIONS.ENCHANT, confidence: 0.0, reason: 'Enchanting needs lapis lazuli' };
  }

  const inv = senses.bot?.inventory?.items() || [];
  const gear = inv.find(i => /^(diamond|iron)_(sword|pickaxe|axe|chestplate|helmet|leggings|boots)$/.test(i.name));
  if (!gear) {
    return { name: ACTIONS.ENCHANT, confidence: 0.0, reason: 'Nothing worth enchanting held' };
  }

  const xp = senses.bot?.experience?.level ?? 0;
  if (xp < 1) {
    return { name: ACTIONS.ENCHANT, confidence: 0.0, reason: 'Need XP levels first — mine and smelt more' };
  }

  return {
    name: ACTIONS.ENCHANT,
    confidence: 0.90,
    table: table.position,
    gear: gear.name,
    reason: `Enchanting ${gear.name} with ${xp} XP levels banked`
  };
}

module.exports = evaluateEnchant;
