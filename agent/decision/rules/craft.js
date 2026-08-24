const { ACTIONS } = require('../../../shared/constants');

const craftCooldowns = new Map();

function setCraftCooldown(itemName, durationMs = 30000) {
  craftCooldowns.set(itemName, Date.now() + durationMs);
}

function isCraftOnCooldown(itemName) {
  const expiry = craftCooldowns.get(itemName);
  if (!expiry) return false;
  if (Date.now() > expiry) {
    craftCooldowns.delete(itemName);
    return false;
  }
  return true;
}

function evaluateCraft(senses, stats) {
  const hasStonePickOrBetter = senses.hasItem('stone_pickaxe') ||
                               senses.hasItem('iron_pickaxe') ||
                               senses.hasItem('diamond_pickaxe') ||
                               senses.hasItem('golden_pickaxe') ||
                               senses.hasItem('netherite_pickaxe');

  const hasPickaxe = hasStonePickOrBetter || senses.hasItem('wooden_pickaxe');

  const hasAxe = senses.hasItem('stone_axe') ||
                 senses.hasItem('iron_axe') ||
                 senses.hasItem('diamond_axe') ||
                 senses.hasItem('wooden_axe');

  const hasSword = senses.hasItem('stone_sword') ||
                   senses.hasItem('iron_sword') ||
                   senses.hasItem('diamond_sword') ||
                   senses.hasItem('wooden_sword');

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

  // Helper to verify ingredient quantities
  const hasRequiredIngredients = (requirements) => {
    return requirements.every(req => {
      const current = typeof req.count === 'number' ? req.count : senses.countItem(req.item);
      return current >= req.min;
    });
  };

  const WOOD_TO_PLANKS = {
    oak_log: 'oak_planks', stripped_oak_log: 'oak_planks', oak_wood: 'oak_planks', stripped_oak_wood: 'oak_planks',
    birch_log: 'birch_planks', stripped_birch_log: 'birch_planks', birch_wood: 'birch_planks', stripped_birch_wood: 'birch_planks',
    spruce_log: 'spruce_planks', stripped_spruce_log: 'spruce_planks', spruce_wood: 'spruce_planks', stripped_spruce_wood: 'spruce_planks',
    jungle_log: 'jungle_planks', stripped_jungle_log: 'jungle_planks', jungle_wood: 'jungle_planks', stripped_jungle_wood: 'jungle_planks',
    acacia_log: 'acacia_planks', stripped_acacia_log: 'acacia_planks', acacia_wood: 'acacia_planks', stripped_acacia_wood: 'acacia_planks',
    dark_oak_log: 'dark_oak_planks', stripped_dark_oak_log: 'dark_oak_planks', dark_oak_wood: 'dark_oak_planks', stripped_dark_oak_wood: 'dark_oak_planks',
    mangrove_log: 'mangrove_planks', stripped_mangrove_log: 'mangrove_planks', mangrove_wood: 'mangrove_planks', stripped_mangrove_wood: 'mangrove_planks',
    cherry_log: 'cherry_planks', stripped_cherry_log: 'cherry_planks', cherry_wood: 'cherry_planks', stripped_cherry_wood: 'cherry_planks',
    bamboo_block: 'bamboo_planks', stripped_bamboo_block: 'bamboo_planks',
    crimson_stem: 'crimson_planks', stripped_crimson_stem: 'crimson_planks',
    warped_stem: 'warped_planks', stripped_warped_stem: 'warped_planks'
  };

  // 1. Logs -> Planks (2x2 craft in inventory)
  if (logCount >= 1 && plankCount < 16) {
    let logItem = 'oak_planks';
    for (const [rawWood, plankType] of Object.entries(WOOD_TO_PLANKS)) {
      if (senses.hasItem(rawWood)) {
        logItem = plankType;
        break;
      }
    }

    if (!isCraftOnCooldown(logItem) && hasRequiredIngredients([{ item: 'log', count: logCount, min: 1 }])) {
      return {
        name: ACTIONS.CRAFT,
        confidence: 0.94,
        itemToCraft: logItem,
        count: logCount * 4,
        reason: `Refining ${logCount} raw logs into ${logItem}`
      };
    }
  }

  // 2. Planks -> Sticks (2x2 craft in inventory) — ONLY if we need sticks for uncrafted tools
  if (plankCount >= 2 && stickCount < 4 && (!hasStonePickOrBetter || !hasAxe || !hasSword)) {
    if (!isCraftOnCooldown('stick') && hasRequiredIngredients([{ item: 'planks', count: plankCount, min: 2 }])) {
      return {
        name: ACTIONS.CRAFT,
        confidence: 0.92,
        itemToCraft: 'stick',
        count: 4,
        reason: `Crafting sticks for tool crafting (have ${plankCount} planks)`
      };
    }
  }

  // 3. Planks -> Crafting Table (2x2 craft in inventory)
  if (plankCount >= 4 && !hasTable) {
    if (!isCraftOnCooldown('crafting_table') && hasRequiredIngredients([{ item: 'planks', count: plankCount, min: 4 }])) {
      return {
        name: ACTIONS.CRAFT,
        confidence: 0.93,
        itemToCraft: 'crafting_table',
        count: 1,
        reason: `Crafting workbench table for tool construction`
      };
    }
  }

  // 4. Cobblestone + Sticks -> Stone Pickaxe (3x3 craft)
  // ONLY if the bot does NOT already have a stone or better pickaxe!
  if (cobbleCount >= 3 && stickCount >= 2 && !hasStonePickOrBetter) {
    const hasWorkbenchAccess = hasTable || senses.hasItem('crafting_table') || plankCount >= 4;
    if (!isCraftOnCooldown('stone_pickaxe') && hasWorkbenchAccess && hasRequiredIngredients([
      { item: 'cobblestone', count: cobbleCount, min: 3 },
      { item: 'stick', count: stickCount, min: 2 }
    ])) {
      return {
        name: ACTIONS.CRAFT,
        confidence: 0.96,
        itemToCraft: 'stone_pickaxe',
        count: 1,
        reason: `Upgrading to stone pickaxe (have ${cobbleCount} cobblestone, ${stickCount} sticks)`
      };
    }
  }

  // 5. Planks + Sticks -> Wooden Pickaxe (3x3 craft)
  // ONLY if the bot has NO pickaxe at all!
  if (!hasPickaxe && plankCount >= 3 && stickCount >= 2) {
    const hasWorkbenchAccess = hasTable || senses.hasItem('crafting_table') || plankCount >= 4;
    if (!isCraftOnCooldown('wooden_pickaxe') && hasWorkbenchAccess && hasRequiredIngredients([
      { item: 'planks', count: plankCount, min: 3 },
      { item: 'stick', count: stickCount, min: 2 }
    ])) {
      return {
        name: ACTIONS.CRAFT,
        confidence: 0.95,
        itemToCraft: 'wooden_pickaxe',
        count: 1,
        reason: `Crafting wooden pickaxe to enable stone and coal mining`
      };
    }
  }

  // 6. Cobblestone + Sticks -> Stone Sword (3x3 craft)
  if (cobbleCount >= 2 && stickCount >= 1 && !hasSword) {
    const hasWorkbenchAccess = hasTable || senses.hasItem('crafting_table') || plankCount >= 4;
    if (!isCraftOnCooldown('stone_sword') && hasWorkbenchAccess && hasRequiredIngredients([
      { item: 'cobblestone', count: cobbleCount, min: 2 },
      { item: 'stick', count: stickCount, min: 1 }
    ])) {
      return {
        name: ACTIONS.CRAFT,
        confidence: 0.88,
        itemToCraft: 'stone_sword',
        count: 1,
        reason: `Crafting stone sword for self-defense and hunting`
      };
    }
  }

  // 7. Cobblestone + Sticks -> Stone Axe (3x3 craft)
  if (cobbleCount >= 3 && stickCount >= 2 && !hasAxe) {
    const hasWorkbenchAccess = hasTable || senses.hasItem('crafting_table') || plankCount >= 4;
    if (!isCraftOnCooldown('stone_axe') && hasWorkbenchAccess && hasRequiredIngredients([
      { item: 'cobblestone', count: cobbleCount, min: 3 },
      { item: 'stick', count: stickCount, min: 2 }
    ])) {
      return {
        name: ACTIONS.CRAFT,
        confidence: 0.86,
        itemToCraft: 'stone_axe',
        count: 1,
        reason: `Crafting stone axe for faster wood harvesting`
      };
    }
  }

  // 8. Planks + Sticks -> Wooden Axe (3x3 craft)
  if (!hasAxe && plankCount >= 3 && stickCount >= 2 && cobbleCount < 3) {
    const hasWorkbenchAccess = hasTable || senses.hasItem('crafting_table') || plankCount >= 4;
    if (!isCraftOnCooldown('wooden_axe') && hasWorkbenchAccess && hasRequiredIngredients([
      { item: 'planks', count: plankCount, min: 3 },
      { item: 'stick', count: stickCount, min: 2 }
    ])) {
      return {
        name: ACTIONS.CRAFT,
        confidence: 0.82,
        itemToCraft: 'wooden_axe',
        count: 1,
        reason: `Crafting wooden axe for wood gathering`
      };
    }
  }

  return { name: ACTIONS.CRAFT, confidence: 0.0, reason: 'All essential tools crafted or missing ingredients' };
}

module.exports = evaluateCraft;
module.exports.setCraftCooldown = setCraftCooldown;
module.exports.isCraftOnCooldown = isCraftOnCooldown;

