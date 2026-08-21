const { ACTIONS } = require('../../../shared/constants');

function evaluateCraft(senses, stats) {
  const hasPickaxe = senses.hasItem('wooden_pickaxe') ||
                     senses.hasItem('stone_pickaxe') ||
                     senses.hasItem('iron_pickaxe') ||
                     senses.hasItem('diamond_pickaxe') ||
                     senses.hasItem('golden_pickaxe') ||
                     senses.hasItem('netherite_pickaxe');

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
                     senses.countItem('spruce_planks') +
                     senses.countItem('jungle_planks') +
                     senses.countItem('acacia_planks') +
                     senses.countItem('dark_oak_planks') +
                     senses.countItem('mangrove_planks') +
                     senses.countItem('cherry_planks');

  const stickCount = senses.countItem('stick');
  const cobbleCount = senses.countItem('cobblestone') + senses.countItem('cobbled_deepslate');
  const hasTable = senses.hasItem('crafting_table') || !!senses.getNearbyBlock('crafting_table', 8);

  // 1. Logs -> Planks (2x2 craft in inventory)
  if (logCount > 0) {
    const logItem = senses.hasItem('oak_log') ? 'oak_planks' :
                    senses.hasItem('birch_log') ? 'birch_planks' :
                    senses.hasItem('spruce_log') ? 'spruce_planks' : 'oak_planks';
    return {
      name: ACTIONS.CRAFT,
      confidence: 0.94,
      itemToCraft: logItem,
      count: logCount * 4,
      reason: `Refining ${logCount} raw logs into wooden planks`
    };
  }

  // 2. Planks -> Sticks (2x2 craft in inventory)
  if (plankCount >= 2 && stickCount < 4) {
    return {
      name: ACTIONS.CRAFT,
      confidence: 0.92,
      itemToCraft: 'stick',
      count: 4,
      reason: `Crafting sticks for tool crafting (have ${plankCount} planks)`
    };
  }

  // 3. Planks -> Crafting Table (2x2 craft in inventory)
  if (plankCount >= 4 && !hasTable) {
    return {
      name: ACTIONS.CRAFT,
      confidence: 0.93,
      itemToCraft: 'crafting_table',
      count: 1,
      reason: `Crafting workbench table for tool construction`
    };
  }

  // 4. Cobblestone + Sticks -> Stone Pickaxe (3x3 craft)
  if (cobbleCount >= 3 && stickCount >= 2 && (!hasPickaxe || senses.hasItem('wooden_pickaxe'))) {
    return {
      name: ACTIONS.CRAFT,
      confidence: 0.96,
      itemToCraft: 'stone_pickaxe',
      count: 1,
      reason: `Upgrading to stone pickaxe (have ${cobbleCount} cobblestone, ${stickCount} sticks)`
    };
  }

  // 5. Planks + Sticks -> Wooden Pickaxe (3x3 craft)
  if (!hasPickaxe && plankCount >= 3 && stickCount >= 2) {
    return {
      name: ACTIONS.CRAFT,
      confidence: 0.95,
      itemToCraft: 'wooden_pickaxe',
      count: 1,
      reason: `Crafting wooden pickaxe to enable stone and coal mining`
    };
  }

  // 6. Planks + Sticks -> Wooden Axe (3x3 craft)
  if (!senses.hasItem('wooden_axe') && !senses.hasItem('stone_axe') && plankCount >= 3 && stickCount >= 2) {
    return {
      name: ACTIONS.CRAFT,
      confidence: 0.85,
      itemToCraft: 'wooden_axe',
      count: 1,
      reason: `Crafting wooden axe to speed up wood gathering`
    };
  }

  // 7. Cobblestone + Sticks -> Stone Sword / Axe
  if (cobbleCount >= 3 && stickCount >= 2 && !senses.hasItem('stone_axe')) {
    return {
      name: ACTIONS.CRAFT,
      confidence: 0.84,
      itemToCraft: 'stone_axe',
      count: 1,
      reason: `Crafting stone axe for faster wood harvesting`
    };
  }

  return { name: ACTIONS.CRAFT, confidence: 0.0, reason: 'No crafting recipe ready or needed' };
}

module.exports = evaluateCraft;
