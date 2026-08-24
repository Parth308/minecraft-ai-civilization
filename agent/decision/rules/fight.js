const { ACTIONS } = require('../../../shared/constants');

// Viable melee/ranged weapons. Tools and bare fists deal near-zero damage to
// hostiles — engaging without these is a survival instinct violation, not a
// tactical choice.
const WEAPON_ITEMS = [
  'wooden_sword', 'stone_sword', 'iron_sword', 'diamond_sword', 'netherite_sword', 'golden_sword',
  'wooden_axe', 'stone_axe', 'iron_axe', 'diamond_axe', 'netherite_axe', 'golden_axe',
  'bow', 'crossbow', 'trident'
];

function hasWeapon(senses) {
  return WEAPON_ITEMS.some(item => senses.hasItem(item));
}

function evaluateFight(senses, stats, persona = null) {
  const hostiles = senses.getNearbyHostileMobs(8);

  if (hostiles.length === 0) {
    return { name: ACTIONS.FIGHT, confidence: 0.0, reason: 'No hostiles to attack' };
  }

  const targetName = hostiles[0].name || 'enemy';

  // Rage overrides self-preservation: an angry agent throws hands regardless of gear
  if (stats.anger >= 70 && stats.health > 10) {
    return {
      name: ACTIONS.FIGHT,
      confidence: 0.80,
      target: hostiles[0],
      reason: `Anger level high (${stats.anger}%) - engaging nearby enemy`
    };
  }

  if (stats.health <= 8) {
    return { name: ACTIONS.FIGHT, confidence: 0.0, reason: `Health too low (${stats.health}/20) to engage ${targetName}` };
  }

  if (hasWeapon(senses)) {
    return {
      name: ACTIONS.FIGHT,
      confidence: 0.85,
      target: hostiles[0],
      reason: `Hostile mob ${targetName} within melee distance`
    };
  }

  // Unarmed instinct floor: personality-modulated reluctance instead of hard ban.
  // Caution drags willingness below the 0.6 escalation threshold (brain gets veto);
  // bold agents stay above it and may still choose to brawl — their funeral.
  const caution = persona?.traits?.caution ?? 0.5;
  const unarmedWillingness = Math.max(0.10, Math.min(0.85, 0.55 - (caution - 0.5) * 0.5));
  return {
    name: ACTIONS.FIGHT,
    confidence: Number(unarmedWillingness.toFixed(2)),
    target: hostiles[0],
    reason: `Unarmed engagement against ${targetName} — no weapon equipped`
  };
}

module.exports = evaluateFight;
