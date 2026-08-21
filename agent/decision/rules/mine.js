const { ACTIONS } = require('../../../shared/constants');

function evaluateMine(senses, stats) {
  const hasPickaxe = senses.hasItem('wooden_pickaxe') ||
                     senses.hasItem('stone_pickaxe') ||
                     senses.hasItem('iron_pickaxe') ||
                     senses.hasItem('diamond_pickaxe') ||
                     senses.hasItem('golden_pickaxe') ||
                     senses.hasItem('netherite_pickaxe');

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
  const plankCount = senses.countItem('oak_planks') +
                     senses.countItem('birch_planks') +
                     senses.countItem('spruce_planks');

  // Priority 1: Bootstrap wood gathering (< 16 wood materials) — always chop trees first
  if (logCount + plankCount < 16 && stats.health > 8) {
    const tree = senses.getNearbyBlock('log', 32);
    if (tree) {
      return {
        name: ACTIONS.MINE,
        confidence: 0.90,
        targetBlock: tree,
        reason: `Chopping tree: found ${tree.name} (have ${logCount} logs, need wood for tools)`
      };
    }
  }

  // Priority 2: Routine resource mining (ONLY if bot has a pickaxe!)
  // In Minecraft, mining stone/ore by hand drops NOTHING and wastes time!
  if (hasPickaxe && stats.health > 12 && stats.fatigue < 70 && stats.hunger > 30) {
    const targetBlock = senses.getNearbyBlock('iron_ore', 16) ||
                        senses.getNearbyBlock('coal_ore', 16) ||
                        senses.getNearbyBlock('copper_ore', 16) ||
                        senses.getNearbyBlock('stone', 12) ||
                        senses.getNearbyBlock('deepslate', 12);
    if (targetBlock) {
      return {
        name: ACTIONS.MINE,
        confidence: 0.82,
        targetBlock,
        reason: `Mining ${targetBlock.name} with pickaxe`
      };
    }
  }

  return {
    name: ACTIONS.MINE,
    confidence: 0.10,
    reason: hasPickaxe ? 'No mining targets nearby' : 'Cannot mine stone/ores without a pickaxe — find wood first'
  };
}

module.exports = evaluateMine;

