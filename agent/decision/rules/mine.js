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

  const cobbleCount = senses.countItem('cobblestone') + senses.countItem('cobbled_deepslate');

  // Priority 1: Bootstrap wood gathering (< 8 wood materials) — gather essential wood for crafting
  if (logCount + plankCount < 8 && stats.health > 8) {
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

  const hasIronPickOrBetter = senses.hasItem('iron_pickaxe') ||
                              senses.hasItem('diamond_pickaxe') ||
                              senses.hasItem('netherite_pickaxe');

  const hasStonePickOrBetter = hasIronPickOrBetter || senses.hasItem('stone_pickaxe');

  // Priority 2: High-value ores with tool tier prerequisites
  if (hasPickaxe && stats.health > 10 && stats.fatigue < 70 && stats.hunger > 20) {
    let valuableOre = null;

    // Diamond, Gold, Redstone, Emerald need Iron+ pickaxe
    if (hasIronPickOrBetter) {
      valuableOre = senses.getNearbyBlock('diamond_ore', 20) ||
                    senses.getNearbyBlock('deepslate_diamond_ore', 20) ||
                    senses.getNearbyBlock('gold_ore', 16) ||
                    senses.getNearbyBlock('emerald_ore', 16) ||
                    senses.getNearbyBlock('redstone_ore', 16);
    }

    // Iron and Coal can be mined with Stone+ pickaxe
    if (!valuableOre && hasStonePickOrBetter) {
      valuableOre = senses.getNearbyBlock('iron_ore', 20) ||
                    senses.getNearbyBlock('deepslate_iron_ore', 20) ||
                    senses.getNearbyBlock('copper_ore', 16);
    }

    // Coal can be mined with any pickaxe
    if (!valuableOre) {
      valuableOre = senses.getNearbyBlock('coal_ore', 16) ||
                    senses.getNearbyBlock('deepslate_coal_ore', 16);
    }

    if (valuableOre) {
      return {
        name: ACTIONS.MINE,
        confidence: 0.88,
        targetBlock: valuableOre,
        reason: `Mining valuable resource: ${valuableOre.name}`
      };
    }
  }


  // Priority 3: Initial Cobblestone gathering (only if we have less than 16 cobblestone)
  if (hasPickaxe && cobbleCount < 16 && stats.health > 12 && stats.fatigue < 70) {
    const stoneBlock = senses.getNearbyBlock('stone', 12) || senses.getNearbyBlock('deepslate', 12);
    if (stoneBlock) {
      return {
        name: ACTIONS.MINE,
        confidence: 0.75,
        targetBlock: stoneBlock,
        reason: `Mining stone for tool upgrades (have ${cobbleCount}/16 cobblestone)`
      };
    }
  }

  // Once basic materials are gathered, drop mining confidence so LLM/social/building takes over!
  return {
    name: ACTIONS.MINE,
    confidence: 0.10,
    reason: hasPickaxe ? 'Sufficient stone gathered; ready for higher-level civilization tasks' : 'Cannot mine stone without pickaxe'
  };
}

module.exports = evaluateMine;

