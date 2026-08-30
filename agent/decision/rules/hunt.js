const { ACTIONS } = require('../../../shared/constants');

const HUNTABLE_ANIMALS = {
  cow: { food: 'raw_beef', drops: 1, priority: 1.2 },
  pig: { food: 'raw_porkchop', drops: 1, priority: 1.1 },
  chicken: { food: 'raw_chicken', drops: 1, priority: 1.0 },
  sheep: { food: 'raw_mutton', drops: 1, priority: 1.15 },
  rabbit: { food: 'raw_rabbit', drops: 1, priority: 0.9 },
  fish: { food: 'raw_cod', drops: 1, priority: 1.0 },
};

function evaluateHunt(senses, stats, persona = null, agentState = {}) {
  const hunger = stats.hunger;
  const hasWeapon = senses.hasItem('wooden_sword') || senses.hasItem('stone_sword') ||
                    senses.hasItem('iron_sword') || senses.hasItem('diamond_sword') ||
                    senses.hasItem('wooden_axe') || senses.hasItem('stone_axe') ||
                    senses.hasItem('iron_axe') || senses.hasItem('diamond_axe');

  const passiveMobs = senses.getNearbyPassiveMobs?.(24) || [];
  const huntable = passiveMobs.filter(m => HUNTABLE_ANIMALS[m.name]);

  if (huntable.length === 0) {
    return { name: ACTIONS.HUNT, confidence: 0.0, reason: 'No huntable animals nearby' };
  }

  const rawFoodCount = senses.bot?.inventory?.items()
    ?.filter(i => i.name.startsWith('raw_') || i.name === 'beef' || i.name === 'porkchop')
    ?.reduce((sum, i) => sum + i.count, 0) || 0;

  const hungerFactor = hunger < 40 ? 0.25 : hunger < 60 ? 0.15 : hunger < 80 ? 0.05 : -0.10;
  const foodNeed = rawFoodCount < 4 ? 0.15 : rawFoodCount < 8 ? 0.05 : -0.10;
  const weaponBonus = hasWeapon ? 0.12 : -0.15;
  const patience = persona?.traits?.patience ?? 0.5;

  let confidence = 0.50 + hungerFactor + foodNeed + weaponBonus + (patience * 0.08);

  const nearestAnimal = huntable.reduce((closest, mob) => {
    const dist = mob.position?.distanceTo(senses.bot?.entity?.position) || Infinity;
    return dist < (closest.dist || Infinity) ? { mob, dist } : closest;
  }, {}).mob;

  const animalInfo = HUNTABLE_ANIMALS[nearestAnimal?.name] || {};
  confidence *= animalInfo.priority || 1.0;

  return {
    name: ACTIONS.HUNT,
    confidence: Math.min(0.90, Number(confidence.toFixed(2))),
    target: nearestAnimal,
    reason: `Hunting ${nearestAnimal?.name || 'animal'} for food (hunger: ${hunger}%, raw food: ${rawFoodCount})`
  };
}

module.exports = evaluateHunt;