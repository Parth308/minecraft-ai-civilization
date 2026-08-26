const EventEmitter = require('events');
const logger = require('../../shared/logger');
const { CHAT_AUDIBLE_RANGE } = require('../../shared/constants');

class EventObserver extends EventEmitter {
  constructor(bot) {
    super();
    this.bot = bot;
    this.lastTimePhase = 'day';
    this._fireCheckInterval = null;
    this.setupListeners();
  }

  setupListeners() {

    // ─── Health & Combat Events ────────────────────────────────────────────────

    this.bot.on('entityHurt', (entity) => {
      if (entity === this.bot.entity) {
        logger.warn('Perception', `${this.bot.username} took damage! Health: ${this.bot.health}`);
        this.emit('agentHurt', { health: this.bot.health });
      }
    });

    // Fires when any entity is damaged — used to detect melee attack source
    this.bot.on('entitySwingArm', (entity) => {
      if (!this.bot.entity || !entity || entity === this.bot.entity) return;
      const dist = this.bot.entity.position.distanceTo(entity.position);
      if (dist <= 4) {
        // Something close just swung — could be attacking us
        this.emit('nearbyAttackSwing', { entity });
      }
    });

    this.bot.on('death', () => {
      logger.error('Perception', `${this.bot.username} died!`);
      if (this._fireCheckInterval) clearInterval(this._fireCheckInterval);
      const cause = this._diagnoseDeathCause();
      logger.warn('Perception', `Death cause diagnosed: ${cause}`);
      this.emit('agentDeath', { position: this.bot.entity ? this.bot.entity.position : null, cause });
    });

    this.bot.on('respawn', () => {
      logger.info('Perception', `${this.bot.username} respawned.`);
      this._startFireCheck();
      this.emit('agentRespawn', {});
    });

    // Correct mineflayer event for "being hit" is listening to your own entityHurt
    // and checking entity.hurtingEntity if available
    this.bot.on('entityHurt', (entity) => {
      if (entity !== this.bot.entity) return;
      // Snapshot the presumed attacker — the death-cause ladder consumes this
      // when a fatal blow lands within 10s of the last hit.
      const hurter = entity.hurtingEntity;
      let attackerName = hurter ? (hurter.name || hurter.displayName || null) : null;
      const nearby = Object.values(this.bot.entities).filter(e => {
        if (!e || e === this.bot.entity) return false;
        if (!this.bot.entity) return false;
        return this.bot.entity.position.distanceTo(e.position) <= 6;
      });
      if (!attackerName && nearby.length > 0) {
        attackerName = nearby[0].name || nearby[0].displayName || null;
      }
      this._lastSelfHurt = { at: Date.now(), by: attackerName };
      if (nearby.length > 0) {
        this.emit('underAttack', { attacker: nearby[0] });
      }
    });

    // ─── Projectile Alerts ─────────────────────────────────────────────────────

    // Watch for new projectile entities spawning near the bot
    this.bot.on('entitySpawn', (entity) => {
      if (!this.bot.entity || !entity) return;
      const projectileTypes = ['arrow', 'spectral_arrow', 'fireball', 'trident', 'wither_skull'];
      const name = (entity.name || entity.displayName || '').toLowerCase();
      if (!projectileTypes.some(p => name.includes(p))) return;
      const dist = this.bot.entity.position.distanceTo(entity.position);
      if (dist <= 20) {
        logger.warn('Perception', `Incoming projectile detected: ${name} at distance ${Math.round(dist)}`);
        this.emit('incomingProjectile', { entity, name, distance: dist });
      }
    });

    // ─── Death Announcements (system chat broadcasts) ──────────────────────────
    // Paper prints deaths as system messages; witnessing them stirs grief,
    // hardens beliefs, and feeds the civilization's mortality salience.
    const DEATH_RE = /<([^>]+)>?\s*(?:was|got)?\s*(?:slain|shot|blown up|drowned|killed|pricked to death|squashed|fell from|fell out of the world)|^(\w+) (?:died|drowned|was slain)/;
    this.bot.on('message', (jsonMsg) => {
      const text = jsonMsg?.toString?.() || String(jsonMsg);
      if (!text || text.length > 120) return;
      if (/was slain|died|drowned|blew up|was shot|fell from a high place|was killed by/.test(text)) {
        const match = text.match(DEATH_RE) || text.match(/^(Agent_\w+|[A-Z]\w+) (?:died|drowned)/);
        const victim = match ? (match[1] || match[2]) : null;
        if (victim && victim !== this.bot.username) {
          logger.warn('Perception', `[WITNESSED] ${text.trim()}`);
          this.emit('witnessedDeath', { victim, raw: text.trim() });
        }
      }
    });

    // ─── Fire Detection (interval check since Mineflayer has no onFire event) ──

    this._startFireCheck();

    // ─── Chat & Social Events ──────────────────────────────────────────────────

    this.bot.on('chat', (username, message) => {
      if (username === this.bot.username) return;
      // Proximity hearing: voices fade with distance. A speaker whose entity
      // is out of render range — or beyond CHAT_AUDIBLE_RANGE blocks — is not
      // heard at all. Whispers ('whisper' event) bypass this gate: that is the
      // phone call channel.
      const speakerEntity = Object.values(this.bot.entities).find(e => e.username === username);
      if (!speakerEntity || !this.bot.entity) {
        logger.debug('Perception', `[UNHEARD] ${username} spoke beyond earshot`);
        return;
      }
      const dist = this.bot.entity.position.distanceTo(speakerEntity.position);
      if (dist > CHAT_AUDIBLE_RANGE) {
        logger.debug('Perception', `[UNHEARD] ${username} spoke ${Math.round(dist)} blocks away (> ${CHAT_AUDIBLE_RANGE})`);
        return;
      }
      logger.info('Perception', `Chat [${username}] @${Math.round(dist)}m: ${message}`);
      this.emit('playerChat', { username, message, distance: Math.round(dist) });
    });

    this.bot.on('whisper', (username, message) => {
      if (username === this.bot.username) return;
      logger.info('Perception', `Whisper from [${username}]: ${message}`);
      this.emit('playerWhisper', { username, message });
    });

    // Player joined / left
    this.bot.on('playerJoined', (player) => {
      if (player.username === this.bot.username) return;
      logger.info('Perception', `Player joined: ${player.username}`);
      this.emit('playerJoined', { username: player.username });
    });

    this.bot.on('playerLeft', (player) => {
      logger.info('Perception', `Player left: ${player.username}`);
      this.emit('playerLeft', { username: player.username });
    });

    // ─── Item & World Interaction Events ──────────────────────────────────────

    this.bot.on('playerCollect', (collector, collected) => {
      if (collector === this.bot.entity) {
        const metadataItemId = collected?.metadata?.[8]?.itemId ?? collected?.metadata?.[7]?.itemId;
        const itemName = this.bot.registry?.items?.[metadataItemId]?.name || collected?.name || 'unknown';
        logger.info('Perception', `Collected item: ${itemName}`);
        this.emit('itemCollected', { item: collected, itemName });
      }
    });

    this.bot.on('diggingStarted', (block) => {
      if (block) {
        this._currentDiggingBlock = {
          name: block.name,
          position: block.position?.clone ? block.position.clone() : block.position
        };
      }
    });

    this.bot.on('diggingCompleted', (block) => {
      const blockName = (this._currentDiggingBlock && this._currentDiggingBlock.name && this._currentDiggingBlock.name !== 'air')
        ? this._currentDiggingBlock.name
        : (block?.name && block.name !== 'air' ? block.name : 'block');
      logger.info('Perception', `Mined block: ${blockName}`);
      this.emit('blockBroken', { blockName, position: block.position });
      this._currentDiggingBlock = null;
    });

    this.bot.on('diggingAborted', () => {
      this._currentDiggingBlock = null;
    });

    this.bot.on('blockPlaced', (block) => {
      logger.info('Perception', `Placed block: ${block.name}`);
      this.emit('blockPlaced', { blockName: block.name, position: block.position });
    });

    // ─── Atmosphere & Environment Events ─────────────────────────────────────

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

  // Periodically check if bot is on fire (Mineflayer has no dedicated event for this)
  _startFireCheck() {
    if (this._fireCheckInterval) clearInterval(this._fireCheckInterval);
    this._onFireState = false;
    this._fireCheckInterval = setInterval(() => {
      if (!this.bot.entity) return;
      const isOnFire = this.bot.entity.onFire || false;
      if (isOnFire && !this._onFireState) {
        this._onFireState = true;
        logger.warn('Perception', `${this.bot.username} is on fire!`);
        this.emit('agentOnFire', {});
      } else if (!isOnFire && this._onFireState) {
        this._onFireState = false;
        this.emit('agentFireOut', {});
      }
    }, 500);
  }

  // Deterministic death-cause ladder evaluated at the moment of death. Mineflayer
  // gives no cause; without this every lesson degrades to "fatal hazard" and the
  // civilization can never learn WHAT kills its settlers. Order matters: mob
  // attribution wins only while the last hit is fresh, then environment.
  _diagnoseDeathCause() {
    try {
      const e = this.bot.entity;
      const lastHurt = this._lastSelfHurt;
      if (lastHurt && lastHurt.by && Date.now() - lastHurt.at < 10000) {
        return `slain by ${lastHurt.by}`;
      }
      const blockNameAt = (offsetY) => {
        try {
          const pos = offsetY === 0 ? e.position : e.position.offset(0, offsetY, 0);
          return this.bot.blockAt(pos)?.name || '';
        } catch { return ''; }
      };
      const feet = blockNameAt(0);
      const head = blockNameAt(1);
      const both = `${feet} ${head}`;
      if (both.includes('lava')) return 'lava';
      if (e.onFire || both.includes('fire')) return 'standing in fire';
      if (both.includes('magma')) return 'magma burns';
      if (both.includes('cactus')) return 'cactus';
      if (both.includes('powder_snow')) return 'freezing in powder snow';
      if (both.includes('sweet_berry')) return 'sweet berry bush';
      if (e.isInWater || both.includes('water')) return 'drowning';
      if ((e.velocity ? e.velocity.y : 0) < -0.4) return 'fall damage';
      const solidHead = head && !['air', 'cave_air', 'void_air', 'water', 'grass', 'tall_grass', 'fern'].some(a => head.includes(a));
      if (solidHead) return 'suffocation';
      return 'unknown hazard';
    } catch {
      return 'unknown hazard';
    }
  }
}

module.exports = EventObserver;
