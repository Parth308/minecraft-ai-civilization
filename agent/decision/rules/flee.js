const { ACTIONS } = require('../../../shared/constants');

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

  if (hostiles.length === 0 && stats.health > 6) {
    const rangedThreat = typeof senses.getRangedThreat === 'function' ? senses.getRangedThreat(24) : null;
    if (rangedThreat) {
      return {
        name: ACTIONS.FLEE,
        confidence: 0.90,
        threat: rangedThreat,
        reason: `Under projectile fire from ${rangedThreat.name || 'a distant shooter'} — breaking line of sight`
      };
    }
  }

  if (stats.health <= 6 && hostiles.length > 0) {
    return {
      name: ACTIONS.FLEE,
      confidence: 0.98,
      threat: hostiles[0],
      reason: `Critical health (${stats.health}/20) with ${hostiles.length} hostiles nearby`
    };
  }

  if (hostiles.length >= 3) {
    return {
      name: ACTIONS.FLEE,
      confidence: 0.90,
      threat: hostiles[0],
      reason: `Overwhelmed by ${hostiles.length} hostiles`
    };
  }

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
      const inv = senses.bot?.inventory?.items() || [];
      const invCounts = {};
      for (const item of inv) {
        invCounts[item.name] = (invCounts[item.name] || 0) + item.count;
      }
      const hasBlocks = ['oak_planks','spruce_planks','birch_planks','cobblestone','stone_bricks','dirt','sand']
        .some(b => (invCounts[b] || 0) >= 4);
      const hasLogs = (invCounts['oak_log'] || invCounts['spruce_log'] || invCounts['birch_log'] || 0) >= 1;

      if (hasBlocks) {
        return {
          name: ACTIONS.FLEE,
          confidence: 0.82,
          reason: 'Night without shelter — but I have blocks, time to build'
        };
      }

      if (hasLogs) {
        return {
          name: ACTIONS.FLEE,
          confidence: 0.70,
          reason: 'Night without shelter — have logs, need to craft planks then build'
        };
      }

      const nearbyLog = senses.getNearbyBlock?.('log', 16);
      if (nearbyLog) {
        return {
          name: ACTIONS.FLEE,
          confidence: 0.65,
          reason: 'Night without shelter or materials — chopping nearest tree for emergency shelter'
        };
      }

      if (hostiles.length === 0) {
        return {
          name: ACTIONS.FLEE,
          confidence: 0.50,
          reason: 'Night without shelter but no immediate threat — digging in or finding cover'
        };
      }
    }
  }

  return { name: ACTIONS.FLEE, confidence: 0.05, reason: 'No imminent mortality threat' };
}

module.exports = evaluateFlee;
module.exports.setFleeCooldown = setFleeCooldown;
module.exports.isFleeOnCooldown = isFleeOnCooldown;

