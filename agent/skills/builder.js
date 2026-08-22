const Vec3 = require('vec3');
const logger = require('../../shared/logger');
const detailedLogger = require('../../shared/detailedLogger');

class BuilderSkill {
  constructor(bot, inventoryActuator, movementActuator) {
    this.bot = bot;
    this.inventory = inventoryActuator;
    this.movement = movementActuator;
  }

  get agentId() {
    return this.bot.username || 'UnknownAgent';
  }

  getAvailableBuildingBlocks() {
    if (!this.bot.inventory) return [];
    return this.bot.inventory.items().filter(i => 
      i.name.includes('planks') ||
      i.name.includes('cobblestone') ||
      i.name.includes('stone') ||
      i.name.includes('dirt') ||
      i.name.includes('wood') ||
      i.name.includes('brick')
    );
  }

  async buildShelter(origin = null, width = 3, length = 3, height = 2) {
    const buildBlocks = this.getAvailableBuildingBlocks();
    if (buildBlocks.length === 0) {
      logger.warn('Builder', 'No building blocks available in inventory to build shelter.');
      return false;
    }

    const startPos = origin || this.bot.entity.position.floored().offset(2, 0, 2);
    logger.info('Builder', `Starting autonomous shelter construction at ${startPos} (${width}x${length}x${height})...`);
    detailedLogger.logCognition(this.agentId, 'Initiated Autonomous Shelter Construction', { origin: startPos, dimensions: { width, length, height } });

    let placedCount = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        for (let z = 0; z < length; z++) {
          // Build only the perimeter walls (leave interior empty, leave 1 door block open on front wall)
          const isPerimeter = (x === 0 || x === width - 1 || z === 0 || z === length - 1);
          const isDoor = (x === Math.floor(width / 2) && z === 0 && (y === 0 || y === 1));

          if (isPerimeter && !isDoor) {
            const targetPos = startPos.offset(x, y, z);
            const currentBlock = this.bot.blockAt(targetPos);

            if (currentBlock && currentBlock.name === 'air') {
              const groundBelow = this.bot.blockAt(targetPos.offset(0, -1, 0));
              const primaryBlock = this.getAvailableBuildingBlocks()[0];

              if (!primaryBlock) break;

              if (groundBelow && groundBelow.name !== 'air') {
                try {
                  await this.movement.goto(targetPos.x, targetPos.y, targetPos.z, 2);
                  await this.inventory.placeBlock(primaryBlock.name, groundBelow, new Vec3(0, 1, 0));
                  placedCount++;
                } catch (e) {
                  // continue
                }
              }
            }
          }
        }
      }
    }

    logger.info('Builder', `Shelter construction complete. Placed ${placedCount} structural blocks.`);
    detailedLogger.logInventory(this.agentId, 'Completed Structure Build', { blocksPlaced: placedCount });
    return placedCount > 0;
  }
}

module.exports = BuilderSkill;
