const { ACTIONS } = require('../../../shared/constants');

const VALUABLES = [
  'diamond', 'emerald', 'iron_ingot', 'gold_ingot', 'iron_pickaxe',
  'iron_sword', 'bread', 'cooked_beef', 'apple', 'saddle', 'obsidian',
  'lapis_lazuli', 'redstone', 'coal'
];

function evaluateLootStructure(senses, stats) {
  const chest = senses.getNearbyBlock?.('chest', 12) ||
                senses.getNearbyBlock?.('trapped_chest', 12);
  if (!chest) {
    return { name: ACTIONS.LOOT_STRUCTURE, confidence: 0.0, reason: 'No lootable chest nearby' };
  }

  const hostiles = senses.getNearbyHostileMobs?.(8) || [];
  const armed = senses.hasItem('sword') || senses.hasItem('stone_sword') ||
                senses.hasItem('iron_sword') || senses.hasItem('diamond_sword') ||
                senses.hasItem('bow');
  if (hostiles.length > 0 && !armed) {
    return { name: ACTIONS.LOOT_STRUCTURE, confidence: 0.0, reason: 'Chest guarded and unarmed — not worth dying' };
  }

  return {
    name: ACTIONS.LOOT_STRUCTURE,
    confidence: hostiles.length > 0 ? 0.62 : 0.88,
    chest: chest.position,
    reason: hostiles.length > 0
      ? `Looting chest under threat (${hostiles.length} hostiles, armed)`
      : 'Unclaimed chest nearby — recovering valuables'
  };
}

module.exports = evaluateLootStructure;
module.exports.VALUABLES = VALUABLES;
