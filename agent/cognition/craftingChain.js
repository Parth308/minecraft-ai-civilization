const logger = require('../../shared/logger');

/**
 * Crafting Chain Planner — Minecraft 1.20.4 Tech Tree
 *
 * Defines the full progression graph from bare hands → netherite gear.
 * Each node specifies:
 *   - id: canonical item name
 *   - tier: progression phase (0=bare hands, 1=wood, 2=stone, 3=iron, 4=diamond, 5=netherite)
 *   - category: tool/armor/utility/weapon
 *   - ingredients: [{ item, count }] — what's consumed
 *   - source: 'craft' | 'smelt' | 'gather' — how to obtain
 *   - requiresTable: true if needs 3x3 crafting grid
 *   - value: relative worth (higher = more useful)
 *   - next: ids of items this enables (downstream unlocks)
 *
 * The planner walks this graph to find the highest-value craftable chain
 * given current inventory.
 */

const TECH_TREE = [
  // ── Tier 0: Bare Hands / Gathered ──────────────────────────────────────
  { id: 'stick', tier: 0, category: 'material', source: 'craft', requiresTable: false,
    ingredients: [{ item: 'planks', count: 2 }],
    value: 1, next: ['wooden_pickaxe', 'wooden_sword', 'wooden_axe', 'wooden_shovel', 'crafting_table', 'fishing_rod'] },

  { id: 'crafting_table', tier: 0, category: 'utility', source: 'craft', requiresTable: false,
    ingredients: [{ item: 'planks', count: 4 }],
    value: 2, next: ['chest', 'furnace', 'stone_pickaxe', 'stone_sword', 'stone_axe', 'stone_shovel', 'shield', 'bucket', 'anvil'] },

  // ── Tier 1: Wood Tools ─────────────────────────────────────────────────
  { id: 'wooden_pickaxe', tier: 1, category: 'tool', source: 'craft', requiresTable: true,
    ingredients: [{ item: 'planks', count: 3 }, { item: 'stick', count: 2 }],
    value: 3, next: ['stone_pickaxe'] },

  { id: 'wooden_axe', tier: 1, category: 'tool', source: 'craft', requiresTable: true,
    ingredients: [{ item: 'planks', count: 3 }, { item: 'stick', count: 2 }],
    value: 2, next: ['stone_axe'] },

  { id: 'wooden_sword', tier: 1, category: 'weapon', source: 'craft', requiresTable: true,
    ingredients: [{ item: 'planks', count: 2 }, { item: 'stick', count: 1 }],
    value: 2, next: ['stone_sword'] },

  { id: 'wooden_shovel', tier: 1, category: 'tool', source: 'craft', requiresTable: true,
    ingredients: [{ item: 'planks', count: 1 }, { item: 'stick', count: 2 }],
    value: 1, next: ['stone_shovel'] },

  // ── Tier 2: Stone Tools ────────────────────────────────────────────────
  { id: 'stone_pickaxe', tier: 2, category: 'tool', source: 'craft', requiresTable: true,
    ingredients: [{ item: 'cobblestone', count: 3 }, { item: 'stick', count: 2 }],
    value: 5, next: ['iron_pickaxe', 'furnace'] },

  { id: 'stone_axe', tier: 2, category: 'tool', source: 'craft', requiresTable: true,
    ingredients: [{ item: 'cobblestone', count: 3 }, { item: 'stick', count: 2 }],
    value: 3, next: ['iron_axe'] },

  { id: 'stone_sword', tier: 2, category: 'weapon', source: 'craft', requiresTable: true,
    ingredients: [{ item: 'cobblestone', count: 2 }, { item: 'stick', count: 1 }],
    value: 3, next: ['iron_sword'] },

  { id: 'stone_shovel', tier: 2, category: 'tool', source: 'craft', requiresTable: true,
    ingredients: [{ item: 'cobblestone', count: 1 }, { item: 'stick', count: 2 }],
    value: 2, next: ['iron_shovel'] },

  // ── Utility ────────────────────────────────────────────────────────────
  { id: 'furnace', tier: 2, category: 'utility', source: 'craft', requiresTable: true,
    ingredients: [{ item: 'cobblestone', count: 8 }],
    value: 6, next: ['iron_ingot', 'gold_ingot', 'glass', 'stone_bricks', 'cooked_food'] },

  { id: 'chest', tier: 1, category: 'utility', source: 'craft', requiresTable: true,
    ingredients: [{ item: 'planks', count: 8 }],
    value: 4, next: [] },

  { id: 'shield', tier: 2, category: 'armor', source: 'craft', requiresTable: true,
    ingredients: [{ item: 'planks', count: 6 }, { item: 'iron_ingot', count: 1 }],
    value: 4, next: [] },

  { id: 'bucket', tier: 2, category: 'utility', source: 'craft', requiresTable: true,
    ingredients: [{ item: 'iron_ingot', count: 3 }],
    value: 5, next: ['water_bucket', 'lava_bucket', 'milk_bucket'] },

  { id: 'fishing_rod', tier: 1, category: 'tool', source: 'craft', requiresTable: true,
    ingredients: [{ item: 'stick', count: 3 }, { item: 'string', count: 2 }],
    value: 2, next: [] },

  // ── Tier 3: Iron Tools & Armor ─────────────────────────────────────────
  { id: 'iron_pickaxe', tier: 3, category: 'tool', source: 'craft', requiresTable: true,
    ingredients: [{ item: 'iron_ingot', count: 3 }, { item: 'stick', count: 2 }],
    value: 8, next: ['diamond_pickaxe', 'rail', 'minecart'] },

  { id: 'iron_axe', tier: 3, category: 'tool', source: 'craft', requiresTable: true,
    ingredients: [{ item: 'iron_ingot', count: 3 }, { item: 'stick', count: 2 }],
    value: 5, next: ['diamond_axe'] },

  { id: 'iron_sword', tier: 3, category: 'weapon', source: 'craft', requiresTable: true,
    ingredients: [{ item: 'iron_ingot', count: 2 }, { item: 'stick', count: 1 }],
    value: 5, next: ['diamond_sword'] },

  { id: 'iron_shovel', tier: 3, category: 'tool', source: 'craft', requiresTable: true,
    ingredients: [{ item: 'iron_ingot', count: 1 }, { item: 'stick', count: 2 }],
    value: 3, next: ['diamond_shovel'] },

  { id: 'iron_helmet', tier: 3, category: 'armor', source: 'craft', requiresTable: true,
    ingredients: [{ item: 'iron_ingot', count: 5 }],
    value: 4, next: ['diamond_helmet'] },

  { id: 'iron_chestplate', tier: 3, category: 'armor', source: 'craft', requiresTable: true,
    ingredients: [{ item: 'iron_ingot', count: 8 }],
    value: 6, next: ['diamond_chestplate'] },

  { id: 'iron_leggings', tier: 3, category: 'armor', source: 'craft', requiresTable: true,
    ingredients: [{ item: 'iron_ingot', count: 7 }],
    value: 5, next: ['diamond_leggings'] },

  { id: 'iron_boots', tier: 3, category: 'armor', source: 'craft', requiresTable: true,
    ingredients: [{ item: 'iron_ingot', count: 4 }],
    value: 3, next: ['diamond_boots'] },

  { id: 'anvil', tier: 3, category: 'utility', source: 'craft', requiresTable: true,
    ingredients: [{ item: 'iron_ingot', count: 31 }, { item: 'iron_block', count: 3 }],
    value: 4, next: [] },

  { id: 'rail', tier: 3, category: 'utility', source: 'craft', requiresTable: true,
    ingredients: [{ item: 'iron_ingot', count: 6 }, { item: 'stick', count: 1 }],
    value: 3, next: ['powered_rail'] },

  { id: 'minecart', tier: 3, category: 'utility', source: 'craft', requiresTable: true,
    ingredients: [{ item: 'iron_ingot', count: 5 }],
    value: 3, next: [] },

  // ── Tier 4: Diamond Tools & Armor ──────────────────────────────────────
  { id: 'diamond_pickaxe', tier: 4, category: 'tool', source: 'craft', requiresTable: true,
    ingredients: [{ item: 'diamond', count: 3 }, { item: 'stick', count: 2 }],
    value: 12, next: ['netherite_pickaxe'] },

  { id: 'diamond_axe', tier: 4, category: 'tool', source: 'craft', requiresTable: true,
    ingredients: [{ item: 'diamond', count: 3 }, { item: 'stick', count: 2 }],
    value: 8, next: ['netherite_axe'] },

  { id: 'diamond_sword', tier: 4, category: 'weapon', source: 'craft', requiresTable: true,
    ingredients: [{ item: 'diamond', count: 2 }, { item: 'stick', count: 1 }],
    value: 8, next: ['netherite_sword'] },

  { id: 'diamond_shovel', tier: 4, category: 'tool', source: 'craft', requiresTable: true,
    ingredients: [{ item: 'diamond', count: 1 }, { item: 'stick', count: 2 }],
    value: 5, next: ['netherite_shovel'] },

  { id: 'diamond_helmet', tier: 4, category: 'armor', source: 'craft', requiresTable: true,
    ingredients: [{ item: 'diamond', count: 5 }],
    value: 6, next: ['netherite_helmet'] },

  { id: 'diamond_chestplate', tier: 4, category: 'armor', source: 'craft', requiresTable: true,
    ingredients: [{ item: 'diamond', count: 8 }],
    value: 10, next: ['netherite_chestplate'] },

  { id: 'diamond_leggings', tier: 4, category: 'armor', source: 'craft', requiresTable: true,
    ingredients: [{ item: 'diamond', count: 7 }],
    value: 8, next: ['netherite_leggings'] },

  { id: 'diamond_boots', tier: 4, category: 'armor', source: 'craft', requiresTable: true,
    ingredients: [{ item: 'diamond', count: 4 }],
    value: 5, next: ['netherite_boots'] },

  // ── Tier 5: Netherite (endgame) ────────────────────────────────────────
  { id: 'netherite_pickaxe', tier: 5, category: 'tool', source: 'craft', requiresTable: true,
    ingredients: [{ item: 'netherite_ingot', count: 3 }, { item: 'stick', count: 2 }],
    value: 15, next: [] },

  { id: 'netherite_axe', tier: 5, category: 'tool', source: 'craft', requiresTable: true,
    ingredients: [{ item: 'netherite_ingot', count: 3 }, { item: 'stick', count: 2 }],
    value: 10, next: [] },

  { id: 'netherite_sword', tier: 5, category: 'weapon', source: 'craft', requiresTable: true,
    ingredients: [{ item: 'netherite_ingot', count: 2 }, { item: 'stick', count: 1 }],
    value: 10, next: [] },

  { id: 'netherite_shovel', tier: 5, category: 'tool', source: 'craft', requiresTable: true,
    ingredients: [{ item: 'netherite_ingot', count: 1 }, { item: 'stick', count: 2 }],
    value: 6, next: [] },

  { id: 'netherite_helmet', tier: 5, category: 'armor', source: 'craft', requiresTable: true,
    ingredients: [{ item: 'netherite_ingot', count: 1 }],
    value: 7, next: [] },

  { id: 'netherite_chestplate', tier: 5, category: 'armor', source: 'craft', requiresTable: true,
    ingredients: [{ item: 'netherite_ingot', count: 1 }],
    value: 12, next: [] },

  { id: 'netherite_leggings', tier: 5, category: 'armor', source: 'craft', requiresTable: true,
    ingredients: [{ item: 'netherite_ingot', count: 1 }],
    value: 9, next: [] },

  { id: 'netherite_boots', tier: 5, category: 'armor', source: 'craft', requiresTable: true,
    ingredients: [{ item: 'netherite_ingot', count: 1 }],
    value: 6, next: [] },

  // ── Smelted intermediates ──────────────────────────────────────────────
  { id: 'iron_ingot', tier: 3, category: 'material', source: 'smelt', requiresTable: false,
    ingredients: [{ item: 'raw_iron', count: 1 }],
    value: 4, next: ['iron_pickaxe', 'iron_axe', 'iron_sword', 'iron_shovel', 'iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots', 'bucket', 'shield', 'anvil', 'rail', 'minecart', 'iron_block'] },

  { id: 'iron_block', tier: 3, category: 'material', source: 'craft', requiresTable: true,
    ingredients: [{ item: 'iron_ingot', count: 9 }],
    value: 2, next: ['anvil'] },

  { id: 'gold_ingot', tier: 3, category: 'material', source: 'smelt', requiresTable: false,
    ingredients: [{ item: 'raw_gold', count: 1 }],
    value: 3, next: ['golden_apple', 'powered_rail'] },

  { id: 'netherite_ingot', tier: 5, category: 'material', source: 'smelt', requiresTable: false,
    ingredients: [{ item: 'netherite_scrap', count: 4 }, { item: 'gold_ingot', count: 4 }],
    value: 14, next: ['netherite_pickaxe', 'netherite_axe', 'netherite_sword', 'netherite_shovel', 'netherite_helmet', 'netherite_chestplate', 'netherite_leggings', 'netherite_boots'] },

  { id: 'netherite_scrap', tier: 5, category: 'material', source: 'smelt', requiresTable: false,
    ingredients: [{ item: 'ancient_debris', count: 1 }],
    value: 13, next: ['netherite_ingot'] },

  // ── Food ───────────────────────────────────────────────────────────────
  { id: 'cooked_porkchop', tier: 1, category: 'food', source: 'smelt', requiresTable: false,
    ingredients: [{ item: 'porkchop', count: 1 }],
    value: 3, next: [] },

  { id: 'cooked_beef', tier: 1, category: 'food', source: 'smelt', requiresTable: false,
    ingredients: [{ item: 'beef', count: 1 }],
    value: 3, next: [] },

  { id: 'cooked_chicken', tier: 1, category: 'food', source: 'smelt', requiresTable: false,
    ingredients: [{ item: 'chicken', count: 1 }],
    value: 2, next: [] },

  { id: 'cooked_mutton', tier: 1, category: 'food', source: 'smelt', requiresTable: false,
    ingredients: [{ item: 'mutton', count: 1 }],
    value: 2, next: [] },

  { id: 'cooked_rabbit', tier: 1, category: 'food', source: 'smelt', requiresTable: false,
    ingredients: [{ item: 'rabbit', count: 1 }],
    value: 2, next: [] },

  { id: 'cooked_cod', tier: 1, category: 'food', source: 'smelt', requiresTable: false,
    ingredients: [{ item: 'cod', count: 1 }],
    value: 2, next: [] },

  { id: 'cooked_salmon', tier: 1, category: 'food', source: 'smelt', requiresTable: false,
    ingredients: [{ item: 'salmon', count: 1 }],
    value: 2, next: [] },

  // ── Redstone / Technical ───────────────────────────────────────────────
  { id: 'redstone_torch', tier: 2, category: 'utility', source: 'craft', requiresTable: false,
    ingredients: [{ item: 'stick', count: 1 }, { item: 'redstone', count: 1 }],
    value: 2, next: ['powered_rail'] },

  { id: 'powered_rail', tier: 3, category: 'utility', source: 'craft', requiresTable: true,
    ingredients: [{ item: 'gold_ingot', count: 6 }, { item: 'stick', count: 1 }, { item: 'redstone', count: 1 }],
    value: 3, next: [] },

  { id: 'glass', tier: 2, category: 'material', source: 'smelt', requiresTable: false,
    ingredients: [{ item: 'sand', count: 1 }],
    value: 1, next: [] },

  { id: 'stone_bricks', tier: 2, category: 'material', source: 'smelt', requiresTable: false,
    ingredients: [{ item: 'stone', count: 1 }],
    value: 1, next: [] },

  // ── Misc ───────────────────────────────────────────────────────────────
  { id: 'golden_apple', tier: 3, category: 'food', source: 'craft', requiresTable: true,
    ingredients: [{ item: 'gold_ingot', count: 8 }, { item: 'apple', count: 1 }],
    value: 7, next: [] },
];

