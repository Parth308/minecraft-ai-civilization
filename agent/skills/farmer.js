const Vec3 = require('vec3');
const logger = require('../../shared/logger');
const detailedLogger = require('../../shared/detailedLogger');

class FarmerSkill {
  constructor(bot, inventoryActuator, movementActuator) {
    this.bot = bot;
    this.inventory = inventoryActuator;
    this.movement = movementActuator;
  }

  get agentId() {
    return this.bot.username || 'UnknownAgent';
  }

  getSeedsInInventory() {
    if (!this.bot.inventory) return [];
    return this.bot.inventory.items().filter(i => 
      i.name === 'wheat_seeds' ||
      i.name === 'carrot' ||
      i.name === 'potato' ||
      i.name === 'beetroot_seeds'
    );
  }

  getHoeInInventory() {
    if (!this.bot.inventory) return null;
    return this.bot.inventory.items().find(i => i.name.includes('hoe'));
  }

  getRawFoodInInventory() {
    if (!this.bot.inventory) return [];
    return this.bot.inventory.items().filter(i => 
      i.name.startsWith('raw_') ||
      i.name === 'beef' ||
      i.name === 'porkchop' ||
      i.name === 'chicken' ||
      i.name === 'mutton' ||
      i.name === 'potato'
    );
  }

  async tillAndPlant(radius = 12) {
    const hoe = this.getHoeInInventory();
    const seeds = this.getSeedsInInventory();
    if (!hoe || seeds.length === 0) return false;

    // Scan for dirt/grass blocks near water
    const pos = this.bot.entity.position.floored();
    for (let x = -radius; x <= radius; x++) {
      for (let z = -radius; z <= radius; z++) {
        for (let y = -2; y <= 2; y++) {
          const targetPos = pos.offset(x, y, z);
          const block = this.bot.blockAt(targetPos);
          const airAbove = this.bot.blockAt(targetPos.offset(0, 1, 0));

          if (block && (block.name === 'grass_block' || block.name === 'dirt') && airAbove && airAbove.name === 'air') {
            // Check if water is within 4 blocks horizontally
            let hasWater = false;
            for (let wx = -4; wx <= 4; wx++) {
              for (let wz = -4; wz <= 4; wz++) {
                const waterBlock = this.bot.blockAt(targetPos.offset(wx, 0, wz));
                if (waterBlock && (waterBlock.name === 'water' || waterBlock.name === 'flowing_water')) {
                  hasWater = true;
                  break;
                }
              }
              if (hasWater) break;
            }

            if (hasWater) {
              try {
                await this.movement.goto(targetPos.x, targetPos.y + 1, targetPos.z, 2);
                await this.bot.equip(hoe, 'hand');
                await this.bot.activateBlock(block);
                
                // Now plant seed on the newly created farmland
                const seedItem = this.getSeedsInInventory()[0];
                if (seedItem) {
                  await this.bot.equip(seedItem, 'hand');
                  await this.bot.placeBlock(block, new Vec3(0, 1, 0));
                  logger.info('Farmer', `Tilled and planted ${seedItem.name} at ${targetPos}`);
                  detailedLogger.logInventory(this.agentId, 'Planted Crop', { crop: seedItem.name, position: targetPos });
                  return true;
                }
              } catch (_) {}
            }
          }
        }
      }
    }
    return false;
  }

  async harvestAndReplant(radius = 16) {
    const cropTypes = ['wheat', 'carrots', 'potatoes', 'beetroots'];
    let harvestedCount = 0;
    const pos = this.bot.entity.position.floored();

    for (let x = -radius; x <= radius; x++) {
      for (let z = -radius; z <= radius; z++) {
        for (let y = -2; y <= 2; y++) {
          const cropPos = pos.offset(x, y, z);
          const cropBlock = this.bot.blockAt(cropPos);
          if (cropBlock && cropTypes.includes(cropBlock.name)) {
            // Mature metadata: 7 for wheat/carrots/potatoes, 3 for beetroots
            const isMature = (cropBlock.name === 'beetroots' && cropBlock.metadata === 3) || cropBlock.metadata === 7;
            if (isMature) {
              try {
                await this.movement.goto(cropPos.x, cropPos.y, cropPos.z, 2);
                await this.inventory.digBlock(cropBlock);
                harvestedCount++;

                // Replant seed
                const seedName = cropBlock.name === 'wheat' ? 'wheat_seeds' :
                                 cropBlock.name === 'carrots' ? 'carrot' :
                                 cropBlock.name === 'potatoes' ? 'potato' : 'beetroot_seeds';
                const seedItem = this.bot.inventory?.items().find(i => i.name === seedName);
                const farmland = this.bot.blockAt(cropPos.offset(0, -1, 0));
                if (seedItem && farmland && farmland.name === 'farmland') {
                  await this.bot.equip(seedItem, 'hand');
                  await this.bot.placeBlock(farmland, new Vec3(0, 1, 0));
                }
              } catch (_) {}
            }
          }
        }
      }
    }

    if (harvestedCount > 0) {
      logger.info('Farmer', `Harvested ${harvestedCount} mature crops`);
      detailedLogger.logInventory(this.agentId, 'Harvested Crops', { count: harvestedCount });
      return true;
    }
    return false;
  }

  async cookFood(radius = 10) {
    const rawFoods = this.getRawFoodInInventory();
    if (rawFoods.length === 0) return false;

    let furnaceBlock = null;
    const pos = this.bot.entity.position.floored();
    for (let x = -radius; x <= radius; x++) {
      for (let z = -radius; z <= radius; z++) {
        for (let y = -2; y <= 2; y++) {
          const b = this.bot.blockAt(pos.offset(x, y, z));
          if (b && (b.name === 'furnace' || b.name === 'smoker')) {
            furnaceBlock = b;
            break;
          }
        }
        if (furnaceBlock) break;
      }
      if (furnaceBlock) break;
    }

    if (!furnaceBlock) return false;

    const raw = rawFoods[0];
    const fuel = this.bot.inventory?.items().find(i => i.name === 'coal' || i.name === 'charcoal' || i.name.includes('plank') || i.name.includes('log'));
    if (!fuel) return false;

    try {
      await this.movement.goto(furnaceBlock.position.x, furnaceBlock.position.y, furnaceBlock.position.z, 2);
      const furnace = await this.bot.openFurnace(furnaceBlock);
      await furnace.putInput(raw.type, null, Math.min(raw.count, 8));
      await furnace.putFuel(fuel.type, null, Math.min(fuel.count, 2));
      logger.info('Farmer', `Cooking ${raw.name} using ${fuel.name} in furnace at ${furnaceBlock.position}`);
      detailedLogger.logInventory(this.agentId, 'Started Cooking Food', { food: raw.name, fuel: fuel.name });
      furnace.close();
      return true;
    } catch (err) {
      logger.warn('Farmer', `Failed to cook food: ${err.message}`);
      return false;
    }
  }
}

module.exports = FarmerSkill;
