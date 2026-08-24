const { ACTIONS } = require('../../../shared/constants');

// Cooldown gates ONLY the ambient night-awareness variant. Threat-driven flee
// must never be suppressed, or agents die to hostiles they could outrun.
const fleeCooldowns = new Map();

function setFleeCooldown(key = 'night', durationMs = 45000) {
  fleeCooldowns.set(key, Date.now() + durationMs);
}

function isFleeOnCooldown(key = 'night') {
  const expiry = fleeCooldowns.get(key);
  if (!expiry) return false;
  if (Date.now() > expiry) {
    fleeCooldowns.delete(key);
    return false;
  }
  return true;
}

function evaluateFlee(senses, stats) {
  const hostiles = senses.getNearbyHostileMobs(12);

  // If health is critically low (< 6) and enemies nearby
  if (stats.health <= 6 && hostiles.length > 0) {
    return {
      name: ACTIONS.FLEE,
      confidence: 0.98,
      threat: hostiles[0],
      reason: `Critical health (${stats.health}/20) with ${hostiles.length} hostiles nearby`
    };
  }

  // Overwhelmed by 3+ hostiles
  if (hostiles.length >= 3) {
    return {
      name: ACTIONS.FLEE,
      confidence: 0.90,
      threat: hostiles[0],
      reason: `Overwhelmed by ${hostiles.length} hostiles`
    };
  }

  // Night-awareness: If it's night time and bot lacks armor/weapon protection
  const isNight = typeof senses.isNight === 'function' ? senses.isNight() : false;
  const hasWeapon = senses.hasItem('sword') ||
                    senses.hasItem('wooden_sword') ||
                    senses.hasItem('stone_sword') ||
                    senses.hasItem('iron_sword') ||
                    senses.hasItem('diamond_sword') ||
                    senses.hasItem('bow') ||
                    senses.hasItem('crossbow');

  const hasArmor = senses.hasItem('leather_chestplate') ||
                   senses.hasItem('iron_chestplate') ||
                   senses.hasItem('chainmail_chestplate') ||
                   senses.hasItem('diamond_chestplate') ||
                   senses.hasItem('golden_chestplate') ||
                   senses.hasItem('netherite_chestplate');

  if (isNight && (!hasWeapon || !hasArmor) && !isFleeOnCooldown('night')) {
    if (hostiles.length > 0) {
      return {
        name: ACTIONS.FLEE,
        confidence: 0.96,
        threat: hostiles[0],
        reason: `Night survival danger: Unarmored/unarmed in darkness with ${hostiles.length} hostiles nearby`
      };
    }

    const lightLevel = typeof senses.getLightLevel === 'function' ? senses.getLightLevel() : 15;
    if (lightLevel <= 7) {
      return {
        name: ACTIONS.FLEE,
        confidence: 0.93,
        reason: 'Night survival awareness: Unarmored/unarmed during night cycle — retreating to shelter/safety'
      };
    }
  }

  return { name: ACTIONS.FLEE, confidence: 0.05, reason: 'No imminent mortality threat' };
}

module.exports = evaluateFlee;
module.exports.setFleeCooldown = setFleeCooldown;
module.exports.isFleeOnCooldown = isFleeOnCooldown;

