const logger = require('../../shared/logger');

let mcData;
try {
  mcData = require('minecraft-data')('1.20.4');
} catch (e) {
  logger.warn('CraftingChain', `minecraft-data unavailable: ${e.message}`);
  mcData = null;
}

const ITEM_META = {
  stick:            { tier: 0, category: 'material', value: 1 },
  crafting_table:   { tier: 0, category: 'utility', value: 2 },
  chest:            { tier: 1, category: 'utility', value: 4 },
  furnace:          { tier: 2, category: 'utility', value: 6 },
  bucket:           { tier: 2, category: 'utility', value: 5 },
  shield:           { tier: 2, category: 'armor', value: 4 },
  anvil:            { tier: 3, category: 'utility', value: 4 },
  fishing_rod:      { tier: 1, category: 'tool', value: 2 },
  glass:            { tier: 2, category: 'material', value: 1 },
  stone_bricks:     { tier: 2, category: 'material', value: 1 },
  redstone_torch:   { tier: 2, category: 'utility', value: 2 },
  powered_rail:     { tier: 3, category: 'utility', value: 3 },
  rail:             { tier: 3, category: 'utility', value: 3 },
  minecart:         { tier: 3, category: 'utility', value: 3 },
  golden_apple:     { tier: 3, category: 'food', value: 7 },
};

const TOOL_TIERS = ['wooden_', 'stone_', 'iron_', 'diamond_', 'netherite_'];
const TOOL_TYPES = ['pickaxe', 'axe', 'sword', 'shovel', 'hoe'];
const ARMOR_TYPES = ['helmet', 'chestplate', 'leggings', 'boots'];

for (const prefix of TOOL_TIERS) {
  const tier = TOOL_TIERS.indexOf(prefix);
  const cat = prefix === 'stone_' ? 'tool' : prefix.includes('sword') ? 'weapon' : 'tool';
  for (const type of TOOL_TYPES) {
    const name = prefix + type;
    ITEM_META[name] = { tier, category: 'tool', value: 2 + tier * 2 };
  }
  for (const type of ARMOR_TYPES) {
    const name = prefix + type;
    ITEM_META[name] = { tier, category: 'armor', value: 2 + tier * 2 };
  }
}

const SMELT_META = {
  iron_ingot:     { tier: 3, category: 'material', value: 4 },
  gold_ingot:     { tier: 3, category: 'material', value: 3 },
  copper_ingot:   { tier: 2, category: 'material', value: 2 },
  diamond:        { tier: 4, category: 'material', value: 10 },
  netherite_ingot:{ tier: 5, category: 'material', value: 14 },
  netherite_scrap:{ tier: 5, category: 'material', value: 13 },
  cooked_porkchop:{ tier: 1, category: 'food', value: 3 },
  cooked_beef:    { tier: 1, category: 'food', value: 3 },
  cooked_chicken: { tier: 1, category: 'food', value: 2 },
  cooked_mutton:  { tier: 1, category: 'food', value: 2 },
  cooked_rabbit:  { tier: 1, category: 'food', value: 2 },
  cooked_cod:     { tier: 1, category: 'food', value: 2 },
  cooked_salmon:  { tier: 1, category: 'food', value: 2 },
  stone:          { tier: 2, category: 'material', value: 1 },
  iron_block:     { tier: 3, category: 'material', value: 2 },
};

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

function buildTreeFromMcData() {
  if (!mcData) return [];

  const items = mcData.items;
  const itemsByName = mcData.itemsByName;
  const recipes = mcData.recipes;
  const nodes = new Map();

  function addItemNode(name, meta) {
    if (!name || nodes.has(name)) return;
    nodes.set(name, {
      id: name,
      tier: meta.tier,
      category: meta.category,
      source: 'craft',
      requiresTable: false,
      ingredients: [],
      value: meta.value,
      next: []
    });
  }

  function resolveIngName(id) {
    if (id == null) return null;
    const item = items[id];
    return item ? item.name : null;
  }

  for (const [resultIdStr, recipeArr] of Object.entries(recipes)) {
    const resultId = Number(resultIdStr);
    const resultItem = items[resultId];
    if (!resultItem) continue;
    const resultName = resultItem.name;

    for (const recipe of recipeArr) {
      const isSmelt = recipe.ingredients && !recipe.inShape && recipe.ingredients.length <= 2;
      if (isSmelt) {
        if (!SMELT_META[resultName] && !ITEM_META[resultName]) continue;
        const meta = SMELT_META[resultName] || ITEM_META[resultName] || { tier: 0, category: 'material', value: 1 };
        const ingNames = recipe.ingredients.map(resolveIngName).filter(Boolean);
        if (ingNames.length === 0) continue;
        const existing = nodes.get(resultName);
        if (existing && existing.ingredients.length > 0) continue;

        addItemNode(resultName, meta);
        const node = nodes.get(resultName);
        node.source = 'smelt';
        node.ingredients = ingNames.map(n => ({ item: n, count: 1 }));
        continue;
      }

      let shape = null;
      let ingList = null;
      if (recipe.inShape) {
        shape = recipe.inShape;
        ingList = [];
        for (const row of shape) {
          for (const cell of row) {
            if (cell != null) {
              const name = resolveIngName(cell);
              if (name) ingList.push(name);
            }
          }
        }
      } else if (recipe.ingredients) {
        ingList = recipe.ingredients.map(resolveIngName).filter(Boolean);
      }

      if (!ingList || ingList.length === 0) continue;

      const counts = {};
      for (const n of ingList) counts[n] = (counts[n] || 0) + 1;
      const ingredients = Object.entries(counts).map(([item, count]) => ({ item, count }));

      const meta = ITEM_META[resultName] || SMELT_META[resultName] || { tier: 0, category: 'material', value: 1 };

      if (!nodes.has(resultName)) {
        addItemNode(resultName, meta);
      }
      const node = nodes.get(resultName);
      if (node.ingredients.length === 0 || ingredients.length < node.ingredients.length) {
        node.ingredients = ingredients;
        node.requiresTable = ingList.length > 4 || (shape && shape.length > 1);
      }
    }
  }

  const tree = Array.from(nodes.values());

  const byId = new Map(tree.map(n => [n.id, n]));
  for (const node of tree) {
    for (const ing of node.ingredients) {
      const dep = byId.get(ing.item);
      if (dep && !dep.next.includes(node.id)) {
        dep.next.push(node.id);
      }
    }
  }

  return tree;
}

