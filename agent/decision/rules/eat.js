const { ACTIONS } = require('../../../shared/constants');

function evaluateEat(senses, stats) {
  const foodItems = senses.getInventoryFood();
  if (foodItems.length === 0) {
    return { name: ACTIONS.EAT, confidence: 0, reason: 'No food in inventory' };
  }

  // Trigger strongly if hunger < 50% or health low
  if (stats.hunger <= 50) {
    return {
      name: ACTIONS.EAT,
      confidence: 0.95,
      food: foodItems[0],
      reason: `Hunger is low (${stats.hunger}%)`
    };
  }

  if (stats.hunger <= 80 && stats.health < 15) {
    return {
      name: ACTIONS.EAT,
      confidence: 0.85,
      food: foodItems[0],
      reason: `Health is injured (${stats.health}/20) and hunger is below 80%`
    };
  }

  return { name: ACTIONS.EAT, confidence: 0.1, reason: 'Hunger satisfied' };
}

module.exports = evaluateEat;
