const { ACTIONS } = require('../../../shared/constants');

const SHELTER_BLOCKS = ['oak_planks', 'spruce_planks', 'birch_planks', 'jungle_planks', 'acacia_planks', 'dark_oak_planks', 'cobblestone', 'stone_bricks'];
const TORCH_BLOCKS = ['torch', 'wall_torch'];

function evaluateBuild(senses, stats, persona = null, agentState = {}) {
  const isNight = senses.isNight();
  const health = stats.health;
  const hasHostiles = (senses.getNearbyHostileMobs?.(12) || []).length > 0;

  const inv = senses.bot?.inventory?.items() || [];
  const invCounts = {};
  for (const item of inv) {
    invCounts[item.name] = (invCounts[item.name] || 0) + item.count;
  }

  const hasBlocks = SHELTER_BLOCKS.some(b => (invCounts[b] || 0) >= 8);
  const hasTorches = (invCounts['torch'] || 0) >= 4;

  const shelterNearby = senses.getNearbyBlock('crafting_table', 16) ||
                        senses.getNearbyBlock('bed', 16) ||
                        senses.getNearbyBlock('chest', 16);

  const caution = persona?.traits?.caution ?? 0.5;
  const ambition = persona?.traits?.ambition ?? 0.5;

  if (isNight && !shelterNearby && hasBlocks) {
    let confidence = 0.78 + (caution * 0.12);
    if (hasHostiles) confidence += 0.10;
    if (health < 15) confidence += 0.08;

    return {
      name: ACTIONS.BUILD,
      confidence: Math.min(0.92, Number(confidence.toFixed(2))),
      buildType: 'shelter',
      reason: `Building emergency shelter — night without nearby shelter (health: ${health}%)`
    };
  }

  if (health < 12 && hasBlocks && !shelterNearby) {
    return {
      name: ACTIONS.BUILD,
      confidence: Number((0.70 + caution * 0.10).toFixed(2)),
      buildType: 'safe_room',
      reason: `Building safe room — low health (${health}%) with no shelter`
    };
  }

  const hasFoundation = invCounts['cobblestone'] >= 16 || invCounts['stone_bricks'] >= 16;
  if (hasFoundation && hasTorches && ambition > 0.6 && !isNight) {
    let confidence = 0.55 + (ambition * 0.15);
    if (alliedAgentsNearby(senses)) confidence += 0.10;

    return {
      name: ACTIONS.BUILD,
      confidence: Math.min(0.80, Number(confidence.toFixed(2))),
      buildType: 'base',
      reason: `Expanding base — have materials and ambition (ambition: ${ambition})`
    };
  }

  return { name: ACTIONS.BUILD, confidence: 0.0, reason: 'No building need or materials' };
}

function alliedAgentsNearby(senses) {
  const players = senses.getNearbyPlayers?.(24) || [];
  return players.some(p => p.username !== senses.bot?.username);
}

module.exports = evaluateBuild;