const logger = require('../../shared/logger');
const detailedLogger = require('../../shared/detailedLogger');

class BarterSkill {
  constructor(bot, inventoryActuator, relationshipTracker, chatActuator) {
    this.bot = bot;
    this.inventory = inventoryActuator;
    this.relationships = relationshipTracker;
    this.chat = chatActuator;
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

  async executeTrade(partnerName, giveItem, giveCount, wantItem, wantCount) {
    const player = Object.values(this.bot.entities).find(e => e.username === partnerName);
    if (!player) {
      logger.warn('Barter', `Trading partner ${partnerName} not found nearby`);
      return false;
    }

    logger.info('Barter', `Executing trade with ${partnerName}: Giving ${giveCount}x ${giveItem} for ${wantCount}x ${wantItem}`);
    detailedLogger.logInventory(this.agentId, `Initiated Peer Trade`, { partner: partnerName, offered: `${giveCount}x ${giveItem}`, requested: `${wantCount}x ${wantItem}` });

    this.chat.say(`Here is your ${giveCount}x ${giveItem}, ${partnerName}!`);
    const dropped = await this.inventory.tossItemToPlayer(giveItem, player, giveCount);

    if (dropped) {
      this.relationships.updateTrust(partnerName, 10);
      this.relationships.updateAffinity(partnerName, 5);
      return true;
    }
    return false;
  }
}

module.exports = BarterSkill;
