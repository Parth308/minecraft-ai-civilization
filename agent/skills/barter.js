const logger = require('../../shared/logger');
const detailedLogger = require('../../shared/detailedLogger');
const { SCARCE_RESOURCES } = require('../../shared/constants');

class BarterSkill {
  constructor(bot, inventoryActuator, relationshipTracker, chatActuator, memoryServiceUrl = process.env.MEMORY_SERVICE_URL || 'http://localhost:3002') {
    this.bot = bot;
    this.inventory = inventoryActuator;
    this.relationships = relationshipTracker;
    this.chat = chatActuator;
    this.memoryServiceUrl = memoryServiceUrl;
  }

  get agentId() {
    return this.bot.username || 'UnknownAgent';
  }

  // Appraise subjective value of an item (1-100 scale) based on current needs
  appraiseItem(itemName, currentStats) {
    let value = 10;
    if (itemName.includes('diamond')) value = 90;
    else if (itemName.includes('iron')) value = 40;
    else if (itemName.includes('gold')) value = 30;
    else if (itemName.includes('emerald')) value = 50;
    else if (itemName.includes('pickaxe') || itemName.includes('sword')) value = 25;
    else if (itemName.includes('cooked') || itemName.includes('bread') || itemName.includes('apple')) {
      value = currentStats?.hunger < 40 ? 50 : 20;
    } else if (itemName.includes('log') || itemName.includes('plank')) {
      value = 12;
    } else if (itemName.includes('cobble')) {
      value = 8;
    }
    return value;
  }

  // Comprehensive trade valuation incorporating genuine scarcity & travel distance
  evaluateTradeValue(itemName, count = 1, travelDistance = 0, currentStats = {}) {
    if (!itemName) return 0;
    const cleanName = itemName.toLowerCase();
    let baseVal = this.appraiseItem(cleanName, currentStats);

    // Apply scarcity weight multiplier if item is in SCARCE_RESOURCES tier
    for (const [scarceKey, info] of Object.entries(SCARCE_RESOURCES || {})) {
      if (cleanName.includes(scarceKey)) {
        baseVal = info.baseValue * (info.scarcityWeight || 1.0);
        break;
      }
    }

    // Distance decay factor: items mined far away (>100 blocks) carry higher intrinsic transport value
    const distanceFactor = 1 + Math.min(1.5, Math.max(0, travelDistance / 100));
    return Number((baseVal * distanceFactor * count).toFixed(2));
  }

  async executeTrade(partnerName, giveItem, giveCount, wantItem, wantCount, fairnessThreshold = 0.40) {
    const player = Object.values(this.bot.entities).find(e => e.username === partnerName);
    if (!player) {
      logger.warn('Barter', `Trading partner ${partnerName} not found nearby`);
      return { success: false, reason: 'partner_not_found' };
    }

    // Inventory guard: LLMs sometimes offer goods they don't hold. Without
    // this the toss fails silently and the offer re-fires every tick.
    const held = (this.bot.inventory?.items() || [])
      .filter(i => i && (i.name === giveItem || i.name === giveItem.replace(/^minecraft:/, '')))
      .reduce((n, i) => n + (i.count || 1), 0);
    if (held < giveCount) {
      logger.warn('Barter', `Rejected trade with ${partnerName}: only ${held}x ${giveItem} in inventory, offered ${giveCount}`);
      return { success: false, reason: 'insufficient_inventory' };
    }

    const valueGive = this.evaluateTradeValue(giveItem, giveCount);
    const valueWant = this.evaluateTradeValue(wantItem, wantCount);

    // Reject / renegotiate trades if value(give) vs value(want) is unfairly lopsided
    if (valueGive > valueWant * (1 + fairnessThreshold)) {
      logger.warn('Barter', `Rejected lopsided trade with ${partnerName}: Giving value ${valueGive} vs wanting value ${valueWant} exceeds threshold`);
      this.chat.say(`That's too steep, ${partnerName}! ${giveCount}x ${giveItem} is worth far more than ${wantCount}x ${wantItem}.`);
      return {
        success: false,
        reason: 'unfair_trade',
        valueGive,
        valueWant,
        fairnessScore: Number((valueWant / valueGive).toFixed(2))
      };
    }

    const fairness = Number((Math.min(valueGive, valueWant) / Math.max(valueGive, valueWant, 1)).toFixed(2));

    logger.info('Barter', `Executing fair trade with ${partnerName}: Giving ${giveCount}x ${giveItem} ($${valueGive}) for ${wantCount}x ${wantItem} ($${valueWant}) (Fairness: ${fairness})`);
    detailedLogger.logInventory(this.agentId, `Initiated Peer Trade`, {
      partner: partnerName,
      offered: `${giveCount}x ${giveItem} ($${valueGive})`,
      requested: `${wantCount}x ${wantItem} ($${valueWant})`,
      fairness
    });

    this.chat.say(`Here is your ${giveCount}x ${giveItem}, ${partnerName}! Fair trade.`);
    const dropped = await this.inventory.tossItemToPlayer(giveItem, player, giveCount);

    if (dropped) {
      this.relationships.updateTrust(partnerName, 10);
      this.relationships.updateAffinity(partnerName, 5);

      // Record trade into civilization ledger; any IOU this delivery covers
      // is settled server-side and echoed back so the agent can acknowledge it socially
      fetch(`${this.memoryServiceUrl}/api/ledger/trades`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentA: this.agentId,
          agentB: partnerName,
          itemsGiven: [{ item: giveItem, count: giveCount, value: valueGive }],
          itemsReceived: [{ item: wantItem, count: wantCount, value: valueWant }],
          fairnessScore: fairness
        })
      }).then(r => r.json()).then(result => {
        if (Array.isArray(result?.settledDebts) && result.settledDebts.length > 0) {
          this.chat.say(`and that clears my ${giveItem} debt, ${partnerName}. we're square now!`);
          logger.info('Barter', `Trade settled ${result.settledDebts.length} open debt(s) with ${partnerName}`);
        }
      }).catch(err => logger.debug('Barter', `Failed to log trade to ledger: ${err.message}`));

      return { success: true, fairnessScore: fairness };
    }
    return { success: false, reason: 'drop_failed' };
  }
}

module.exports = BarterSkill;
