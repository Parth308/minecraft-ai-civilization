const logger = require('../../shared/logger');

class CombatActuator {
  constructor(bot) {
    this.bot = bot;
    this.target = null;
    this.blocking = false;
  }

  // Auto-equips highest tier armor
  async equipBestArmor() {
    if (!this.bot.inventory) return;
    const items = this.bot.inventory.items();
    const armorTiers = ['netherite', 'diamond', 'iron', 'golden', 'chainmail', 'leather'];
    const armorSlots = {
      helmet: 'head',
      chestplate: 'torso',
      leggings: 'legs',
      boots: 'feet'
    };

    for (const [type, slot] of Object.entries(armorSlots)) {
      for (const tier of armorTiers) {
        const piece = items.find(i => i.name === `${tier}_${type}`);
        if (piece) {
          try {
            await this.bot.equip(piece, slot);
            break;
          } catch (err) {
            // Ignore if already equipped or slot busy
          }
        }
      }
    }
  }

  async equipBestWeapon() {
    if (!this.bot.inventory) return;
    const items = this.bot.inventory.items();
    const weaponTiers = [
      'netherite_sword', 'diamond_sword', 'iron_sword', 'golden_sword', 'stone_sword', 'wooden_sword',
      'netherite_axe', 'diamond_axe', 'iron_axe', 'stone_axe', 'wooden_axe'
    ];

    for (const weaponName of weaponTiers) {
      const weapon = items.find(i => i.name === weaponName);
      if (weapon) {
        try {
          await this.bot.equip(weapon, 'hand');
          return;
        } catch (err) {
          logger.debug('Combat', `Equip weapon failed: ${err.message}`);
        }
      }
    }
  }

  async useShield(enable = true) {
    if (!this.bot.inventory) return;
    const shield = this.bot.inventory.items().find(i => i.name === 'shield');
    if (!shield) return;

    if (enable && !this.blocking) {
      try {
        await this.bot.equip(shield, 'off-hand');
        this.bot.activateItem(true); // Right click hold
        this.blocking = true;
        logger.info('Combat', 'Shield raised to block attack.');
      } catch (err) {
        logger.debug('Combat', `Shield block failed: ${err.message}`);
      }
    } else if (!enable && this.blocking) {
      this.bot.deactivateItem();
      this.blocking = false;
      logger.info('Combat', 'Shield lowered.');
    }
  }

  async attack(entity) {
    if (!entity) return;
    this.target = entity;
    logger.info('Actuation:Combat', `Engaging target ${entity.name || entity.username || 'hostile'}`);

    await this.equipBestArmor();
    await this.equipBestWeapon();

    // Look at target & strike
    if (this.bot.entity) {
      await this.bot.lookAt(entity.position.offset(0, entity.height || 1.6, 0), true);
    }
    this.bot.attack(entity);
  }

  stopCombat() {
    this.target = null;
    this.useShield(false);
  }
}

module.exports = CombatActuator;