// Build lookup maps for O(1) access
const TREE_BY_ID = new Map(TECH_TREE.map(node => [node.id, node]));

// Reverse map: item name → all tech tree nodes that use it as ingredient
const USED_AS_INGREDIENT = new Map();
for (const node of TECH_TREE) {
  for (const ing of node.ingredients) {
    if (!USED_AS_INGREDIENT.has(ing.item)) USED_AS_INGREDIENT.set(ing.item, []);
    USED_AS_INGREDIENT.get(ing.item).push(node.id);
  }
}

/**
 * Check if agent has an item (matching any variant).
 * e.g. hasItem('oak_log') matches 'log' category.
 */
function countItem(senses, itemName) {
  // Direct match
  const direct = senses.countItem(itemName);
  if (direct > 0) return direct;

  // Category matches (log variants → 'log', plank variants → 'planks')
  const CATEGORIES = {
    log: ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log', 'crimson_stem', 'warped_stem'],
    planks: ['oak_planks', 'birch_planks', 'spruce_planks', 'jungle_planks', 'acacia_planks', 'dark_oak_planks', 'mangrove_planks', 'cherry_planks', 'bamboo_planks', 'crimson_planks', 'warped_planks'],
    cobblestone: ['cobblestone', 'cobbled_deepslate'],
    raw_iron: ['raw_iron'],
    raw_gold: ['raw_gold'],
    diamond: ['diamond'],
    netherite_ingot: ['netherite_ingot'],
    netherite_scrap: ['netherite_scrap'],
    ancient_debris: ['ancient_debris'],
    gold_ingot: ['gold_ingot', 'gold_nugget'],
    iron_ingot: ['iron_ingot'],
    redstone: ['redstone'],
    sand: ['sand', 'red_sand'],
    stone: ['stone', 'deepslate'],
    string: ['string'],
    apple: ['apple', 'golden_apple'],
    porkchop: ['porkchop'],
    beef: ['beef'],
    chicken: ['chicken'],
    mutton: ['mutton'],
    rabbit: ['rabbit'],
    cod: ['cod'],
    salmon: ['salmon'],
  };

  // Check if itemName is a category key
  if (CATEGORIES[itemName]) {
    let total = 0;
    for (const variant of CATEGORIES[itemName]) {
      total += senses.countItem(variant);
    }
    return total;
  }

  // Check if itemName is a variant in any category
  for (const [, variants] of Object.entries(CATEGORIES)) {
    if (variants.includes(itemName)) {
      // Already checked direct match, sum all variants in this category
      const catName = Object.keys(CATEGORIES).find(k => CATEGORIES[k] === variants);
      if (catName) {
        let total = 0;
        for (const v of variants) total += senses.countItem(v);
        return total;
      }
    }
  }

  return 0;
}

