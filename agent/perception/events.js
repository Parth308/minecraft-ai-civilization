const EventEmitter = require('events');
const logger = require('../../shared/logger');

class EventObserver extends EventEmitter {
  constructor(bot) {
    super();
    this.bot = bot;
    this.setupListeners();
  }

  setupListeners() {
    this.bot.on('entityHurt', (entity) => {
      if (entity === this.bot.entity) {
        logger.warn('Perception', `${this.bot.username} took damage! Current health: ${this.bot.health}`);
        this.emit('agentHurt', { health: this.bot.health });
      }
    });

    this.bot.on('chat', (username, message) => {
      if (username === this.bot.username) return;
      logger.info('Perception', `Chat observed [${username}]: ${message}`);
      this.emit('playerChat', { username, message });
    });

    this.bot.on('entityAttack', (attacker, target) => {
      if (target === this.bot.entity && attacker) {
        logger.warn('Perception', `Attacked by ${attacker.username || attacker.name || 'unknown entity'}`);
        this.emit('underAttack', { attacker });
      }
    });
  }
}

module.exports = EventObserver;
