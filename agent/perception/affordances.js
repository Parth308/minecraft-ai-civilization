/**
 * Affordance Engine — computes "what the AI can and cannot do right now".
 *
 * Pure synchronous module consumed by DecisionTree (attached as payload.affordances)
 * and rendered into the LLM prompt by broker/router.js so free-tier models receive
 * grounded options instead of guessing (and failing) on impossible actions.
 *
 * Contract: build(bot, senses, stats) -> {
 *   craftable:      [{ item, count, needsTable }],
 *   notCraftable:   [{ item, reason }],
 *   minable:        [{ block, count }],
 *   blockedMine:    [{ block, reason }],
 *   harvestable:    ['wheat', ...],
 *   food:           ['bread x2', ...],
 *   furniture:      { bedsNearby, chestsNearby, furnacesNearby },
 *   tradeablePlayers: ['Agent_Beta'],
 *   dangers:        [{ mob, count }]
 * }
 */

const MAX_ENTRIES = 8;

// Common survival-progression items worth checking against current inventory.
const PROGRESSION_CANDIDATES = [
  'torch', 'crafting_table', 'furnace', 'chest', 'shield', 'bread',
  'wooden_pickaxe', 'wooden_axe', 'wooden_sword', 'wooden_shovel',
  'stone_pickaxe', 'stone_axe', 'stone_sword', 'stone_shovel',
  'iron_pickaxe', 'iron_axe', 'iron_sword', 'iron_shovel',
  'iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots',
  'diamond_pickaxe', 'diamond_sword'
];

// Tool-tier gating mirrors agent/decision/rules/mine.js exactly.
const ORE_TIER_REQUIREMENTS = [
  { match: ['diamond_ore', 'deepslate_diamond_ore', 'gold_ore', 'emerald_ore', 'redstone_ore'], minTier: 'iron' },
  { match: ['iron_ore', 'deepslate_iron_ore', 'copper_ore'], minTier: 'stone' },
  { match: ['coal_ore', 'deepslate_coal_ore'], minTier: 'wooden' }
];

const PICKAXE_TIERS = ['netherite_pickaxe', 'diamond_pickaxe', 'iron_pickaxe', 'stone_pickaxe', 'wooden_pickaxe'];
const TIER_RANK = { wooden: 1, stone: 2, iron: 3, diamond: 4, netherite: 5 };
const TIER_LABEL = { wooden: 'wooden pickaxe+', stone: 'stone pickaxe+', iron: 'iron pickaxe+' };

// Common surface blocks worth listing as mineable filler targets.
const SURFACE_TARGETS = ['stone', 'deepslate', 'oak_log', 'birch_log', 'spruce_log', 'dirt', 'sand', 'gravel'];

function _tierFromInventory(senses) {
  // Returns highest numeric tier held, 0 if none.
  let best = 0;
  let bestName = null;
  for (const pick of PICKAXE_TIERS) {
    if (senses.hasItem(pick)) {
      const rank = TIER_RANK[pick.split('_')[0]];
      if (rank > best) {
        best = rank;
        bestName = pick;
      }
    }
  }
  return { rank: best, name: bestName };
}

function _meetsTier(requiredLabel, heldRank) {
  const required = TIER_RANK[requiredLabel] || 1;
  return heldRank >= required;
}

/** Normalize one recipe ingredient entry (number | array | {id,count}) -> [{ id, count }] */
function _normalizeEntry(entry) {
  if (entry == null) return [];
  if (Array.isArray(entry)) return entry.flatMap(_normalizeEntry);
  if (typeof entry === 'object') return [{ id: entry.id, count: entry.count || 1 }];
  return [{ id: entry, count: 1 }];
}

/** Flatten a recipe variant into a Map<itemId, unitsConsumed> */
function _variantRequirements(variant) {
  const req = new Map();
  let rows = 0;
  let cols = 0;

  if (variant && Array.isArray(variant.inShape)) {
    rows = variant.inShape.length;
    cols = Math.max(...variant.inShape.map(r => (Array.isArray(r) ? r.length : 0)), 0);
    for (const row of variant.inShape) {
      for (const cell of row) {
        for (const { id, count } of _normalizeEntry(cell)) {
          req.set(id, (req.get(id) || 0) + count);
        }
      }
    }
  } else if (variant && Array.isArray(variant.ingredients)) {
    for (const entry of variant.ingredients) {
      for (const { id, count } of _normalizeEntry(entry)) {
        req.set(id, (req.get(id) || 0) + count);
      }
    }
  }

  // Grid larger than the 2x2 inventory crafting grid implies crafting table.
  const needsTable = rows > 2 || cols > 2;
  return { req, needsTable };
}