/**
 * Check if agent has all ingredients for a tech tree node.
 */
function hasIngredients(senses, node) {
  return node.ingredients.every(ing => countItem(senses, ing.item) >= ing.count);
}

/**
 * Check if agent already has this item (or better).
 * Used to skip already-crafted items.
 */
function hasItemOrBetter(senses, nodeId) {
  const node = TREE_BY_ID.get(nodeId);
  if (!node) return false;

  // Check direct match
  if (senses.hasItem(nodeId)) return true;

  // For tools: check if we have a better tier
  if (node.category === 'tool' || node.category === 'weapon' || node.category === 'armor') {
    const TIER_ORDER = ['wooden_', 'stone_', 'iron_', 'diamond_', 'netherite_'];
    const baseName = nodeId.replace(/^(wooden_|stone_|iron_|diamond_|netherite_)/, '');

    // Check if any higher-tier variant exists
    for (const prefix of TIER_ORDER) {
      if (senses.hasItem(prefix + baseName)) {
        const currentTier = TIER_ORDER.indexOf(prefix);
        const myTier = TIER_ORDER.findIndex(p => nodeId.startsWith(p));
        if (currentTier > myTier) return true;
      }
    }
  }

  return false;
}

/**
 * Find the highest-value craftable goal given current inventory.
 *
 * @param {Object} senses - Agent's Senses instance
 * @param {string[]} alreadyCrafted - Items already crafted this session (to avoid re-planning)
 * @returns {{ itemId: string, value: number, chain: Object[] } | null}
 */
