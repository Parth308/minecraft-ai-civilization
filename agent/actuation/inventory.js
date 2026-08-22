const Vec3 = require('vec3');
const logger = require('../../shared/logger');
const detailedLogger = require('../../shared/detailedLogger');

class InventoryActuator {
  constructor(bot) {
    this.bot = bot;
  }

  get agentId() {
    return this.bot.username || 'UnknownAgent';
  }

  // --- Proximity Navigation Helper ---

  async _navigateWithin(pos, range = 3, timeoutMs = 12000) {
    const botPos = this.bot.entity?.position;
    if (!botPos || botPos.distanceTo(pos) <= range) return true;
    return new Promise((resolve) => {
      const { goals } = require('mineflayer-pathfinder');
      this.bot.pathfinder.setGoal(new goals.GoalNear(pos.x, pos.y, pos.z, range));
      const onReach = () => {
        clearTimeout(timer);
        this.bot.removeListener('goal_reached', onReach);
        resolve(true);
      };
      const timer = setTimeout(() => {
        this.bot.pathfinder.setGoal(null);
        this.bot.removeListener('goal_reached', onReach);
        resolve(false);
      }, timeoutMs);
      this.bot.once('goal_reached', onReach);
    });
  }

  // --- Food & Consumption ---

  getFoodCategories() {
    return {
      comfort: ['cooked_beef', 'cooked_porkchop', 'cooked_mutton', 'cooked_chicken', 'cooked_salmon', 'cooked_cod', 'bread', 'baked_potato', 'golden_apple'],
      emergency: ['apple', 'carrot', 'sweet_berries', 'raw_beef', 'raw_porkchop', 'raw_mutton', 'raw_chicken'],
      desperation: ['rotten_flesh', 'spider_eye']
    };
  }

  findBestFood(health = 20, hunger = 100) {
    if (!this.bot.inventory) return null;
    const items = this.bot.inventory.items();
    const categories = this.getFoodCategories();

    const comfortFood = items.find(i => categories.comfort.includes(i.name));
    if (comfortFood) return { item: comfortFood, tier: 'comfort' };

    if (hunger <= 40 || health < 10) {
      const emergencyFood = items.find(i => categories.emergency.includes(i.name));
      if (emergencyFood) return { item: emergencyFood, tier: 'emergency' };
    }

    if (health <= 4 && hunger <= 20) {
      const desperationFood = items.find(i => categories.desperation.includes(i.name));
      if (desperationFood) return { item: desperationFood, tier: 'desperation' };
    }

    return null;
  }

  async eatFood(health = 20, hunger = 100) {
    if (!this.bot.inventory) return false;
    const selected = this.findBestFood(health, hunger);
    if (!selected) return false;

    try {
      logger.info('Actuation:Inventory', `[${selected.tier.toUpperCase()} EAT] Consuming ${selected.item.name}...`);
      detailedLogger.logInventory(this.agentId, `Consumed food: ${selected.item.name}`, { tier: selected.tier, health, hunger });
      await this.bot.equip(selected.item, 'hand');
      await this.bot.consume();
      return true;
    } catch (err) {
      logger.error('Actuation:Inventory', `Failed to eat food: ${err.message}`);
      return false;
    }
  }

  // --- Mining, Digging & Tool Selection ---

  // Tool tiers in descending order of quality — we always pick the best available
  // that meets the minimum tier required by the block. Using a lower tier than required
  // causes the block to break WITHOUT dropping anything (the silent failure).
  static get TOOL_TIERS() {
    return ['netherite', 'diamond', 'iron', 'stone', 'golden', 'wooden'];
  }

  // Returns the MINIMUM pickaxe tier needed for a block to drop items.
  // If we can't meet the minimum, we skip equipping to avoid a silent no-drop.
  _minPickaxeTierFor(blockName) {
    // Needs diamond+ pickaxe (or no drops at all)
    if (blockName.includes('obsidian') || blockName.includes('ancient_debris') || blockName.includes('crying_obsidian')) {
      return 'diamond';
    }
    // Needs iron+ pickaxe
    if (
      blockName.includes('gold_ore') || blockName.includes('nether_gold_ore') ||
      blockName.includes('redstone_ore') || blockName.includes('lapis_ore') ||
      blockName.includes('diamond_ore') || blockName.includes('emerald_ore') ||
      blockName.includes('nether_quartz_ore')
    ) {
      return 'iron';
    }
    // Needs stone+ pickaxe
    if (blockName.includes('iron_ore') || blockName.includes('copper_ore')) {
      return 'stone';
    }
    // Any pickaxe works (coal, basic stone blocks, cobblestone, deepslate)
    return 'wooden';
  }

