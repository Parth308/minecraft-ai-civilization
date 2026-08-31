const { ACTIONS } = require('../../../shared/constants');

const ORE_VALUES = {
  diamond_ore: 10, deepslate_diamond_ore: 10,
  emerald_ore: 8, deepslate_emerald_ore: 8,
  gold_ore: 6, deepslate_gold_ore: 6, nether_gold_ore: 6,
  redstone_ore: 5, deepslate_redstone_ore: 5, nether_redstone_ore: 5,
  iron_ore: 4, deepslate_iron_ore: 4,
  copper_ore: 3, deepslate_copper_ore: 3,
  coal_ore: 2, deepslate_coal_ore: 2, nether_coal_ore: 2,
  lapis_ore: 7, deepslate_lapis_ore: 7,
};

const ORE_SEARCH_RADIUS = 24;
const MAX_SEARCH_RADIUS = 32;

function scoreOre(block, inventory) {
  const baseValue = ORE_VALUES[block.name] || 0;
  const distance = block.distance || 0;
  const distPenalty = Math.max(0, 1 - (distance / MAX_SEARCH_RADIUS));
  const rarityBonus = baseValue >= 8 ? 1.2 : baseValue >= 5 ? 1.1 : 1.0;
  const needBoost = getNeedMultiplier(block.name, inventory);
  return baseValue * distPenalty * rarityBonus * needBoost;
}

function getNeedMultiplier(oreName, inventory) {
  const counts = {
    iron: (inventory.iron_ingot || 0) + (inventory.raw_iron || 0),
    diamond: inventory.diamond || 0,
    gold: (inventory.gold_ingot || 0) + (inventory.raw_gold || 0),
    coal: inventory.coal || 0,
    redstone: inventory.redstone || 0,
    lapis: inventory.lapis_lazuli || 0,
    copper: (inventory.copper_ingot || 0) + (inventory.raw_copper || 0),
    emerald: inventory.emerald || 0,
  };

  if (oreName.includes('iron')) return counts.iron < 8 ? 1.5 : counts.iron < 20 ? 1.2 : 0.8;
  if (oreName.includes('diamond')) return counts.diamond < 5 ? 1.4 : 0.7;
  if (oreName.includes('gold')) return counts.gold < 8 ? 1.3 : 0.9;
  if (oreName.includes('coal')) return counts.coal < 16 ? 1.5 : 0.6;
  if (oreName.includes('redstone')) return counts.redstone < 16 ? 1.2 : 0.8;
  if (oreName.includes('lapis')) return counts.lapis < 12 ? 1.3 : 0.9;
  if (oreName.includes('copper')) return counts.copper < 16 ? 1.2 : 0.7;
  if (oreName.includes('emerald')) return counts.emerald < 12 ? 1.3 : 0.8;
  return 1.0;
}

function evaluateMine(senses, stats) {
  const hasPickaxe = senses.hasItem('wooden_pickaxe') ||
                     senses.hasItem('stone_pickaxe') ||
                     senses.hasItem('iron_pickaxe') ||
                     senses.hasItem('diamond_pickaxe') ||
                     senses.hasItem('golden_pickaxe') ||
                     senses.hasItem('netherite_pickaxe');

  const logCount = senses.countItem('log');
  const plankCount = senses.countItem('planks');
  const cobbleCount = senses.countItem('cobblestone') + senses.countItem('cobbled_deepslate');

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

  if (hasPickaxe && stats.health > 10 && stats.fatigue < 70 && stats.hunger > 20) {
    const inventory = {};
    for (const item of (senses.bot?.inventory?.items() || [])) {
      inventory[item.name] = (inventory[item.name] || 0) + item.count;
    }

    const candidates = [];
    const nearbyOres = senses.getNearbyOres(ORE_SEARCH_RADIUS) || [];

    for (const block of nearbyOres) {
      const oreName = block.name;
      const requiresIron = ['diamond_ore', 'deepslate_diamond_ore', 'emerald_ore', 'deepslate_emerald_ore',
                            'gold_ore', 'deepslate_gold_ore', 'nether_gold_ore',
                            'redstone_ore', 'deepslate_redstone_ore', 'nether_redstone_ore',
                            'lapis_ore', 'deepslate_lapis_ore'].includes(oreName);
      const requiresStone = ['iron_ore', 'deepslate_iron_ore', 'copper_ore', 'deepslate_copper_ore'].includes(oreName);

      if (requiresIron && !hasIronPickOrBetter) continue;
      if (requiresStone && !hasStonePickOrBetter) continue;

      const score = scoreOre(block, inventory);
      candidates.push({ block, score, oreName });
    }

    if (candidates.length > 0) {
      candidates.sort((a, b) => b.score - a.score);
      const best = candidates[0];
      const confidence = Math.min(0.95, 0.70 + (best.score / 15));
      return {
        name: ACTIONS.MINE,
        confidence,
        targetBlock: best.block,
        reason: `Mining ${best.oreName.replace(/_/g, ' ')} (score: ${best.score.toFixed(2)}, value: ${ORE_VALUES[best.oreName]})`
      };
    }
  }

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

  return {
    name: ACTIONS.MINE,
    confidence: 0.10,
    reason: hasPickaxe ? 'Sufficient stone gathered; ready for higher-level civilization tasks' : 'Cannot mine stone without pickaxe'
  };
}

module.exports = evaluateMine;