function findBestCraftGoal(senses, alreadyCrafted = []) {
  let bestGoal = null;

  for (const node of TECH_TREE) {
    // Skip already crafted this session
    if (alreadyCrafted.includes(node.id)) continue;

    // Skip if we already have this (or better)
    if (hasItemOrBetter(senses, node.id)) continue;

    // Skip gather-only items (no crafting chain)
    if (node.source === 'gather') continue;

    // Check if we can craft this right now (all ingredients available)
    if (!hasIngredients(senses, node)) continue;

    // Calculate effective value (higher tier = more value)
    const effectiveValue = node.value + (node.tier * 2);

    if (!bestGoal || effectiveValue > bestGoal.value) {
      bestGoal = { itemId: node.id, value: effectiveValue, node };
    }
  }

  return bestGoal;
}

/**
 * Build a multi-step crafting chain to reach a target item.
 * Returns an ordered list of actions needed.
 *
 * @param {string} targetId - Target item id from TECH_TREE
 * @param {Object} senses - Agent's Senses instance
 * @returns {Object[]} Ordered steps to reach the target
 */
function buildCraftingChain(targetId, senses) {
  const chain = [];
  const visited = new Set();

  function resolve(itemId) {
    if (visited.has(itemId)) return;
    visited.add(itemId);

    const node = TREE_BY_ID.get(itemId);
    if (!node) return;

    // First, resolve ingredient dependencies
    for (const ing of node.ingredients) {
      const ingNode = TREE_BY_ID.get(ing.item);
      if (ingNode && !hasIngredients(senses, ingNode) && !hasItemOrBetter(senses, ing.item)) {
        resolve(ing.item);
      }
    }

    // Then add this item's crafting step
    if (!hasItemOrBetter(senses, itemId)) {
      const action = {
        action: node.source === 'smelt' ? 'SMELT' : 'CRAFT',
        item: itemId,
        count: 1,
        ingredients: node.ingredients,
        requiresTable: node.requiresTable,
        reason: `Crafting ${itemId} (tier ${node.tier}, value ${node.value})`
      };
      chain.push(action);
    }
  }

  resolve(targetId);
  return chain;
}