/**
 * Evaluate craftability of one candidate item against current inventory.
 * Returns { ok, maxCount, needsTable, missingId } using the best recipe variant.
 */
function _evaluateRecipe(bot, itemName, inventoryCounts, idToName) {
  let recipes = null;
  try {
    const itemDef = bot.registry.itemsByName && bot.registry.itemsByName[itemName];
    recipes = itemDef ? bot.registry.recipes[itemDef.id] : null;
  } catch (_err) {
    return { ok: false, maxCount: 0, needsTable: false, missing: 'registry unavailable' };
  }
  if (!recipes || !Array.isArray(recipes) || recipes.length === 0) {
    return { ok: false, maxCount: 0, needsTable: false, missing: 'no known recipe' };
  }

  let best = { ok: false, maxCount: 0, needsTable: false, missing: null };

  for (const variant of recipes) {
    const { req, needsTable } = _variantRequirements(variant);
    if (req.size === 0) continue;

    let variantCount = Infinity;
    let missingId = null;
    let outCount = (variant.result && variant.result.count) || 1;

    for (const [id, needed] of req.entries()) {
      const avail = inventoryCounts.get(id) || 0;
      if (avail < needed) {
        variantCount = 0;
        missingId = idToName(id) || `item#${id}`;
        break;
      }
      variantCount = Math.min(variantCount, Math.floor(avail / needed));
    }

    if (variantCount === Infinity) variantCount = 0;
    const totalOutputs = variantCount * outCount;

    if (!best.ok && variantCount === 0 && missingId) {
      best.missing = missingId; // remember first missing ingredient across variants
    }
    if (totalOutputs > best.maxCount) {
      best = { ok: variantCount > 0, maxCount: totalOutputs, needsTable, missing: best.missing };
    }
  }

  return best;
}