  _pickBestTool(toolType, minTier = 'wooden') {
    if (!this.bot.inventory) return null;
    const items = this.bot.inventory.items();
    const tiers = InventoryActuator.TOOL_TIERS;
    const minIdx = tiers.indexOf(minTier);

    // Find highest-tier tool that is at or above the minimum tier
    for (const tier of tiers) {
      if (tiers.indexOf(tier) > minIdx) continue; // below minimum — skip
      if (toolType === 'shears') {
        const found = items.find(i => i.name === 'shears');
        if (found) return found;
        return null;
      }
      const found = items.find(i => i.name === `${tier}_${toolType}`);
      if (found) return found;
    }
    return null;
  }

  async equipOptimalTool(block) {
    if (!this.bot.inventory || !block) return false;
    const blockName = block.name.toLowerCase();

    // ── Determine tool type and minimum tier ───────────────────────────────
    let toolType = null;
    let minTier = 'wooden';

    if (
      blockName.includes('log') || blockName.includes('wood') ||
      blockName.includes('plank') || blockName.includes('bamboo') ||
      blockName.includes('stem') // mushroom stems, warped/crimson stems
    ) {
      toolType = 'axe';
    } else if (
      blockName.includes('obsidian') || blockName.includes('ancient_debris')
    ) {
      toolType = 'pickaxe';
      minTier = 'diamond';
    } else if (
      blockName.includes('gold_ore') || blockName.includes('nether_gold_ore') ||
      blockName.includes('redstone_ore') || blockName.includes('lapis_ore') ||
      blockName.includes('diamond_ore') || blockName.includes('emerald_ore') ||
      blockName.includes('nether_quartz_ore')
    ) {
      toolType = 'pickaxe';
      minTier = 'iron';
    } else if (
      blockName.includes('iron_ore') || blockName.includes('copper_ore')
    ) {
      toolType = 'pickaxe';
      minTier = 'stone';
    } else if (
      blockName.includes('stone') || blockName.includes('ore') ||
      blockName.includes('deepslate') || blockName.includes('cobble') ||
      blockName.includes('basalt') || blockName.includes('blackstone') ||
      blockName.includes('netherrack') || blockName.includes('end_stone') ||
      blockName.includes('terracotta') || blockName.includes('concrete')
    ) {
      toolType = 'pickaxe';
    } else if (
      blockName.includes('dirt') || blockName.includes('sand') ||
      blockName.includes('gravel') || blockName.includes('clay') ||
      blockName.includes('soul_sand') || blockName.includes('soul_soil') ||
      blockName.includes('snow') || blockName.includes('mycelium') ||
      blockName.includes('podzol') || blockName.includes('grass_block')
    ) {
      toolType = 'shovel';
    } else if (
      blockName.includes('leaves') || blockName.includes('wool') ||
      blockName.includes('cobweb') // shears fastest on cobweb
    ) {
      toolType = 'shears';
    } else if (
      blockName.includes('farmland') || blockName.includes('dirt_path')
    ) {
      toolType = 'hoe'; // hoe is fastest for farmland
    } else if (
      blockName.includes('melon') || blockName.includes('pumpkin')
    ) {
      toolType = 'axe'; // axe is fastest for these
    } else if (blockName.includes('cobweb')) {
      toolType = 'sword'; // sword breaks cobweb instantly
    }

    if (!toolType) return false; // no special tool — use fist / held item

    // ── Pick best available tool meeting minimum tier ──────────────────────
    const tool = toolType === 'shears'
      ? this._pickBestTool('shears')
      : this._pickBestTool(toolType, minTier);

    if (!tool) {
      // We don't have a tool of sufficient tier — warn but don't equip wrong one
      if (minTier !== 'wooden') {
        logger.warn('Actuation:Inventory', `Cannot mine ${blockName}: need ${minTier}+ ${toolType} but none in inventory. Block will drop nothing.`);
      }
      return false;
    }

    try {
      await this.bot.equip(tool, 'hand');
      detailedLogger.logInventory(this.agentId, `Equipped ${tool.name} (tier: ${minTier}+) for ${blockName}`);
      return true;
    } catch (err) {
      logger.error('Actuation:Inventory', `Tool equip failed: ${err.message}`);
      return false;
    }
  }

