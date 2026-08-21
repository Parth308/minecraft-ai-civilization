const Vec3 = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const logger = require('../../shared/logger');
const detailedLogger = require('../../shared/detailedLogger');

class CombatActuator {
  constructor(bot) {
    this.bot = bot;
    this.target = null;
    this.blocking = false;
    this._combatLoop = null;
    this._lastAttackMs = 0;
    // Minecraft sword attack cooldown is ~600ms at full charge (for 1.9+ servers)
    this._attackCooldownMs = 630;
  }

  get agentId() {
    return this.bot.username || 'UnknownAgent';
  }

  // ─── Armor & Weapon ─────────────────────────────────────────────────────────

  async equipBestArmor() {
    if (!this.bot.inventory) return;
    const items = this.bot.inventory.items();
    const armorTiers = ['netherite', 'diamond', 'iron', 'golden', 'chainmail', 'leather'];
    const armorSlots = { helmet: 'head', chestplate: 'torso', leggings: 'legs', boots: 'feet' };

    for (const [type, slot] of Object.entries(armorSlots)) {
      for (const tier of armorTiers) {
        const piece = items.find(i => i.name === `${tier}_${type}`);
        if (piece) {
          try {
            await this.bot.equip(piece, slot);
            detailedLogger.logCombat(this.agentId, `Equipped armor: ${piece.name} → ${slot}`);
            break;
          } catch (err) { /* slot already occupied with better gear */ }
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

    for (const name of weaponTiers) {
      const weapon = items.find(i => i.name === name);
      if (weapon) {
        try {
          await this.bot.equip(weapon, 'hand');
          detailedLogger.logCombat(this.agentId, `Equipped weapon: ${weapon.name}`);
          return true;
        } catch (err) { /* try next */ }
      }
    }
    return false;
  }

  hasBow() {
    if (!this.bot.inventory) return false;
    return !!this.bot.inventory.items().find(i => i.name === 'bow');
  }

  hasArrows() {
    if (!this.bot.inventory) return false;
    return !!this.bot.inventory.items().find(i => i.name === 'arrow' || i.name === 'spectral_arrow' || i.name === 'tipped_arrow');
  }

  // ─── Shield ──────────────────────────────────────────────────────────────────

  async useShield(enable = true) {
    if (!this.bot.inventory) return;
    const shield = this.bot.inventory.items().find(i => i.name === 'shield');
    if (!shield) return;

    if (enable && !this.blocking) {
      try {
        await this.bot.equip(shield, 'off-hand');
        this.bot.activateItem(true);
        this.blocking = true;
        detailedLogger.logCombat(this.agentId, 'Shield raised — blocking stance');
      } catch (err) { /* ignore */ }
    } else if (!enable && this.blocking) {
      try { this.bot.deactivateItem(); } catch (err) { /* ignore */ }
      this.blocking = false;
      detailedLogger.logCombat(this.agentId, 'Shield lowered');
    }
  }

  // ─── Critical Hit ────────────────────────────────────────────────────────────

  // In Minecraft, a crit happens when the player is falling (not on the ground).
  // The bot jumps, waits to reach peak/fall, then attacks for 1.5× damage.
  async criticalAttack(entity) {
    if (!entity || !this.bot.entity) return;
    try {
      // Jump and hit during descent for a crit
      this.bot.setControlState('jump', true);
      await new Promise(r => setTimeout(r, 180));
      this.bot.setControlState('jump', false);
      await new Promise(r => setTimeout(r, 200)); // wait for descent
      await this.bot.lookAt(entity.position.offset(0, entity.height || 1.6, 0), true);
      this.bot.attack(entity);
      detailedLogger.logCombat(this.agentId, `CRITICAL HIT on ${entity.name || entity.username || 'target'}`);
    } catch (err) {
      logger.warn('Combat', `Crit attack failed: ${err.message}`);
    }
  }

  // ─── Bow / Ranged Attack ─────────────────────────────────────────────────────

  // Charges bow for ~1s (full power), then releases at target.
  async bowAttack(entity) {
    if (!entity || !this.bot.entity) return false;
    if (!this.hasBow() || !this.hasArrows()) {
      logger.debug('Combat', 'No bow or arrows — falling back to melee');
      return false;
    }

    try {
      const bow = this.bot.inventory.items().find(i => i.name === 'bow');
      await this.bot.equip(bow, 'hand');
      await this.bot.lookAt(entity.position.offset(0, entity.height || 1.6, 0), true);

      // Charge the bow (hold use-item)
      this.bot.activateItem();
      await new Promise(r => setTimeout(r, 1000)); // ~1s = full power shot
      this.bot.deactivateItem();

      detailedLogger.logCombat(this.agentId, `Bow shot released at ${entity.name || entity.username || 'target'}`, {
        distance: Math.round(this.bot.entity.position.distanceTo(entity.position))
      });
      return true;
    } catch (err) {
      logger.error('Combat', `Bow attack failed: ${err.message}`);
      try { this.bot.deactivateItem(); } catch (_) { /* ignore */ }
      return false;
    }
  }

  // ─── Sustained Melee Combat Loop ─────────────────────────────────────────────

  // Runs a persistent combat loop: chase → look → attack (with crits) → repeat
  async engageMelee(entity) {
    if (!entity || !this.bot.entity) return;
    const targetName = entity.name || entity.username || 'hostile';
    const REACH = 3.5;

    // Chase target into melee range
    const chase = () => {
      if (!entity.isValid || !this.bot.entity) return;
      this.bot.pathfinder.setGoal(new goals.GoalFollow(entity, 2), true);
    };

    const tryAttack = async () => {
      if (!entity || !this.bot.entity || !entity.isValid) return;
      const dist = this.bot.entity.position.distanceTo(entity.position);
      if (dist > REACH + 1) return; // chasing, not in range yet

      const now = Date.now();
      if (now - this._lastAttackMs < this._attackCooldownMs) return; // cooldown not ready

      this._lastAttackMs = now;
      await this.bot.lookAt(entity.position.offset(0, entity.height || 1.6, 0), true);

      // Use crit every 3rd hit for extra damage
      const hitCount = Math.round(now / this._attackCooldownMs);
      if (hitCount % 3 === 0 && !this.blocking) {
        await this.criticalAttack(entity);
      } else {
        this.bot.attack(entity);
      }
    };

    detailedLogger.logCombat(this.agentId, `Sustained melee combat started against: ${targetName}`);
    chase();

    // Run combat ticks every 200ms
    this._combatLoop = setInterval(async () => {
      if (!entity || !this.bot.entity || !entity.isValid) {
        this.stopCombat();
        return;
      }
      try {
        chase();
        await tryAttack();
      } catch (err) {
        logger.error('Combat', `Combat loop error: ${err.message}`);
      }
    }, 200);
  }

  // ─── Main Attack Entry ───────────────────────────────────────────────────────

  // Decides whether to use bow (if ranged + has bow) or melee, and runs the loop.
  async attack(entity) {
    if (!entity || !this.bot.entity) return;

    this.stopCombat(); // cancel any existing loop first
    this.target = entity;
    const targetName = entity.name || entity.username || 'hostile';

    detailedLogger.logCombat(this.agentId, `Initiating combat against: ${targetName}`, {
      targetId: entity.id,
      position: entity.position,
      botHealth: this.bot.health
    });
    logger.info('Actuation:Combat', `Engaging target: ${targetName}`);

    await this.equipBestArmor();

    // Try ranged first if target is far and we have a bow
    if (this.bot.entity) {
      const dist = this.bot.entity.position.distanceTo(entity.position);
      if (dist > 6 && this.hasBow() && this.hasArrows()) {
        const bowResult = await this.bowAttack(entity);
        if (bowResult) {
          // After bow shot, check if target still alive and in range for melee follow-up
          await new Promise(r => setTimeout(r, 400));
          if (entity.isValid) {
            await this.equipBestWeapon();
            await this.engageMelee(entity);
          }
          return;
        }
      }
    }

    // Fallback: melee
    await this.equipBestWeapon();
    await this.engageMelee(entity);
  }

  // ─── Stop Combat ─────────────────────────────────────────────────────────────

  stopCombat() {
    if (this._combatLoop) {
      clearInterval(this._combatLoop);
      this._combatLoop = null;
    }
    if (this.target) {
      detailedLogger.logCombat(this.agentId, `Disengaged from: ${this.target.name || this.target.username || 'target'}`);
    }
    this.target = null;
    this.useShield(false);
    try {
      this.bot.pathfinder.setGoal(null);
    } catch (err) { /* ignore */ }
  }
}

module.exports = CombatActuator;
