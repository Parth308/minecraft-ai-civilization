const { ACTIONS } = require('../../../shared/constants');

const BREED_FOODS = {
  cow: ['wheat'],
  mooshroom: ['wheat'],
  sheep: ['wheat'],
  goat: ['wheat'],
  pig: ['carrot', 'potato', 'beetroot'],
  chicken: ['wheat_seeds', 'melon_seeds', 'pumpkin_seeds', 'beetroot_seeds'],
  turtle: ['seagrass'],
  horse: ['golden_carrot', 'golden_apple'],
  donkey: ['golden_carrot', 'golden_apple'],
  llama: ['hay_block'],
  wolf: ['bone'],
  cat: ['cod', 'salmon'],
  fox: ['sweet_berries'],
  bee: ['flower']
};

function evaluateBreed(senses, stats) {
  if (stats.health <= 8) {
    return { name: ACTIONS.BREED, confidence: 0.0, reason: 'Too hurt to play rancher' };
  }

  const animals = senses.getNearbyPassiveMobs?.(10) || [];
  const bySpecies = {};
  for (const a of animals) {
    const name = (a.name || '').toLowerCase();
    const species = Object.keys(BREED_FOODS).find(s => name.includes(s));
    if (species) (bySpecies[species] = bySpecies[species] || []).push(a);
  }

  for (const [species, pair] of Object.entries(bySpecies)) {
    if (pair.length < 2) continue;
    const food = BREED_FOODS[species].find(f => senses.hasItem(f));
    if (!food) continue;
    return {
      name: ACTIONS.BREED,
      confidence: 0.85,
      species,
      food,
      reason: `Breeding pair of ${species} with ${food.replace(/_/g, ' ')}`
    };
  }

  return { name: ACTIONS.BREED, confidence: 0.0, reason: 'No breedable pair with matching food nearby' };
}

module.exports = evaluateBreed;
module.exports.BREED_FOODS = BREED_FOODS;