function build(bot, senses, stats) {
  const result = {
    craftable: [],
    notCraftable: [],
    minable: [],
    blockedMine: [],
    harvestable: [],
    food: [],
    furniture: { bedsNearby: 0, chestsNearby: 0, furnacesNearby: 0 },
    tradeablePlayers: [],
    dangers: []
  };

  if (!bot || !senses) return result;

  // ── Inventory snapshot ─────────────────────────────────────────────────────
  let invItems = [];
  try {
    invItems = (bot.inventory && bot.inventory.items()) || [];
  } catch (_err) { /* bot still spawning */ }

  const inventoryCounts = new Map();
  for (const it of invItems) {
    inventoryCounts.set(it.type, (inventoryCounts.get(it.type) || 0) + (it.count || 1));
  }

  // ── Crafting feasibility ───────────────────────────────────────────────────
  try {
    const registry = bot.registry;
    if (registry && registry.items) {
      const idToName = (id) => {
        const def = registry.items[id];
        return def ? def.name : null;
      };

      for (const itemName of PROGRESSION_CANDIDATES) {
        if (result.craftable.length >= MAX_ENTRIES && result.notCraftable.length >= MAX_ENTRIES) break;
        const evalRes = _evaluateRecipe(bot, itemName, inventoryCounts, idToName);
        if (evalRes.ok && evalRes.maxCount > 0) {
          if (result.craftable.length < MAX_ENTRIES) {
            result.craftable.push({ item: itemName, count: evalRes.maxCount, needsTable: evalRes.needsTable });
          }
        } else if (evalRes.missing && evalRes.missing !== 'registry unavailable' && evalRes.missing !== 'no known recipe') {
          if (result.notCraftable.length < MAX_ENTRIES) {
            result.notCraftable.push({ item: itemName, reason: `missing ${evalRes.missing}` });
          }
        }
      }
    }
  } catch (err) {
    result.error = `crafting check failed: ${err.message}`;
  }

  // ── Mining affordances (tool-tier gated, mirrors mine.js rules) ───────────
  try {
    const { rank: pickRank } = _tierFromInventory(senses);

    const oreCounts = new Map();
    for (const b of senses.getNearbyOres ? senses.getNearbyOres(16) : []) {
      if (!b || !b.name) continue;
      oreCounts.set(b.name, (oreCounts.get(b.name) || 0) + 1);
    }

    for (const [oreName, count] of oreCounts.entries()) {
      const requirement = ORE_TIER_REQUIREMENTS.find(r => r.match.includes(oreName));
      if (requirement) {
        if (_meetsTier(requirement.minTier, pickRank)) {
          if (result.minable.length < MAX_ENTRIES) result.minable.push({ block: oreName, count });
          else continue;
        } else if (result.blockedMine.length < MAX_ENTRIES) {
          result.blockedMine.push({ block: oreName, reason: `requires ${TIER_LABEL[requirement.minTier] || 'better pickaxe'}` });
        }
        continue;
      }
      if (pickRank >= 1 && result.minable.length < MAX_ENTRIES) {
        result.minable.push({ block: oreName, count });
      }
    }

    if (pickRank >= 1) {
      for (const surface of SURFACE_TARGETS) {
        if (result.minable.length >= MAX_ENTRIES) break;
        const blocks = senses.getNearbyBlocks ? senses.getNearbyBlocks(surface, 12, 3) : [];
        if (blocks.length > 0) {
          result.minable.push({ block: surface, count: blocks.length });
        }
      }
    }
  } catch (err) {
    if (!result.error) result.error = `mining check failed: ${err.message}`;
  }

  // ── Harvestable crops (maturity conventions from farm.js) ────────────────
  try {
    const crops = [
      { name: 'wheat', mature: 7 }, { name: 'carrots', mature: 7 },
      { name: 'potatoes', mature: 7 }, { name: 'beetroots', mature: 3 }
    ];
    for (const crop of crops) {
      if (result.harvestable.length >= MAX_ENTRIES) break;
      const block = senses.getNearbyBlock(crop.name, 16);
      if (block && block.metadata === crop.mature) {
        result.harvestable.push(crop.name);
      }
    }
  } catch (err) {
    if (!result.error) result.error = `crop check failed: ${err.message}`;
  }

  // ── Food ────────────────────────────────────────────────────────────────────
  try {
    const foods = senses.getInventoryFood ? senses.getInventoryFood() : [];
    for (const f of foods) {
      if (result.food.length >= MAX_ENTRIES) break;
      if (f && f.name) {
        result.food.push(f.count ? `${f.name} x${f.count}` : f.name);
      }
    }
  } catch (err) {
    if (!result.error) result.error = `food check failed: ${err.message}`;
  }

  // ── Furniture & interactables ──────────────────────────────────────────────
  try {
    result.furniture.bedsNearby = senses.getNearbyBed ? (senses.getNearbyBed(16) ? 1 : 0) : 0;
    result.furniture.chestsNearby = senses.getNearbyChests ? senses.getNearbyChests(16).length : 0;
    result.furniture.furnacesNearby = senses.getNearbyFurnaces ? senses.getNearbyFurnaces(16).length : 0;
  } catch (err) {
    if (!result.error) result.error = `furniture check failed: ${err.message}`;
  }

  // ── Social affordances ─────────────────────────────────────────────────────
  try {
    result.tradeablePlayers = (senses.getNearbyPlayers ? senses.getNearbyPlayers(32) : [])
      .map(p => p.username)
      .filter(Boolean)
      .slice(0, MAX_ENTRIES);
  } catch (err) {
    if (!result.error) result.error = `player check failed: ${err.message}`;
  }

  // ── Dangers ────────────────────────────────────────────────────────────────
  try {
    const dangerCounts = new Map();
    for (const mob of senses.getNearbyHostileMobs ? senses.getNearbyHostileMobs(16) : []) {
      const name = (mob.name || mob.mobType || 'hostile').toLowerCase();
      dangerCounts.set(name, (dangerCounts.get(name) || 0) + 1);
    }
    result.dangers = [...dangerCounts.entries()]
      .slice(0, MAX_ENTRIES)
      .map(([mob, count]) => ({ mob, count }));
  } catch (err) {
    if (!result.error) result.error = `danger check failed: ${err.message}`;
  }

  return result;
}

module.exports = { build };
