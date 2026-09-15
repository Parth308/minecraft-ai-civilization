const { ACTIONS } = require('../../../shared/constants');
const logger = require('../../../shared/logger');

function evaluateDigUp(senses, stats, agentState = {}) {
  const pos = senses.bot?.entity?.position;
  if (!pos) return { name: ACTIONS.DIG_UP, confidence: 0, reason: 'no position' };

  const isUnder = pos.y < 60;
  if (!isUnder) return { name: ACTIONS.DIG_UP, confidence: 0, reason: 'already above ground' };

  if (senses.isInWater?.()) return { name: ACTIONS.DIG_UP, confidence: 0, reason: 'in water' };
  if (senses.isFalling?.()) return { name: ACTIONS.DIG_UP, confidence: 0, reason: 'falling' };

  const hasPickaxe = senses.hasItem?.('wooden_pickaxe') || senses.hasItem?.('stone_pickaxe') ||
                     senses.hasItem?.('iron_pickaxe') || senses.hasItem?.('diamond_pickaxe');
  const hasFood = senses.hasItem?.('bread') || senses.hasItem?.('cooked_beef') ||
                  senses.hasItem?.('cooked_porkchop') || senses.hasItem?.('apple');
  const hasBed = !!senses.getNearbyBed?.(20);
  const hasTrees = !!senses.getNearbyBlock?.('log', 16);
  const health = stats.health ?? 20;
  const hunger = stats.hunger ?? 20;

  const isStuck = agentState.isStuckInLoop || false;
  const recentActions = agentState.recentDecisions || [];
  const lastSix = recentActions.slice(-6).map(d => d.action);
  const uniqueRecent = [...new Set(lastSix)];
  const isLooping = lastSix.length >= 6 && uniqueRecent.length <= 2;

  let desperation = 0;
  if (isStuck || isLooping) desperation += 0.4;
  if (!hasPickaxe) desperation += 0.2;
  if (!hasFood && hunger < 10) desperation += 0.2;
  if (!hasBed) desperation += 0.1;
  if (!hasTrees) desperation += 0.1;
  if (health < 10) desperation += 0.1;
  if (pos.y < 0) desperation += 0.1;
  if (pos.y < -30) desperation += 0.1;
  desperation = Math.min(1.0, desperation);

  const hostiles = senses.getNearbyHostileMobs?.(8) || [];
  if (hostiles.length > 0 && desperation < 0.60) {
    return { name: ACTIONS.DIG_UP, confidence: 0, reason: 'hostiles nearby, not desperate enough' };
  }

  let confidence;
  let reason;

  if (desperation < 0.3) {
    confidence = 0.40 + desperation;
    reason = `Underground (Y:${Math.round(pos.y)}) — minor inconvenience, exploring upward`;
  } else if (desperation < 0.6) {
    confidence = 0.65 + desperation * 0.4;
    reason = `Underground (Y:${Math.round(pos.y)}) — ${isLooping ? 'stuck in action loops' : 'missing tools/resources'}, seeking surface`;
  } else {
    confidence = 0.85 + desperation * 0.10;
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
      targetY: 65,
      desperation: desperation.toFixed(2),
      factors: { isLooping, hasPickaxe, hasFood, hasBed, hasTrees, health, hunger }
    }
  };
}

module.exports = evaluateDigUp;
