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

  wander(radius = 15) {
    if (!this.bot.entity) return;
    const current = this.bot.entity.position;
    const dx = Math.floor((Math.random() - 0.5) * radius * 2);
    const dz = Math.floor((Math.random() - 0.5) * radius * 2);
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