  async digBlock(block) {
    if (!block || !block.position || block.name === 'air' || block.name === 'water' || block.name === 'lava' || block.name === 'bedrock') {
      return false;
    }

    try {
      // 1. Navigate within reach (3 blocks) before attempting to dig
      await this._navigateWithin(block.position, 3);

      // Re-fetch latest block state at the position (it might have been mined already or changed)
      const target = this.bot.blockAt(block.position);
      if (!target || target.name === 'air') return true; // already mined

      if (!this.bot.canDigBlock(target)) {
        logger.warn('Actuation:Inventory', `Block is not diggable: ${target.name} at ${target.position}`);
        return false;
      }

      await this.equipOptimalTool(target);
      // Look at the block center before swinging
      await this.bot.lookAt(target.position.offset(0.5, 0.5, 0.5), true);
      await this.bot.dig(target);
      detailedLogger.logInventory(this.agentId, `Mined block successfully: ${target.name}`, { position: target.position });

      // Vacuum pickup: Step directly onto the mined block / nearby dropped item
      try {
        await this._navigateWithin(target.position, 1);
        const nearbyDropped = Object.values(this.bot.entities).find(e => 
          e && e.name === 'item' && e.position && e.position.distanceTo(this.bot.entity.position) < 4
        );
        if (nearbyDropped) {
          await this._navigateWithin(nearbyDropped.position, 1);
        }
      } catch (pickupErr) {
        // Non-blocking navigation
      }

      return true;
    } catch (err) {
      logger.error('Actuation:Inventory', `Mining block failed: ${err.message}`);
      return false;
    }
  }

  // --- Building & Block Placement ---

  async placeBlock(blockName, referenceBlock, faceVector = new Vec3(0, 1, 0)) {
    if (!this.bot.inventory || !referenceBlock) return false;
    const blockItem = this.bot.inventory.items().find(i => i.name === blockName);

    if (!blockItem) {
      logger.warn('Actuation:Inventory', `No '${blockName}' in inventory to place.`);
      return false;
    }

    try {
      // Navigate within reach before placing
      await this._navigateWithin(referenceBlock.position, 3);

      // Look at the exact face center before placing
      const lookTarget = referenceBlock.position.offset(
        faceVector.x * 0.5 + 0.5,
        faceVector.y * 0.5 + 0.5,
        faceVector.z * 0.5 + 0.5
      );
      await this.bot.lookAt(lookTarget, true);

      await this.bot.equip(blockItem, 'hand');
      await this.bot.placeBlock(referenceBlock, faceVector);
      detailedLogger.logInventory(this.agentId, `Placed block: ${blockName}`, { against: referenceBlock.name, pos: referenceBlock.position, face: faceVector });
      logger.info('Actuation:Inventory', `Placed ${blockName} against ${referenceBlock.name}`);
      return true;
    } catch (err) {
      logger.error('Actuation:Inventory', `Block placement failed: ${err.message}`);
      return false;
    }
  }

  // --- Item Dropping & Trading Toss ---

  async dropItem(itemName, count = 1) {
    if (!this.bot.inventory) return false;
    const item = this.bot.inventory.items().find(i => i.name === itemName);
    if (!item) return false;

    try {
      const actualCount = Math.min(count, item.count);
      await this.bot.toss(item.type, null, actualCount);
      detailedLogger.logInventory(this.agentId, `Dropped item: ${actualCount}x ${itemName}`);
      logger.info('Actuation:Inventory', `Dropped ${actualCount}x ${itemName}`);
      return true;
    } catch (err) {
      logger.error('Actuation:Inventory', `Drop item failed: ${err.message}`);
      return false;
    }
  }

  // Look at player and drop item toward them (item drops at bot feet, player walks to pick it up)
  async tossItemToPlayer(itemName, playerEntity, count = 1) {
    if (!playerEntity || !playerEntity.position) return false;
    try {
      // Face the player before tossing for realism
      await this.bot.lookAt(playerEntity.position.offset(0, playerEntity.height || 1.6, 0), true);
      detailedLogger.logInventory(this.agentId, `Tossed ${count}x ${itemName} to player: ${playerEntity.username || playerEntity.name}`);
    } catch (err) {
      // Continue even if look fails
    }
    return this.dropItem(itemName, count);
  }

  // --- Chest & Container Transfers ---

