const logger = require('../../shared/logger');

class CombatActuator {
  constructor(bot) {
    this.bot = bot;
    this.target = null;
  }

  attack(entity) {
    if (!entity) return;
    this.target = entity;
    logger.info('Actuation:Combat', `Attacking entity ${entity.name || entity.username || entity.id}`);
    
    // Equip best sword/weapon if available
    const weapons = this.bot.inventory.items().filter(item => item.name.includes('sword') || item.name.includes('axe'));
    if (weapons.length > 0) {
      this.bot.equip(weapons[0], 'hand').catch(err => logger.error('Actuation:Combat', 'Equip weapon failed', err));
    }

    this.bot.attack(entity);
  }

  stopCombat() {
    this.target = null;
  }
}

module.exports = CombatActuator;
