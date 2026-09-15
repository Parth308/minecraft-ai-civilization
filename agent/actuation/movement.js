const { goals } = require('mineflayer-pathfinder');
const GoalNear = goals.GoalNear;
const GoalBlock = goals.GoalBlock;
const GoalFollow = goals.GoalFollow;
const Vec3 = require('vec3');
const logger = require('../../shared/logger');
const detailedLogger = require('../../shared/detailedLogger');

let baritoneGoals;
try {
  baritoneGoals = require('@miner-org/mineflayer-baritone').goals;
} catch {
  baritoneGoals = null;
}

class MovementActuator {
  constructor(bot) {
    this.bot = bot;
  }

  get agentId() {
    return this.bot.username || 'UnknownAgent';
  }

  // --- Pathfinding & Navigation ---

  goto(x, y, z, range = 1) {
    logger.info('Actuation:Movement', `Navigating to coordinates X:${x} Y:${y} Z:${z} (Range: ${range})`);
    detailedLogger.logMovement(this.agentId, 'Navigating to coordinates', { target: { x, y, z, range }, currentPos: this.bot.entity?.position });
    if (this.bot.ashfinder && baritoneGoals) {
      this.bot.ashfinder.goto(new baritoneGoals.GoalNear(new Vec3(x, y, z), range));
    } else {
      this.bot.pathfinder.setGoal(new GoalNear(x, y, z, range));
    }
  }

  gotoBlock(x, y, z) {
    logger.info('Actuation:Movement', `Navigating directly to block X:${x} Y:${y} Z:${z}`);
    detailedLogger.logMovement(this.agentId, 'Navigating to block goal', { blockPos: { x, y, z } });
    if (this.bot.ashfinder && baritoneGoals) {
      this.bot.ashfinder.goto(new baritoneGoals.GoalExact(new Vec3(x, y, z)));
    } else {
      this.bot.pathfinder.setGoal(new GoalBlock(x, y, z));
    }
  }

  follow(entity, distance = 2) {
    if (!entity) return;
    logger.info('Actuation:Movement', `Following entity ${entity.username || entity.name} at distance ${distance}`);
    detailedLogger.logMovement(this.agentId, 'Following entity', { target: entity.username || entity.name, distance });
    this.bot.pathfinder.setGoal(new GoalFollow(entity, distance), true);
  }

  fleeFrom(entity, distance = 16) {
    if (!entity || !entity.position || !this.bot.entity) return;
    const current = this.bot.entity.position;
    const diff = current.minus(entity.position).normalize().scale(distance);
    const target = current.plus(diff);
    logger.info('Actuation:Movement', `Fleeing from threat to X:${Math.round(target.x)} Z:${Math.round(target.z)}`);
    detailedLogger.logMovement(this.agentId, 'Fleeing from threat', { threat: entity.name || entity.username, fleeTo: { x: target.x, y: target.y, z: target.z } });
    this.goto(target.x, target.y, target.z, 2);
  }

  // Ambient night-flee re-fires every decision cycle; without waypoint
  // commitment each re-fire randomized the destination (jitter livelock).
  goToShelter(radius = 24, maxAgeMs = 60000) {
    const now = Date.now();
    const pos = this.bot.entity?.position;

    if (this._shelter && this._shelter.expiresAt > now) {
      if (!pos || pos.distanceTo(this._shelter.target) > 2.5) {
        return { committed: true, arrived: false, target: this._shelter.target };
      }
      this._shelter = null;
      logger.info('Actuation:Movement', 'Shelter waypoint reached — releasing commitment');
      return { committed: false, arrived: true };
    }

    let target = null;
    try {
      const lightBlocks = ['torch', 'lantern', 'campfire', 'glowstone', 'sea_lantern', 'jack_o_lantern', 'shroomlight'];
      const lightIds = lightBlocks.map(n => this.bot.registry?.blocksByName[n]?.id).filter(id => id != null);
      if (pos && lightIds.length > 0) {
        const found = this.bot.findBlock({ matching: lightIds, maxDistance: radius, count: 1 });
        if (found) target = found.position.clone();
      }
    } catch { /* registry/findBlock unavailable — fall through to offset */ }

    if (!target && pos) {
      const dx = Math.floor((Math.random() - 0.5) * radius * 2);
      const dz = Math.floor((Math.random() - 0.5) * radius * 2);
      target = pos.offset(dx, 0, dz);
    }

    if (!target) return { committed: false, arrived: false };

    this._shelter = { target, expiresAt: now + maxAgeMs };
    logger.info('Actuation:Movement', `Committed to shelter waypoint X:${Math.round(target.x)} Y:${Math.round(target.y)} Z:${Math.round(target.z)} for ${Math.round(maxAgeMs / 1000)}s`);
    this.goto(target.x, target.y, target.z, 2);
    return { committed: true, arrived: false, target };
  }

