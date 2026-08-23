const Vec3 = require('vec3');
const logger = require('../../shared/logger');
const detailedLogger = require('../../shared/detailedLogger');

class BuilderSkill {
  constructor(bot, inventoryActuator, movementActuator, goalManager = null) {
    this.bot = bot;
    this.inventory = inventoryActuator;
    this.movement = movementActuator;
    this.goalManager = goalManager || bot.goalManager || null;
    this.cooldownUntil = 0;
    this.invalidSites = new Set();
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
    if (Date.now() < this.cooldownUntil) {
      const remainingSec = Math.ceil((this.cooldownUntil - Date.now()) / 1000);
      logger.debug('Builder', `Shelter construction is on cooldown for another ${remainingSec}s.`);
      return false;
    }

    const buildBlocks = this.getAvailableBuildingBlocks();
    if (buildBlocks.length === 0) {
      logger.warn('Builder', 'No building blocks available in inventory to build shelter.');
      this.cooldownUntil = Date.now() + 30000;
      return false;
    }

    const startPos = origin || this.bot.entity.position.floored().offset(2, 0, 2);
    const siteKey = `${startPos.x},${startPos.y},${startPos.z}`;

    if (this.invalidSites.has(siteKey)) {
      logger.warn('Builder', `Skipping invalid build site at ${startPos} and applying cooldown.`);
      this.cooldownUntil = Date.now() + 60000;
      return false;
    }

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

    if (placedCount === 0) {
      this.invalidSites.add(siteKey);
      this.cooldownUntil = Date.now() + 60000;
      logger.warn('Builder', `Shelter construction failed (0 blocks placed at ${startPos}). Marked site invalid and set 60s cooldown.`);
      
      // Clear active build goal if currently set
      const gm = this.goalManager || this.bot.goalManager;
      if (gm && gm.currentGoal) {
        const desc = (gm.currentGoal.description || '').toLowerCase();
        if (desc.includes('shelter') || desc.includes('build')) {
          gm.setGoal('Explore surroundings and seek suitable building ground', { previousFailedSite: siteKey });
        }
      }
      return false;
    }

    logger.info('Builder', `Shelter construction complete. Placed ${placedCount} structural blocks.`);
    detailedLogger.logInventory(this.agentId, 'Completed Structure Build', { blocksPlaced: placedCount });
    return true;
  }
}

module.exports = BuilderSkill;