/**
 * Get the next tech objective for the crafting chain planner.
 * This replaces the limited nextTechObjective() in goals.js.
 *
 * @param {Object} senses - Agent's Senses instance
 * @param {string[]} alreadyCrafted - Items already crafted this session
 * @returns {{ objective: string, phase: string, chain: Object[] } | null}
 */
function nextCraftingObjective(senses, alreadyCrafted = []) {
  const goal = findBestCraftGoal(senses, alreadyCrafted);
  if (!goal) return null;

  const chain = buildCraftingChain(goal.itemId, senses);
  const node = goal.node;

  // Build human-readable objective
  const categoryLabel = {
    tool: 'tool',
    weapon: 'weapon',
    armor: 'armor piece',
    utility: 'utility item',
    material: 'material',
    food: 'food'
  }[node.category] || 'item';

  const objective = `Craft ${goal.itemId.replace(/_/g, ' ')} (${categoryLabel}, tier ${node.tier})`;

  return {
    objective,
    phase: `${node.category}-tier-${node.tier}`,
    chain,
    itemId: goal.itemId,
    value: goal.value,
    tier: node.tier
  };
}

/**
 * Get a summary of what the agent can currently craft (for debugging).
 */
function getCurrentCraftableOptions(senses) {
  const options = [];
  for (const node of TECH_TREE) {
    if (hasItemOrBetter(senses, node.id)) continue;
    if (node.source === 'gather') continue;
    if (hasIngredients(senses, node)) {
      options.push({
        id: node.id,
        tier: node.tier,
        category: node.category,
        value: node.value,
        ingredients: node.ingredients.map(i => `${i.count}x ${i.item}`)
      });
    }
  }
  return options.sort((a, b) => (b.value + b.tier * 2) - (a.value + a.tier * 2));
}

module.exports = {
  TECH_TREE,
  TREE_BY_ID,
  findBestCraftGoal,
  buildCraftingChain,
  nextCraftingObjective,
  hasIngredients,
  hasItemOrBetter,
  getCurrentCraftableOptions,
  countItem
};
