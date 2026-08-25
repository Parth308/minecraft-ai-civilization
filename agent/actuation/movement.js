const { goals } = require('mineflayer-pathfinder');
const GoalNear = goals.GoalNear;
const GoalBlock = goals.GoalBlock;
const GoalFollow = goals.GoalFollow;
const Vec3 = require('vec3');
const logger = require('../../shared/logger');
const detailedLogger = require('../../shared/detailedLogger');

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
    this.bot.pathfinder.setGoal(new GoalNear(x, y, z, range));
  }

  gotoBlock(x, y, z) {
    logger.info('Actuation:Movement', `Navigating directly to block X:${x} Y:${y} Z:${z}`);
    detailedLogger.logMovement(this.agentId, 'Navigating to block goal', { blockPos: { x, y, z } });
    this.bot.pathfinder.setGoal(new GoalBlock(x, y, z));
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
    const hazardKeywords = ['lava', 'fire', 'magma_block'];
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
    this.bot.pathfinder.setGoal(null);
    this.bot.clearControlStates();
  }

  isMoving() {
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

  stopSwimming() {
    this.bot.setControlState('jump', false);
  }
}

module.exports = MovementActuator;
