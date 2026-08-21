const logger = require('../../shared/logger');

class InventoryActuator {
  constructor(bot) {
    this.bot = bot;
  }

  // Food Tiers for Adaptive Survival
  getFoodCategories() {
    return {
      comfort: ['cooked_beef', 'cooked_porkchop', 'cooked_mutton', 'cooked_chicken', 'cooked_salmon', 'cooked_cod', 'bread', 'baked_potato', 'golden_apple'],
      emergency: ['apple', 'carrot', 'sweet_berries', 'raw_beef', 'raw_porkchop', 'raw_mutton', 'raw_chicken'],
      desperation: ['rotten_flesh', 'spider_eye']
    };
  }

  findBestFood(health = 20, hunger = 100) {
    if (!this.bot.inventory) return null;
    const items = this.bot.inventory.items();
    const categories = this.getFoodCategories();

    // 1. Try comfort food first
    const comfortFood = items.find(i => categories.comfort.includes(i.name));
    if (comfortFood) return { item: comfortFood, tier: 'comfort' };

    // 2. Try emergency raw food if hunger <= 40 or health < 10
    if (hunger <= 40 || health < 10) {
      const emergencyFood = items.find(i => categories.emergency.includes(i.name));
      if (emergencyFood) return { item: emergencyFood, tier: 'emergency' };
    }

    // 3. Desperation food (rotten flesh) strictly when starvation is fatal (HP <= 4 & hunger <= 20)
    if (health <= 4 && hunger <= 20) {
      const desperationFood = items.find(i => categories.desperation.includes(i.name));
      if (desperationFood) return { item: desperationFood, tier: 'desperation' };
    }

    return null;
  }

  async eatFood(health = 20, hunger = 100) {
    if (!this.bot.inventory) return false;
    const selected = this.findBestFood(health, hunger);

    if (!selected) {
      logger.warn('Actuation:Inventory', 'No suitable food available to eat under current physical state.');
      return false;
    }

    try {
      logger.info('Actuation:Inventory', `[${selected.tier.toUpperCase()} EAT] Consuming ${selected.item.name} (HP:${health}, Hunger:${hunger}%)...`);
      await this.bot.equip(selected.item, 'hand');
      await this.bot.consume();
      logger.info('Actuation:Inventory', `Successfully consumed ${selected.item.name}.`);
      return true;
    } catch (err) {
      logger.error('Actuation:Inventory', `Failed to eat food: ${err.message}`);
      return false;
    }
  }

  async craftItem(itemName, count = 1) {
    const item = this.bot.registry.itemsByName[itemName];
    if (!item) {
      logger.warn('Actuation:Inventory', `Unknown craft item: ${itemName}`);
      return false;
    }

    const recipes = this.bot.recipesFor(item.id, null, count, null);
    if (recipes.length === 0) {
      logger.warn('Actuation:Inventory', `No available crafting recipe or missing ingredients for: ${itemName}`);
      return false;
    }

    try {
      logger.info('Actuation:Inventory', `Crafting ${count}x ${itemName}...`);
      await this.bot.craft(recipes[0], count, null);
      logger.info('Actuation:Inventory', `Successfully crafted ${itemName}.`);
      return true;
    } catch (err) {
      logger.error('Actuation:Inventory', `Crafting failed: ${err.message}`);
      return false;
    }
  }

  listInventory() {
    if (!this.bot.inventory) return [];
    return this.bot.inventory.items().map(i => `${i.name} x${i.count}`);
  }
}

module.exports = InventoryActuator;
