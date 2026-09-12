const { ACTIONS } = require('../../../shared/constants');

const DIAMOND_Y = -59;

function evaluateDiamondSeek(senses, stats, persona = null, agentState = {}) {
  const hasIronPick = senses.hasItem('iron_pickaxe') ||
                      senses.hasItem('diamond_pickaxe') ||
                      senses.hasItem('netherite_pickaxe');
  if (!hasIronPick) {
    return { name: ACTIONS.DIAMOND_SEEK, confidence: 0.0, reason: 'Need iron+ pickaxe before deep diamond mining' };
  }
  if ((senses.countItem('diamond') || 0) >= 5) {
    return { name: ACTIONS.DIAMOND_SEEK, confidence: 0.0, reason: 'Diamond stockpile sufficient for pickaxe and table' };
  }
  if (stats.health <= 10 || stats.hunger <= 20) {
    return { name: ACTIONS.DIAMOND_SEEK, confidence: 0.0, reason: 'Survival first — deep mining needs health and food' };
  }

  const visible = (senses.getNearbyOres?.(16) || []).some(o => (o.name || '').includes('diamond'));
  if (visible) {
    return { name: ACTIONS.DIAMOND_SEEK, confidence: 0.0, reason: 'Diamonds visible — regular MINE handles them' };
  }

  const y = senses.bot?.entity?.position?.y ?? 64;
  const ambition = persona?.traits?.ambition ?? 0.5;
  const curiosity = persona?.traits?.curiosity ?? 0.5;

  let confidence = 0.55 + (ambition * 0.15) + (curiosity * 0.10);
  if (y > 0) confidence += 0.10;
  if (senses.isNight?.()) confidence += 0.05;

  return {
    name: ACTIONS.DIAMOND_SEEK,
    confidence: Math.min(0.90, Number(confidence.toFixed(2))),
    targetY: DIAMOND_Y,
    reason: `Deep diamond expedition (at Y=${Math.round(y)}, target Y=${DIAMOND_Y})`
  };
}

module.exports = evaluateDiamondSeek;