  async openChestAndDeposit(chestBlock, itemNames = []) {
    if (!chestBlock) return false;
    try {
      // Navigate close to chest before opening
      await this._navigateWithin(chestBlock.position, 3);
      await this.bot.lookAt(chestBlock.position.offset(0.5, 0.5, 0.5), true);

      const chest = await this.bot.openChest(chestBlock);
      for (const itemName of itemNames) {
        const item = this.bot.inventory.items().find(i => i.name === itemName);
        if (item) {
          const amount = item.count;
          await chest.deposit(item.type, null, amount);
          detailedLogger.logInventory(this.agentId, `Deposited ${amount}x ${itemName} into chest`, { pos: chestBlock.position });
          logger.info('Actuation:Inventory', `Deposited ${amount}x ${itemName} into chest.`);
        }
      }
      chest.close();
      return true;
    } catch (err) {
      logger.error('Actuation:Inventory', `Chest deposit failed: ${err.message}`);
      return false;
    }
  }

  async openChestAndWithdraw(chestBlock, itemNames = []) {
    if (!chestBlock) return false;
    try {
      // Navigate close to chest before opening
      await this._navigateWithin(chestBlock.position, 3);
      await this.bot.lookAt(chestBlock.position.offset(0.5, 0.5, 0.5), true);

      const chest = await this.bot.openChest(chestBlock);
      for (const itemName of itemNames) {
        const item = chest.containerItems().find(i => i.name === itemName);
        if (item) {
          await chest.withdraw(item.type, null, item.count);
          detailedLogger.logInventory(this.agentId, `Withdrew ${item.count}x ${itemName} from chest`, { pos: chestBlock.position });
          logger.info('Actuation:Inventory', `Withdrew ${item.count}x ${itemName} from chest.`);
        }
      }
      chest.close();
      return true;
    } catch (err) {
      logger.error('Actuation:Inventory', `Chest withdraw failed: ${err.message}`);
      return false;
    }
  }

  // --- Crafting ---

  async _ensureCraftingTable() {
    if (!this.bot.entity) return null;

    // 1. Check if a crafting table already exists nearby
    let table = this.bot.findBlock({
      matching: this.bot.registry.blocksByName['crafting_table']?.id,
      maxDistance: 6
    });
    if (table) return { table, newlyPlaced: false };

    // 2. Do we have a crafting table in inventory? If not, do we have planks to make one (2×2)?
    let tableInInv = this.bot.inventory?.items().find(i => i.name === 'crafting_table');
    if (!tableInInv) {
      const plankItem = this.bot.inventory?.items().find(i => i.name.endsWith('_planks'));
      if (plankItem && plankItem.count >= 4) {
        const tableItem = this.bot.registry.itemsByName['crafting_table'];
        const tableRecipes = this.bot.recipesFor(tableItem.id, null, 1, null);
        if (tableRecipes && tableRecipes.length > 0) {
          logger.info('Actuation:Inventory', 'Refining planks into crafting_table in 2×2 grid first...');
          try {
            await this.bot.craft(tableRecipes[0], 1, null);
            tableInInv = this.bot.inventory?.items().find(i => i.name === 'crafting_table');
          } catch (e) {
            logger.debug('Actuation:Inventory', `Failed to craft crafting table in 2×2: ${e.message}`);
          }
        }
      }
    }

    if (!tableInInv) {
      logger.warn('Actuation:Inventory', 'No crafting_table or materials in inventory to place for 3×3 recipe');
      return null;
    }

    // 3. Smart Placement & Alcove Excavation (Handles digging straight down in 1×1 / 1×2 tunnels)
    const botPos = this.bot.entity.position.floored();
    const directions = [
      new Vec3(1, 0, 0),
      new Vec3(-1, 0, 0),
      new Vec3(0, 0, 1),
      new Vec3(0, 0, -1)
    ];

    for (const dir of directions) {
      const waistPos = botPos.plus(dir);
      const floorPos = waistPos.offset(0, -1, 0);

      let waistBlock = this.bot.blockAt(waistPos);
      let floorBlock = this.bot.blockAt(floorPos);

      // If waist space is blocked by solid stone/dirt (e.g. dug straight down), carve out front block!
      if (waistBlock && waistBlock.name !== 'air' && waistBlock.name !== 'water' && waistBlock.name !== 'lava') {
        if (this.bot.canDigBlock(waistBlock)) {
          logger.info('Actuation:Inventory', `Carving out front block ${waistBlock.name} at ${waistPos} to create crafting table space...`);
          await this.digBlock(waistBlock);
          waistBlock = this.bot.blockAt(waistPos);
          floorBlock = this.bot.blockAt(floorPos);
        }
      }

      // If space is now clear air:
      if (waistBlock && waistBlock.name === 'air') {
        // Case A: Floor is solid -> place on top of floor facing up
        if (floorBlock && floorBlock.name !== 'air' && floorBlock.name !== 'water' && floorBlock.name !== 'lava') {
          logger.info('Actuation:Inventory', `Placing crafting table on floor at ${floorPos} facing UP...`);
          const placed = await this.placeBlock('crafting_table', floorBlock, new Vec3(0, 1, 0));
          if (placed) {
            table = this.bot.findBlock({ matching: this.bot.registry.blocksByName['crafting_table']?.id, maxDistance: 4 });
            if (table) return { table, newlyPlaced: true };
          }
        }

        // Case B: Floor not solid -> place against adjacent solid wall face
        const sideBlocks = [
          this.bot.blockAt(waistPos.offset(1, 0, 0)),
          this.bot.blockAt(waistPos.offset(-1, 0, 0)),
          this.bot.blockAt(waistPos.offset(0, 0, 1)),
          this.bot.blockAt(waistPos.offset(0, 0, -1))
        ].filter(b => b && b.name !== 'air' && b.name !== 'water' && b.name !== 'lava');

        if (sideBlocks.length > 0) {
          const side = sideBlocks[0];
          const face = waistPos.minus(side.position);
          logger.info('Actuation:Inventory', `Placing crafting table against side wall ${side.name} at ${side.position}...`);
          const placed = await this.placeBlock('crafting_table', side, face);
          if (placed) {
            table = this.bot.findBlock({ matching: this.bot.registry.blocksByName['crafting_table']?.id, maxDistance: 4 });
            if (table) return { table, newlyPlaced: true };
          }
        }
      }
    }

    return null;
  }

