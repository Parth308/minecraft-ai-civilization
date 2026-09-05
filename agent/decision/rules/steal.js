const logger = require('../../../shared/logger');

function evaluateSteal(senses, stats, persona, agentState = {}) {
  // Need nearby players to steal from
  const nearbyPlayers = senses.getNearbyPlayers ? senses.getNearbyPlayers(3) : [];
  if (nearbyPlayers.length === 0) return { name: 'STEAL', confidence: 0, reason: 'No players nearby' };

  // Filter out self
  const targets = nearbyPlayers.filter(p => p.username !== (senses.bot?.username || ''));
  if (targets.length === 0) return { name: 'STEAL', confidence: 0, reason: 'No valid targets' };

  // Pick closest target
  const target = targets[0];
  const targetName = target.username;

  // Mineflayer player entities don't expose heldItem — scan visible
  // equipment slots instead (hand + armor). No visible gear = nothing to steal.
  const equipment = Array.isArray(target.equipment) ? target.equipment : [];
  const heldItem = equipment.find(s => s && (s.name || s.itemType)) || null;
  if (!heldItem) return { name: 'STEAL', confidence: 0, reason: 'Target has no visible gear' };

  // Personality check: greedy agents consider stealing more
  const personaTraits = persona?.traits || {};
  const greed = personaTraits.greed || 0.5;
  const caution = personaTraits.caution || 0.5;

  // Only consider stealing if greedy enough or trust is low
  const victimTrust = agentState.relationships?.getTrust?.(targetName) ?? 0.5;
  if (greed < 0.5 && victimTrust >= 0.3) {
    return { name: 'STEAL', confidence: 0, reason: 'Not greedy enough and trust is acceptable' };
  }

  // Count witnesses (other players nearby)
  const witnessCount = targets.length - 1; // exclude victim

  // Check if same faction
  const sameFaction = agentState.factions?.isInSameFaction?.(targetName) || false;

  // Calculate confidence
  let confidence = 0.4;
  confidence += (greed - 0.5) * 0.30;
  confidence -= (caution - 0.5) * 0.25;
  confidence -= victimTrust * 0.20;
  confidence -= witnessCount * 0.08;
  confidence -= sameFaction ? 0.15 : 0;

  // Clamp
  confidence = Math.min(0.99, Math.max(0.01, Number(confidence.toFixed(2))));

  const itemName = heldItem.name || 'gear';
  const reason = `Agent ${targetName} nearby (${Math.round(senses.bot.entity.position.distanceTo(target.position))}m) with ${itemName} — trust: ${victimTrust.toFixed(2)}, greed: ${greed.toFixed(2)}, witnesses: ${witnessCount}`;

  return {
    name: 'STEAL',
    confidence,
    reason,
    meta: {
      target: targetName,
      targetEntity: target,
      item: itemName,
      witnessCount,
      sameFaction,
      heldItem
    }
  };
}

module.exports = evaluateSteal;
