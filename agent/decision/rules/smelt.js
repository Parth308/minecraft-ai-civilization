const { ACTIONS } = require('../../../shared/constants');

const SMELTABLE_ITEMS = {
  raw_iron: { result: 'iron_ingot', priority: 1.3 },
  raw_gold: { result: 'gold_ingot', priority: 1.2 },
  raw_copper: { result: 'copper_ingot', priority: 1.0 },
  iron_ore: { result: 'iron_ingot', priority: 1.1 },
  gold_ore: { result: 'gold_ingot', priority: 1.1 },
  copper_ore: { result: 'copper_ingot', priority: 0.9 },
  sand: { result: 'glass', priority: 0.7 },
  cobblestone: { result: 'stone', priority: 0.6 },
  log: { result: 'charcoal', priority: 0.8 },
  raw_beef: { result: 'cooked_beef', priority: 1.4 },
  raw_porkchop: { result: 'cooked_porkchop', priority: 1.4 },
  raw_chicken: { result: 'cooked_chicken', priority: 1.4 },
  raw_mutton: { result: 'cooked_mutton', priority: 1.3 },
  raw_cod: { result: 'cooked_cod', priority: 1.2 },
  raw_salmon: { result: 'cooked_salmon', priority: 1.2 },
};

function evaluateSmelt(senses, stats, persona = null, agentState = {}) {
  const furnace = senses.getNearbyBlock('furnace', 10) || senses.getNearbyBlock('blast_furnace', 10) || senses.getNearbyBlock('smoker', 10);
  if (!furnace) {
    return { name: ACTIONS.SMELT, confidence: 0.0, reason: 'No furnace nearby' };
  }

  const inv = senses.bot?.inventory?.items() || [];
  const invCounts = {};
  for (const item of inv) {
    invCounts[item.name] = (invCounts[item.name] || 0) + item.count;
  }

  const fuel = inv.find(i => i.name === 'coal' || i.name === 'charcoal' || i.name.includes('plank') || i.name.includes('log'));
  if (!fuel) {
    return { name: ACTIONS.SMELT, confidence: 0.0, reason: 'No fuel available for smelting' };
  }

  const candidates = [];
  for (const [item, info] of Object.entries(SMELTABLE_ITEMS)) {
    if (invCounts[item] > 0) {
      candidates.push({ item, count: invCounts[item], ...info });
    }
  }

  if (candidates.length === 0) {
    return { name: ACTIONS.SMELT, confidence: 0.0, reason: 'No smeltable items in inventory' };
  }

  candidates.sort((a, b) => b.priority - a.priority);
  const best = candidates[0];

  const hunger = stats.hunger;
  const isFood = best.result.includes('cooked');
  const hungerBonus = isFood && hunger < 60 ? 0.20 : isFood && hunger < 80 ? 0.10 : 0;

  const patience = persona?.traits?.patience ?? 0.5;
  let confidence = 0.65 + hungerBonus + (patience * 0.10);

  return {
    name: ACTIONS.SMELT,
    confidence: Math.min(0.88, Number(confidence.toFixed(2))),
    item: best.item,
    result: best.result,
    count: best.count,
    furnace: furnace.position,
    reason: `Smelting ${best.count}x ${best.item} → ${best.result} (fuel: ${fuel.name})`
  };
}

module.exports = evaluateSmelt;