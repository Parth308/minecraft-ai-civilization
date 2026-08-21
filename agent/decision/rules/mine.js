const { ACTIONS } = require('../../../shared/constants');

function evaluateMine(senses, stats) {
  // Check wood inventory
  const logCount = senses.countItem('log') || (
    senses.countItem('oak_log') +
    senses.countItem('birch_log') +
    senses.countItem('spruce_log') +
    senses.countItem('jungle_log') +
    senses.countItem('acacia_log') +
    senses.countItem('dark_oak_log') +
    senses.countItem('mangrove_log') +
    senses.countItem('cherry_log')
  );
  const plankCount = senses.countItem('oak_planks') + senses.countItem('birch_planks') + senses.countItem('spruce_planks');

  // Priority 1: Bootstrap wood gathering (< 16 wood materials) — highest early priority
  if (logCount + plankCount < 16 && stats.health > 8) {
    const tree = senses.getNearbyBlock('log', 24);
    if (tree) {
      return {
        name: ACTIONS.MINE,
        confidence: 0.88,
        targetBlock: tree,
        reason: `Bootstrap wood gathering: found ${tree.name} (have ${logCount} logs, need basic survival resources)`
      };
    }
  }

  // Priority 2: Routine resource mining (coal, iron, stone) when in good condition
  if (stats.health > 14 && stats.fatigue < 60 && stats.hunger > 30) {
    const targetBlock = senses.getNearbyBlock('coal_ore', 16) ||
                        senses.getNearbyBlock('iron_ore', 16) ||
                        senses.getNearbyBlock('copper_ore', 16) ||
                        senses.getNearbyBlock('log', 16);
    if (targetBlock) {
      return {
        name: ACTIONS.MINE,
        confidence: 0.72,
        targetBlock,
        reason: `Gathering mineral/building resource: ${targetBlock.name}`
      };
    }
  }

  return { name: ACTIONS.MINE, confidence: 0.10, reason: 'No immediate mining target nearby' };
}

module.exports = evaluateMine;
