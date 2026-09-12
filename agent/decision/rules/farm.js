const { ACTIONS } = require('../../../shared/constants');

function evaluateFarm(senses, stats, persona = null, agentState = {}) {
  const inv = senses.bot?.inventory ? senses.bot.inventory.items() : [];

  // Check 1: Harvestable mature crops nearby
  const cropTypes = ['wheat', 'carrots', 'potatoes', 'beetroots'];
  for (const crop of cropTypes) {
    const block = senses.getNearbyBlock(crop, 16);
    if (block && ((crop === 'beetroots' && block.metadata === 3) || block.metadata === 7)) {
      const caution = persona?.traits?.caution ?? 0.5;
      return {
        name: 'HARVEST',
        confidence: Number((0.75 + (stats.hunger < 50 ? 0.15 : 0.0) + caution * 0.05).toFixed(2)),
        crop: crop,
        position: block.position,
        reason: `Found mature ${crop} ready for harvest (Hunger: ${stats.hunger}%)`
      };
    }
  }

  // Check 2: Raw food + furnace nearby ready for cooking.
  // Explicit allowlist — raw_copper/iron/gold also start with 'raw_' and must NOT trigger COOK.
  const COOKABLE_FOODS = new Set([
    'raw_beef', 'raw_porkchop', 'raw_chicken', 'raw_mutton', 'raw_cod', 'raw_salmon', 'raw_rabbit',
    'beef', 'porkchop', 'chicken', 'mutton', 'cod', 'salmon', 'rabbit', 'potato', 'kelp'
  ]);
  const rawFood = inv.find(i => COOKABLE_FOODS.has(i.name));
  const furnaceBlock = senses.getNearbyBlock('furnace', 10) || senses.getNearbyBlock('smoker', 10);
  const fuel = inv.find(i => i.name === 'coal' || i.name === 'charcoal' || i.name.includes('plank') || i.name.includes('log'));

  if (rawFood && furnaceBlock && fuel) {
    return {
      name: 'COOK',
      confidence: Number((0.72 + (stats.hunger < 60 ? 0.18 : 0.05)).toFixed(2)),
      food: rawFood.name,
      furnace: furnaceBlock.position,
      reason: `Holding ${rawFood.name} and fuel near furnace — cooking food for sustenance`
    };
  }

  // Check 3: Hoe + seeds in inventory to cultivate farmland
  const hasHoe = inv.some(i => i.name.includes('hoe'));
  const hasSeeds = inv.some(i => i.name === 'wheat_seeds' || i.name === 'carrot' || i.name === 'potato');
  if (hasHoe && hasSeeds && !senses.isNight()) {
    const sociability = persona?.traits?.sociability ?? 0.5;
    return {
      name: 'FARM',
      confidence: Number((0.60 + sociability * 0.10).toFixed(2)),
      reason: 'Holding farming tools and seeds — cultivating sustainable agriculture'
    };
  }

  return { name: 'FARM', confidence: 0.0, reason: 'No farming opportunities available' };
}

module.exports = evaluateFarm;
