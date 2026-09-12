const { ACTIONS } = require('../../../shared/constants');

function evaluateVillageSeek(senses, stats, persona = null, agentState = {}) {
  if (senses.isNight?.()) {
    return { name: ACTIONS.VILLAGE_SEEK, confidence: 0.0, reason: 'No cross-country treks at night' };
  }
  if (stats.health <= 10 || stats.hunger <= 20) {
    return { name: ACTIONS.VILLAGE_SEEK, confidence: 0.0, reason: 'Too weak to travel far' };
  }

  const villagers = (senses.getNearbyPassiveMobs?.(64) || [])
    .filter(e => (e.name || '').toLowerCase().includes('villager'));
  if (villagers.length > 0) {
    const v = villagers[0];
    return {
      name: ACTIONS.VILLAGE_SEEK,
      confidence: 0.85,
      target: v.position ? { x: v.position.x, y: v.position.y, z: v.position.z } : null,
      reason: `Villager spotted nearby — approaching settlement (${villagers.length} villagers sensed)`
    };
  }

  const geared = senses.hasItem('stone_sword') || senses.hasItem('iron_sword') ||
                 senses.hasItem('diamond_sword') || senses.hasItem('iron_chestplate') ||
                 senses.hasItem('leather_chestplate');
  if (!geared) {
    return { name: ACTIONS.VILLAGE_SEEK, confidence: 0.0, reason: 'Need a sword or armor before long expeditions' };
  }

  const curiosity = persona?.traits?.curiosity ?? 0.5;
  const heading = agentState.villageHeading;
  if (!heading || Date.now() > heading.until) {
    const yaw = Math.random() * Math.PI * 2;
    agentState.villageHeading = {
      dx: Math.cos(yaw), dz: Math.sin(yaw),
      until: Date.now() + 600000
    };
  }

  return {
    name: ACTIONS.VILLAGE_SEEK,
    confidence: Math.min(0.78, Number((0.50 + curiosity * 0.25).toFixed(2))),
    reason: 'Geared and curious — trekking outward to find a village'
  };
}

module.exports = evaluateVillageSeek;