const TECH_TREE = buildTreeFromMcData();
const TREE_BY_ID = new Map(TECH_TREE.map(node => [node.id, node]));

const USED_AS_INGREDIENT = new Map();
for (const node of TECH_TREE) {
  for (const ing of node.ingredients) {
    if (!USED_AS_INGREDIENT.has(ing.item)) USED_AS_INGREDIENT.set(ing.item, []);
    USED_AS_INGREDIENT.get(ing.item).push(node.id);
  }
}

function countItem(senses, itemName) {
  const direct = senses.countItem(itemName);
  if (direct > 0) return direct;

  if (CATEGORIES[itemName]) {
    let total = 0;
    for (const variant of CATEGORIES[itemName]) {
      total += senses.countItem(variant);
    }
    return total;
  }

  for (const [, variants] of Object.entries(CATEGORIES)) {
    if (variants.includes(itemName)) {
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

function hasIngredients(senses, node) {
  return node.ingredients.every(ing => countItem(senses, ing.item) >= ing.count);
}

function hasItemOrBetter(senses, nodeId) {
  const node = TREE_BY_ID.get(nodeId);
  if (!node) return false;

  if (senses.hasItem(nodeId)) return true;

  if (node.category === 'tool' || node.category === 'weapon' || node.category === 'armor') {
    const baseName = nodeId.replace(/^(wooden_|stone_|iron_|diamond_|netherite_)/, '');
    for (const prefix of TOOL_TIERS) {
      if (senses.hasItem(prefix + baseName)) {
        const currentTier = TOOL_TIERS.indexOf(prefix);
        const myTier = TOOL_TIERS.findIndex(p => nodeId.startsWith(p));
        if (currentTier > myTier) return true;
      }
    }
  }

  return false;
}

function findBestCraftGoal(senses, alreadyCrafted = []) {
  let bestGoal = null;

  for (const node of TECH_TREE) {
    if (alreadyCrafted.includes(node.id)) continue;
    if (hasItemOrBetter(senses, node.id)) continue;
    if (node.source === 'gather') continue;
    if (!hasIngredients(senses, node)) continue;

    const effectiveValue = node.value + (node.tier * 2);

    if (!bestGoal || effectiveValue > bestGoal.value) {
      bestGoal = { itemId: node.id, value: effectiveValue, node };
    }
  }

  return bestGoal;
}

function buildCraftingChain(targetId, senses) {
  const chain = [];
  const visited = new Set();

  function resolve(itemId) {
    if (visited.has(itemId)) return;
    visited.add(itemId);

    const node = TREE_BY_ID.get(itemId);
    if (!node) return;

    for (const ing of node.ingredients) {
      const ingNode = TREE_BY_ID.get(ing.item);
      if (ingNode && !hasIngredients(senses, ingNode) && !hasItemOrBetter(senses, ing.item)) {
        resolve(ing.item);
      }
    }

    if (!hasItemOrBetter(senses, itemId)) {
      const action = {
        action: node.source === 'smelt' ? 'SMELT' : 'CRAFT',
        item: itemId,
        count: 1,
        ingredients: node.ingredients,
        requiresTable: node.requiresTable,
        reason: `Craft ${itemId} (tier ${node.tier}, value ${node.value})`
      };
      chain.push(action);
    }
  }

  resolve(targetId);
  return chain;
}

function nextCraftingObjective(senses, alreadyCrafted = []) {
  const goal = findBestCraftGoal(senses, alreadyCrafted);
  if (!goal) return null;

  const chain = buildCraftingChain(goal.itemId, senses);
  const node = goal.node;

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