  clearShelterCommitment() {
    this._shelter = null;
  }

  // Bias away from nearby lethal blocks — random walks kept stepping into lava.
  _hazardWithin(radius = 3) {
    if (!this.bot.entity) return null;
    const hazardKeywords = ['lava', 'fire', 'magma_block', 'water'];
    try {
      const found = this.bot.findBlocks({
        matching: (block) => block && hazardKeywords.some(k => block.name.includes(k)),
        maxDistance: radius,
        count: 1
      });
      if (found.length === 0) return null;
      const block = this.bot.blockAt(found[0]);
      return block ? { block, distance: this.bot.entity.position.distanceTo(found[0]) } : null;
    } catch {
      return null;
    }
  }

  wander(radius = 15) {
    if (!this.bot.entity) return;
    const current = this.bot.entity.position;
    let dx = Math.floor((Math.random() - 0.5) * radius * 2);
    let dz = Math.floor((Math.random() - 0.5) * radius * 2);

    const near = this._hazardWithin(3);
    if (near) {
      const away = current.minus(near.block.position);
      dx = Math.sign(away.x || (Math.random() - 0.5)) * radius;
      dz = Math.sign(away.z || (Math.random() - 0.5)) * radius;
      logger.info('Actuation:Movement', `Hazard-biased wander: steering away from ${near.block.name} (${near.distance.toFixed(1)} blocks)`);
    }

    detailedLogger.logMovement(this.agentId, 'Wandering around offset', { offset: { dx, dz }, destination: { x: current.x + dx, z: current.z + dz } });
    this.goto(current.x + dx, current.y, current.z + dz, 2);
  }

  stop() {
    logger.info('Actuation:Movement', 'Stopping all active movement.');
    detailedLogger.logMovement(this.agentId, 'Stopped movement');
    if (this.bot.ashfinder) {
      this.bot.ashfinder.stop();
    } else {
      this.bot.pathfinder.setGoal(null);
    }
    this.bot.clearControlStates();
  }

  isMoving() {
    if (this.bot.ashfinder) {
      return !this.bot.ashfinder.stopped;
    }
    return this.bot.pathfinder ? this.bot.pathfinder.isMoving() : false;
  }

  // --- Physical Control States (Sprint, Sneak, Jump, Swim, Look) ---

  lookAt(x, y, z, force = false) {
    if (!this.bot.entity) return;
    detailedLogger.logMovement(this.agentId, 'Rotated gaze / lookAt', { lookTarget: { x, y, z }, force });
    return this.bot.lookAt(new Vec3(x, y, z), force);
  }

  lookAtEntity(entity) {
    if (!entity || !entity.position) return;
    const eyePos = entity.position.offset(0, entity.height || 1.6, 0);
    detailedLogger.logMovement(this.agentId, 'Gaze locked onto entity', { target: entity.username || entity.name });
    return this.bot.lookAt(eyePos);
  }

  sprint(enable = true) {
    detailedLogger.logMovement(this.agentId, enable ? 'Started sprinting' : 'Stopped sprinting');
    this.bot.setControlState('sprint', enable);
  }

  sneak(enable = true) {
    detailedLogger.logMovement(this.agentId, enable ? 'Started sneaking/crouching' : 'Stopped sneaking/crouching');
    this.bot.setControlState('sneak', enable);
  }

  jump() {
    detailedLogger.logMovement(this.agentId, 'Executed jump');
    this.bot.setControlState('jump', true);
    setTimeout(() => this.bot.setControlState('jump', false), 350);
  }

  swim() {
    if (this.bot.entity && this.bot.entity.isInWater) {
      detailedLogger.logMovement(this.agentId, 'Swimming in water');
      this.bot.setControlState('jump', true);
      this.bot.setControlState('sprint', true);
    }
  }

