const Vec3 = require('vec3');
const logger = require('../../shared/logger');

class InventoryActuator {
  constructor(bot) {
    this.bot = bot;
  }

  // --- Food & Consumption ---

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

    const comfortFood = items.find(i => categories.comfort.includes(i.name));
    if (comfortFood) return { item: comfortFood, tier: 'comfort' };

    if (hunger <= 40 || health < 10) {
      const emergencyFood = items.find(i => categories.emergency.includes(i.name));
      if (emergencyFood) return { item: emergencyFood, tier: 'emergency' };
    }

    if (health <= 4 && hunger <= 20) {
      const desperationFood = items.find(i => categories.desperation.includes(i.name));
      if (desperationFood) return { item: desperationFood, tier: 'desperation' };
    }

    return null;
  }

  async eatFood(health = 20, hunger = 100) {
    if (!this.bot.inventory) return false;
    const selected = this.findBestFood(health, hunger);
    if (!selected) return false;

    try {
      logger.info('Actuation:Inventory', `[${selected.tier.toUpperCase()} EAT] Consuming ${selected.item.name}...`);
      await this.bot.equip(selected.item, 'hand');
      await this.bot.consume();
      return true;
    } catch (err) {
      logger.error('Actuation:Inventory', `Failed to eat food: ${err.message}`);
      return false;
    }
  }

  // --- Mining, Digging & Tool Selection ---

  async equipOptimalTool(block) {
    if (!this.bot.inventory || !block) return;
    const items = this.bot.inventory.items();
    const blockName = block.name.toLowerCase();

    let toolType = null;
    if (blockName.includes('log') || blockName.includes('wood') || blockName.includes('plank')) toolType = 'axe';
    else if (blockName.includes('stone') || blockName.includes('ore') || blockName.includes('deepslate') || blockName.includes('cobble')) toolType = 'pickaxe';
    else if (blockName.includes('dirt') || blockName.includes('sand') || blockName.includes('gravel') || blockName.includes('clay')) toolType = 'shovel';
    else if (blockName.includes('leaves') || blockName.includes('wool')) toolType = 'shears';

    if (toolType) {
      const matchingTool = items.find(i => i.name.includes(toolType));
      if (matchingTool) {
        try {
          await this.bot.equip(matchingTool, 'hand');
          logger.debug('Actuation:Inventory', `Equipped optimal tool: ${matchingTool.name} for ${blockName}`);
        } catch (err) {
          // Ignore
        }
      }
    }
  }

  async digBlock(block) {
    if (!block || !this.bot.canDigBlock(block)) {
      logger.warn('Actuation:Inventory', `Cannot dig block at position: ${block?.position}`);
      return false;
    }

    try {
      await this.equipOptimalTool(block);
      logger.info('Actuation:Inventory', `Excavating block: ${block.name}...`);
      await this.bot.dig(block);
      logger.info('Actuation:Inventory', `Successfully mined ${block.name}.`);
      return true;
    } catch (err) {
      logger.error('Actuation:Inventory', `Mining block failed: ${err.message}`);
      return false;
    }
  }

  // --- Building & Block Placement ---

  async placeBlock(blockName, referenceBlock, faceVector = new Vec3(0, 1, 0)) {
    if (!this.bot.inventory || !referenceBlock) return false;
    const blockItem = this.bot.inventory.items().find(i => i.name === blockName);

    if (!blockItem) {
      logger.warn('Actuation:Inventory', `No '${blockName}' in inventory to place.`);
      return false;
    }

    try {
      await this.bot.equip(blockItem, 'hand');
      await this.bot.placeBlock(referenceBlock, faceVector);
      logger.info('Actuation:Inventory', `Placed ${blockName} against ${referenceBlock.name}`);
      return true;
    } catch (err) {
      logger.error('Actuation:Inventory', `Block placement failed: ${err.message}`);
      return false;
    }
  }

  // --- Item Dropping & Trading Toss ---

  async dropItem(itemName, count = 1) {
    if (!this.bot.inventory) return false;
    const item = this.bot.inventory.items().find(i => i.name === itemName);
    if (!item) return false;

    try {
      await this.bot.toss(item.type, null, count);
      logger.info('Actuation:Inventory', `Dropped ${count}x ${itemName}`);
      return true;
    } catch (err) {
      logger.error('Actuation:Inventory', `Drop item failed: ${err.message}`);
      return false;
    }
  }

  async tossItemToPlayer(itemName, playerEntity, count = 1) {
    if (!playerEntity || !playerEntity.position) return false;
    await this.bot.lookAt(playerEntity.position.offset(0, playerEntity.height || 1.6, 0), true);
    return this.dropItem(itemName, count);
  }

  // --- Chest & Container Transfers ---

  async openChestAndDeposit(chestBlock, itemNames = []) {
    if (!chestBlock) return false;
    try {
      const chest = await this.bot.openChest(chestBlock);
      for (const itemName of itemNames) {
        const item = this.bot.inventory.items().find(i => i.name === itemName);
        if (item) {
          await chest.deposit(item.type, null, item.count);
          logger.info('Actuation:Inventory', `Deposited ${item.count}x ${itemName} into chest.`);
        }
      }
      chest.close();
      return true;
    } catch (err) {
      logger.error('Actuation:Inventory', `Chest deposit failed: ${err.message}`);
      return false;
    }
  }

  async openChestAndWithdraw(chestBlock, itemNames = []) {
    if (!chestBlock) return false;
    try {
      const chest = await this.bot.openChest(chestBlock);
      for (const itemName of itemNames) {
        const item = chest.containerItems().find(i => i.name === itemName);
        if (item) {
          await chest.withdraw(item.type, null, item.count);
          logger.info('Actuation:Inventory', `Withdrew ${item.count}x ${itemName} from chest.`);
        }
      }
      chest.close();
      return true;
    } catch (err) {
      logger.error('Actuation:Inventory', `Chest withdraw failed: ${err.message}`);
      return false;
    }
  }

  // --- Crafting ---

  async craftItem(itemName, count = 1) {
    const item = this.bot.registry.itemsByName[itemName];
    if (!item) return false;

    const recipes = this.bot.recipesFor(item.id, null, count, null);
    if (recipes.length === 0) return false;

    try {
      logger.info('Actuation:Inventory', `Crafting ${count}x ${itemName}...`);
      await this.bot.craft(recipes[0], count, null);
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
