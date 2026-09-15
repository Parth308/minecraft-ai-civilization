const { ACTIONS } = require('../../../shared/constants');

/**
 * DIG_UP: Escape underground dead-ends by digging upward to surface.
 * 
 * Triggers when:
 * - Agent is underground (Y < 60)
 * - AND stuck in loops OR no tools/resources OR no bed nearby
 * - AND not in immediate danger (don't dig while being attacked)
 * 
 * This is the escape hatch for local minima where agents are trapped
 * underground with no way to progress.
 */
function evaluateDigUp(senses, stats, agentState = {}) {
  const pos = senses.bot?.entity?.position;
  if (!pos) return { name: ACTIONS.DIG_UP, confidence: 0, reason: 'no position' };

  const isUnderground = pos.y < 60;
  if (!isUnderground) {
    return { name: ACTIONS.DIG_UP, confidence: 0, reason: 'already above ground' };
  }

  // Don't dig up while in immediate danger
  const hostiles = senses.getNearbyHostileMobs?.(8) || [];
  if (hostiles.length > 0) {
    return { name: ACTIONS.DIG_UP, confidence: 0, reason: 'hostiles nearby' };
  }

  // Don't dig up while in water
  if (senses.isInWater?.()) {
    return { name: ACTIONS.DIG_UP, confidence: 0, reason: 'in water' };
  }

  // Don't dig up while falling
  if (senses.isFalling?.()) {
    return { name: ACTIONS.DIG_UP, confidence: 0, reason: 'falling' };
  }

  // Check if already at surface level (Y >= 60)
  if (pos.y >= 60) {
    return { name: ACTIONS.DIG_UP, confidence: 0, reason: 'at surface' };
  }

  // Gather context for decision
  const hasPickaxe = senses.hasItem?.('wooden_pickaxe') || senses.hasItem?.('stone_pickaxe') || 
                     senses.hasItem?.('iron_pickaxe') || senses.hasItem?.('diamond_pickaxe');
  const hasFood = senses.hasItem?.('bread') || senses.hasItem?.('cooked_beef') || 
                  senses.hasItem?.('cooked_porkchop') || senses.hasItem?.('apple');
  const hasBed = !!senses.getNearbyBed?.(20);
  const hasTrees = !!senses.getNearbyBlock?.('log', 16);
  const health = stats.health ?? 20;
  const hunger = stats.hunger ?? 20;

  // Check if stuck in loop (from agentState)
  const isStuck = agentState.isStuckInLoop || false;
  const recentActions = agentState.recentDecisions || [];
  const lastSix = recentActions.slice(-6).map(d => d.action);
  const uniqueRecent = [...new Set(lastSix)];
  const isLooping = lastSix.length >= 6 && uniqueRecent.length <= 2;

  // Calculate desperation score (0-1)
  let desperation = 0;

  // High desperation: stuck in loops
  if (isStuck || isLooping) {
    desperation += 0.4;
  }

  // High desperation: no pickaxe (can't mine)
  if (!hasPickaxe) {
    desperation += 0.2;
  }

  // High desperation: no food (will starve)
  if (!hasFood && hunger < 10) {
    desperation += 0.2;
  }

  // Medium desperation: no bed (can't sleep)
  if (!hasBed) {
    desperation += 0.1;
  }

  // Medium desperation: no trees nearby (can't gather wood)
  if (!hasTrees) {
    desperation += 0.1;
  }

  // Low desperation: low health
  if (health < 10) {
    desperation += 0.1;
  }

  // Deep underground = more desperate to escape
  if (pos.y < 0) {
    desperation += 0.1;
  }
  if (pos.y < -30) {
    desperation += 0.1;
  }

  // Cap desperation at 1.0
  desperation = Math.min(1.0, desperation);

  // Map desperation to confidence
  // 0.0-0.3: low confidence (minor inconvenience)
  // 0.3-0.6: medium confidence (stuck but manageable)
  // 0.6-1.0: high confidence (desperate escape needed)
  let confidence;
  let reason;

  if (desperation < 0.3) {
    // Low desperation: minor convenience, low priority
    confidence = 0.25 + desperation;
    reason = `Underground (Y:${Math.round(pos.y)}) — minor inconvenience, exploring upward`;
  } else if (desperation < 0.6) {
    // Medium desperation: stuck but manageable
    confidence = 0.50 + desperation * 0.5;
    reason = `Underground (Y:${Math.round(pos.y)}) — ${isLooping ? 'stuck in action loops' : 'missing tools/resources'}, seeking surface`;
  } else {
    // High desperation: urgent escape needed
    confidence = 0.70 + desperation * 0.25;
    const factors = [];
    if (isStuck || isLooping) factors.push('loop-stuck');
    if (!hasPickaxe) factors.push('no-pickaxe');
    if (!hasFood && hunger < 10) factors.push('starving');
    if (!hasBed) factors.push('no-bed');
    if (pos.y < -30) factors.push('deep-underground');
    reason = `Underground (Y:${Math.round(pos.y)}) — DESPERATE: ${factors.join(', ')}. Digging to surface!`;
  }

  return {
    name: ACTIONS.DIG_UP,
    confidence,
    reason,
    meta: {
      currentY: Math.round(pos.y),
      targetY: 65, // Surface level + 5 for safety
      desperation: desperation.toFixed(2),
      factors: {
        isLooping,
        hasPickaxe,
        hasFood,
        hasBed,
        hasTrees,
        health,
        hunger
      }
    }
  };
}

module.exports = evaluateDigUp;