  // Drowning escape: pathfinder alone never ascends — bot must hold jump
  // while moving straight up to first air above. Called from FLEE execution.
  swimToSurface() {
    if (!this.bot.entity) return false;
    const pos = this.bot.entity.position;
    let surfaceY = null;
    try {
      for (let y = Math.floor(pos.y); y < Math.floor(pos.y) + 30; y++) {
        const b = this.bot.blockAt(new Vec3(Math.floor(pos.x), y, Math.floor(pos.z)));
        if (b && b.name !== 'water' && b.name !== 'flowing_water' && b.name !== 'bubble_column') {
          surfaceY = y;
          break;
        }
      }
    } catch {
    }
    this._swimEscape = true;
    this.bot.setControlState('jump', true);
    this.bot.setControlState('sprint', true);
    if (surfaceY != null) this.goto(pos.x, surfaceY + 1, pos.z, 1);
    logger.info('Actuation:Movement', `Swim-to-surface: holding jump toward Y:${surfaceY}`);
    return true;
  }

  // Release escape controls once dry — pathfinder re-asserts what it needs.
  releaseSwim() {
    if (!this._swimEscape) return;
    this._swimEscape = false;
    try {
      this.bot.setControlState('jump', false);
      this.bot.setControlState('sprint', false);
    } catch {
    }
  }

  stopSwimming() {
    this.bot.setControlState('jump', false);
  }

  // Emergency survival: dig a 2-block hole and crouch when no shelter exists.
  /**
   * DIG_UP: Dig upward to escape underground dead-ends.
   * Creates a 1x1 shaft going up until reaching surface or max height.
   * Used when stuck underground with no tools/resources to progress.
   * 
   * @param {number} targetY - Target Y coordinate to dig to (default: 65, surface + 5)
   * @param {number} maxBlocks - Maximum blocks to dig upward (default: 50)
   * @returns {Promise<{success: boolean, blocksDug: number, reason: string}>}
   */
  async digUpToSurface(targetY = 65, maxBlocks = 50) {
    const botPos = this.bot.entity?.position;
    if (!botPos) return { success: false, blocksDug: 0, reason: 'no_position' };

    const bx = Math.floor(botPos.x);
    const bz = Math.floor(botPos.z);
    const by = Math.floor(botPos.y);

    const below = this.bot.blockAt(new Vec3(bx, by - 1, bz));
    const at1 = this.bot.blockAt(new Vec3(bx, by + 1, bz));
    const at2 = this.bot.blockAt(new Vec3(bx, by + 2, bz));
    const onGround = this.bot.entity.onGround;
    logger.info('Actuation:Movement',
      `DIG_UP DIAG: pos=(${bx},${by},${bz}) onGround=${onGround} below=${below?.name} Y+1=${at1?.name} Y+2=${at2?.name}`);
    detailedLogger.logMovement(this.agentId, 'DIG_UP: Starting ascent', { from: botPos.y, to: targetY, below: below?.name, at1: at1?.name, at2: at2?.name, onGround });

    let blocksDug = 0;
    let stuckCount = 0;

    try {
      while (blocksDug < maxBlocks) {
        const currentY = Math.floor(this.bot.entity?.position?.y || 0);

        if (currentY >= targetY) {
          logger.info('Actuation:Movement', `DIG_UP: Reached target Y:${currentY} after ${blocksDug} blocks`);
          return { success: true, blocksDug, reason: 'reached_target' };
        }

        if (currentY >= 60) {
          const blockAbove = this.bot.blockAt(new Vec3(bx, currentY + 1, bz));
          if (!blockAbove || blockAbove.type === 0 || ['air', 'cave_air', 'void_air'].includes(blockAbove.name)) {
            logger.info('Actuation:Movement', `DIG_UP: Reached open air at Y:${currentY} after ${blocksDug} blocks`);
            return { success: true, blocksDug, reason: 'reached_surface' };
          }
        }

        const blockAbove = this.bot.blockAt(new Vec3(bx, currentY + 1, bz));
        if (!blockAbove) return { success: false, blocksDug, reason: 'no_block_above' };

        if (blockAbove.name === 'bedrock' || blockAbove.hardness < 0) {
          logger.warn('Actuation:Movement', `DIG_UP: Hit unbreakable ${blockAbove.name} at Y:${currentY + 1}`);
          return { success: false, blocksDug, reason: `unbreakable_${blockAbove.name}` };
        }

        const isAir = blockAbove.type === 0 || ['air', 'cave_air', 'void_air'].includes(blockAbove.name);

        if (!isAir) {
          logger.info('Actuation:Movement', `DIG_UP: Digging ${blockAbove.name} at Y:${currentY + 1} (${blocksDug + 1}/${maxBlocks})`);
          await this.bot.dig(blockAbove);
          blocksDug++;
        }

        const blockTwoUp = this.bot.blockAt(new Vec3(bx, currentY + 2, bz));
        if (blockTwoUp && !(blockTwoUp.type === 0 || ['air', 'cave_air', 'void_air'].includes(blockTwoUp.name))) {
          if (blockTwoUp.name !== 'bedrock' && blockTwoUp.hardness >= 0) {
            logger.info('Actuation:Movement', `DIG_UP: Digging ceiling ${blockTwoUp.name} at Y:${currentY + 2} for headroom`);
            await this.bot.dig(blockTwoUp);
            blocksDug++;
          } else {
            return { success: false, blocksDug, reason: `unbreakable_ceiling_${blockTwoUp.name}` };
          }
        }

        // Clear any pathfinder goal that may override manual controls
        if (this.bot.pathfinder?.setGoal) {
          try { this.bot.pathfinder.setGoal(null); } catch {}
          await this.bot.waitForTicks(3);
        }

        // Try direct velocity injection (Minecraft jump = 0.42 upward)
        this.bot.entity.velocity.y = 0.42;
        this.bot.setControlState('jump', true);
        this.bot.setControlState('forward', true);
        await this.bot.waitForTicks(5);
        this.bot.setControlState('jump', false);
        this.bot.setControlState('forward', false);
        await this.bot.waitForTicks(10);

        // Also try pathfinder as secondary attempt
        if (this.bot.pathfinder?.setGoal) {
          try {
            this.bot.pathfinder.setGoal(new GoalBlock(bx, currentY + 1, bz));
            await this.bot.waitForTicks(15);
            this.bot.pathfinder.setGoal(null);
          } catch {}
        }

        const newY = Math.floor(this.bot.entity?.position?.y || 0);
        logger.info('Actuation:Movement', `DIG_UP: After climb attempt Y:${newY} (was ${currentY}) blocks_dug=${blocksDug}`);
        if (newY <= currentY) {
          stuckCount++;
          if (stuckCount > 3) {
            logger.warn('Actuation:Movement', `DIG_UP: Stuck at Y:${currentY} after ${stuckCount} attempts, ${blocksDug} blocks dug`);
            return { success: false, blocksDug, reason: 'stuck_no_climb' };
          }
          await this.bot.waitForTicks(10);
        } else {
          stuckCount = 0;
        }
      }

      return { success: false, blocksDug, reason: 'max_blocks_reached' };
    } catch (err) {
      logger.debug('Actuation:Movement', `DIG_UP failed after ${blocksDug} blocks: ${err.message}`);
      return { success: false, blocksDug, reason: err.message };
    }
  }

