const logger = require('../../shared/logger');

class StealDetection {
  constructor(agentId, bot, relationships, factions, gossip) {
    this.agentId = agentId;
    this.bot = bot;
    this.relationships = relationships;
    this.factions = factions;
    this.gossip = gossip;
    this.pendingDetections = new Map();
    this.knownThefts = new Map();
  }

  reportTheft(thiefName, itemName) {
    this.pendingDetections.set(thiefName, {
      itemName,
      detectedAt: Date.now(),
      detected: false
    });
  }

  checkDetection(thiefName) {
    const pending = this.pendingDetections.get(thiefName);
    if (!pending) return null;

    if (pending.detected) return null;

    const elapsed = Date.now() - pending.detectedAt;
    const detectionWindow = 60000;
    if (elapsed > detectionWindow) {
      this.pendingDetections.delete(thiefName);
      return null;
    }

    const baseChance = 0.50;
    const repeatCount = this.knownThefts.get(thiefName) || 0;
    const repeatBonus = repeatCount * 0.20;
    const chance = Math.min(0.95, baseChance + repeatBonus);

    if (Math.random() < chance) {
      pending.detected = true;
      this.knownThefts.set(thiefName, repeatCount + 1);
      return {
        thiefName,
        itemName: pending.itemName,
        knownThefts: repeatCount + 1
      };
    }

    return null;
  }

  async handleDetection(detection) {
    const { thiefName, itemName, knownThefts } = detection;

    const trustPenalty = Math.min(0.3, 0.15 * knownThefts);
    const currentTrust = this.relationships.getTrust(thiefName) || 0.5;
    this.relationships.updateTrust(thiefName, currentTrust - trustPenalty);

    const angerIncrease = 0.20 + (0.05 * knownThefts);
    if (this.bot.stats) {
      this.bot.stats.adjust('anger', angerIncrease);
    }

    const sameFaction = this.factions?.isInSameFaction(thiefName) || false;
    if (sameFaction) {
      this.factions?.removeFromFaction(thiefName);
      await this.bot.chat(`${thiefName} stole from me! You are no longer part of our faction!`);
    } else {
      await this.bot.chat(`${thiefName} stole my ${itemName}! I won't forget this!`);
    }

    if (this.gossip) {
      this.gossip.addRumor({
        type: 'theft',
        target: thiefName,
        item: itemName,
        source: 'observed'
      });
    }

    return { trustPenalty, sameFaction };
  }

  cleanup() {
    const now = Date.now();
    for (const [name, detection] of this.pendingDetections) {
      if (now - detection.detectedAt > 60000) {
        this.pendingDetections.delete(name);
      }
    }
  }

  getStats() {
    return {
      pendingDetections: this.pendingDetections.size,
      knownThefts: Object.fromEntries(this.knownThefts)
    };
  }
}

module.exports = StealDetection;
