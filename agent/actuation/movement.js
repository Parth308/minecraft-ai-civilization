const { goals } = require('mineflayer-pathfinder');
const GoalNear = goals.GoalNear;
const GoalBlock = goals.GoalBlock;
const logger = require('../../shared/logger');

class MovementActuator {
  constructor(bot) {
    this.bot = bot;
  }

  goto(x, y, z, range = 1) {
    logger.info('Actuation:Movement', `Moving to X:${x} Y:${y} Z:${z}`);
    this.bot.pathfinder.setGoal(new GoalNear(x, y, z, range));
  }

  gotoBlock(x, y, z) {
    logger.info('Actuation:Movement', `Navigating to block X:${x} Y:${y} Z:${z}`);
    this.bot.pathfinder.setGoal(new GoalBlock(x, y, z));
  }

  fleeFrom(entity, distance = 16) {
    if (!entity || !entity.position) return;
    const current = this.bot.entity.position;
    const diff = current.minus(entity.position).normalize().scale(distance);
    const target = current.plus(diff);
    logger.info('Actuation:Movement', `Fleeing from entity to X:${Math.round(target.x)} Z:${Math.round(target.z)}`);
    this.goto(target.x, target.y, target.z, 2);
  }

  wander(radius = 15) {
    if (!this.bot.entity) return;
    const current = this.bot.entity.position;
    const dx = Math.floor((Math.random() - 0.5) * radius * 2);
    const dz = Math.floor((Math.random() - 0.5) * radius * 2);
    logger.info('Actuation:Movement', `Wandering around offset dx:${dx}, dz:${dz}`);
    this.goto(current.x + dx, current.y, current.z + dz, 2);
  }

  stop() {
    logger.info('Actuation:Movement', 'Stopping pathfinder goal.');
    this.bot.pathfinder.setGoal(null);
  }

  isMoving() {
    return this.bot.pathfinder ? this.bot.pathfinder.isMoving() : false;
  }
}

module.exports = MovementActuator;
