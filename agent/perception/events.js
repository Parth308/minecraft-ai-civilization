const EventEmitter = require('events');
const logger = require('../../shared/logger');

class EventObserver extends EventEmitter {
  constructor(bot) {
    super();
    this.bot = bot;
    this.lastTimePhase = 'day';
    this.setupListeners();
  }

  setupListeners() {
    // Health & Combat Events
    this.bot.on('entityHurt', (entity) => {
      if (entity === this.bot.entity) {
        logger.warn('Perception', `${this.bot.username} took damage! Current health: ${this.bot.health}`);
        this.emit('agentHurt', { health: this.bot.health });
      }
    });

    this.bot.on('death', () => {
      logger.error('Perception', `${this.bot.username} died!`);
      this.emit('agentDeath', { position: this.bot.entity ? this.bot.entity.position : null });
    });

    this.bot.on('respawn', () => {
      logger.info('Perception', `${this.bot.username} respawned.`);
      this.emit('agentRespawn', {});
    });

    this.bot.on('entityAttack', (attacker, target) => {
      if (target === this.bot.entity && attacker) {
        logger.warn('Perception', `Attacked by ${attacker.username || attacker.name || 'unknown entity'}`);
        this.emit('underAttack', { attacker });
      }
    });

    // Chat & Social Events
    this.bot.on('chat', (username, message) => {
      if (username === this.bot.username) return;
      logger.info('Perception', `Chat observed [${username}]: ${message}`);
      this.emit('playerChat', { username, message });
    });

    this.bot.on('whisper', (username, message) => {
      if (username === this.bot.username) return;
      logger.info('Perception', `Whisper observed from [${username}]: ${message}`);
      this.emit('playerWhisper', { username, message });
    });

    // Item & World Interaction Events
    this.bot.on('playerCollect', (collector, collected) => {
      if (collector === this.bot.entity) {
        logger.info('Perception', `Collected dropped item!`);
        this.emit('itemCollected', { item: collected });
      }
    });

    this.bot.on('diggingCompleted', (block) => {
      logger.info('Perception', `Mined block: ${block.name}`);
      this.emit('blockBroken', { blockName: block.name, position: block.position });
    });

    // Atmosphere & Environment Events
    this.bot.on('rain', () => {
      logger.info('Perception', `Weather changed: isRaining=${this.bot.isRaining}`);
      this.emit('weatherChanged', { isRaining: this.bot.isRaining });
    });

    this.bot.on('time', () => {
      if (!this.bot.time) return;
      const tod = this.bot.time.timeOfDay;
      let currentPhase = 'day';
      if (tod >= 12000 && tod < 13000) currentPhase = 'sunset';
      else if (tod >= 13000 && tod < 22000) currentPhase = 'night';
      else if (tod >= 22000 && tod <= 24000) currentPhase = 'sunrise';

      if (currentPhase !== this.lastTimePhase) {
        logger.info('Perception', `Time transition: entered ${currentPhase}`);
        this.lastTimePhase = currentPhase;
        this.emit('timeTransition', { phase: currentPhase, timeOfDay: tod });
      }
    });
  }
}

module.exports = EventObserver;