  // Called from FLEE execution when night + no blocks + no nearby shelter.
  async emergencyDigIn() {
    const pos = this.bot.entity?.position;
    if (!pos) return { success: false, reason: 'no_position' };

    const blockBelow = this.bot.blockAt(new Vec3(Math.floor(pos.x), Math.floor(pos.y) - 1, Math.floor(pos.z)));
    if (!blockBelow) return { success: false, reason: 'no_block_below' };

    // Can't dig through bedrock or unbreakable blocks
    if (blockBelow.name === 'bedrock' || blockBelow.hardness < 0) {
      return { success: false, reason: 'unbreakable_block' };
    }

    logger.info('Actuation:Movement', `Emergency dig-in: digging below at ${blockBelow.position}`);
    detailedLogger.logMovement(this.agentId, 'Emergency dig-in', { blockPos: blockBelow.position });

    try {
      // Dig block below feet
      await this.bot.dig(blockBelow);
      // Dig one more down to create a 2-deep hole
      const blockBelow2 = this.bot.blockAt(new Vec3(Math.floor(pos.x), Math.floor(pos.y) - 2, Math.floor(pos.z)));
      if (blockBelow2 && blockBelow2.hardness >= 0) {
        await this.bot.dig(blockBelow2);
      }
      // Crouch to stay in hole
      this.sneak(true);
      logger.info('Actuation:Movement', 'Emergency dig-in complete — crouching in hole');
      return { success: true, reason: 'dug_in' };
    } catch (err) {
      logger.debug('Actuation:Movement', `Emergency dig-in failed: ${err.message}`);
      return { success: false, reason: err.message };
    }
  }
}

module.exports = MovementActuator;