  async craftItem(itemName, count = 1) {
    const item = this.bot.registry.itemsByName[itemName];
    if (!item) {
      logger.warn('Actuation:Inventory', `Unknown item to craft: ${itemName}`);
      return false;
    }

    // 1. Check if item can be crafted in 2×2 inventory grid
    let recipes = this.bot.recipesFor(item.id, null, count, null);
    let craftingTable = null;
    let newlyPlaced = false;

    // 2. If 3×3 recipe is required, find or place a crafting table with smart alcove support
    if (!recipes || recipes.length === 0) {
      const tableInfo = await this._ensureCraftingTable();
      if (tableInfo) {
        craftingTable = tableInfo.table;
        newlyPlaced = tableInfo.newlyPlaced;
      }

      if (craftingTable) {
        try {
          await this._navigateWithin(craftingTable.position, 3);
          await this.bot.lookAt(craftingTable.position.offset(0.5, 0.5, 0.5), true);
        } catch (err) {
          logger.debug('Actuation:Inventory', `Could not reach crafting table: ${err.message}`);
        }
      }

      // Re-query recipes with crafting table
      recipes = this.bot.recipesFor(item.id, null, count, craftingTable);
    }

    if (!recipes || recipes.length === 0) {
      logger.warn('Actuation:Inventory', `No recipe available for: ${itemName} (Table: ${!!craftingTable})`);
      return false;
    }

    try {
      logger.info('Actuation:Inventory', `Crafting ${count}x ${itemName}${craftingTable ? ' at crafting table' : ' (2x2)'}...`);
      await this.bot.craft(recipes[0], count, craftingTable);
      detailedLogger.logInventory(this.agentId, `Crafted item: ${count}x ${itemName}`, { usedTable: !!craftingTable });

      // Auto-recover/mine placed crafting table back into backpack so bot never leaves it behind
      if (newlyPlaced && craftingTable) {
        try {
          const tableBlock = this.bot.blockAt(craftingTable.position);
          if (tableBlock && tableBlock.name === 'crafting_table') {
            logger.info('Actuation:Inventory', 'Recovering crafting table back into inventory for mobile mining...');
            await this.digBlock(tableBlock);
          }
        } catch (recoverErr) {
          // non-blocking
        }
      }

      return true;
    } catch (err) {
      logger.error('Actuation:Inventory', `Crafting failed: ${err.message}`);
      return false;
    }
  }

  listInventory() {
    if (!this.bot.inventory) return [];
    return this.bot.inventory.items().map(i => ({
      name: i.name,
      displayName: i.displayName || i.name.replace(/_/g, ' '),
      count: i.count,
      slot: i.slot
    }));
  }
}

module.exports = InventoryActuator;
