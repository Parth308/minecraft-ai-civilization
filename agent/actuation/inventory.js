const logger = require('../../shared/logger');

class InventoryActuator {
  constructor(bot) {
    this.bot = bot;
  }

  async eatFood() {
    if (!this.bot.inventory) return false;
    const foodNames = ['bread', 'cooked_beef', 'cooked_porkchop', 'cooked_chicken', 'apple', 'carrot', 'baked_potato', 'cooked_mutton', 'cooked_salmon', 'cooked_cod'];
    const food = this.bot.inventory.items().find(item => foodNames.includes(item.name));

    if (!food) {
      logger.warn('Actuation:Inventory', 'No food available in inventory to eat.');
      return false;
    }

    try {
      logger.info('Actuation:Inventory', `Equipping and eating ${food.name}...`);
      await this.bot.equip(food, 'hand');
      await this.bot.consume();
      logger.info('Actuation:Inventory', `Successfully consumed ${food.name}.`);
      return true;
    } catch (err) {
      logger.error('Actuation:Inventory', `Failed to eat food: ${err.message}`);
      return false;
    }
  }

  listInventory() {
    if (!this.bot.inventory) return [];
    return this.bot.inventory.items().map(i => `${i.name} x${i.count}`);
  }
}

module.exports = InventoryActuator;
