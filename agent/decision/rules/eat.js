const { ACTIONS } = require('../../../shared/constants');

function evaluateEat(senses, stats) {
  const foodItems = senses.getInventoryFood();
  if (foodItems.length === 0) {
    return { name: ACTIONS.EAT, confidence: 0, reason: 'No food in inventory' };
  }

  // Critical Starvation / Extreme Injury
  if (stats.hunger <= 20 || (stats.health <= 6 && stats.hunger <= 60)) {
    return {
      name: ACTIONS.EAT,
      confidence: 0.98,
      food: foodItems[0],
      reason: `Critical physical distress (HP:${stats.health}, Hunger:${stats.hunger}%) - emergency feeding required`
    };
  }

  // Routine Hunger
  if (stats.hunger <= 50) {
    return {
      name: ACTIONS.EAT,
      confidence: 0.90,
      food: foodItems[0],
      reason: `Hunger is low (${stats.hunger}%)`
    };
  }

  // Injured health regeneration appetite
  if (stats.hunger <= 80 && stats.health < 15) {
    return {
      name: ACTIONS.EAT,
      confidence: 0.80,
      food: foodItems[0],
      reason: `Health injured (${stats.health}/20) - eating to trigger natural regeneration`
    };
  }

  return { name: ACTIONS.EAT, confidence: 0.1, reason: 'Hunger satisfied' };
}

module.exports = evaluateEat;
