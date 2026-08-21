const Vec3 = require('vec3');

class Senses {
  constructor(bot) {
    this.bot = bot;
  }

  // --- Entity & Mob Senses ---

  getNearbyMobs(maxDistance = 16) {
    if (!this.bot.entity) return [];
    return Object.values(this.bot.entities).filter(entity => {
      if (!entity || entity === this.bot.entity) return false;
      if (entity.type !== 'mob' && entity.type !== 'hostile') return false;
      return this.bot.entity.position.distanceTo(entity.position) <= maxDistance;
    });
  }

  getNearbyHostileMobs(maxDistance = 16) {
    const hostileTypes = ['zombie', 'skeleton', 'creeper', 'spider', 'enderman', 'witch', 'drowned', 'husk', 'stray', 'phantom', 'warden', 'pillager', 'ravager'];
    return this.getNearbyMobs(maxDistance).filter(entity => {
      const name = entity.name ? entity.name.toLowerCase() : '';
      return hostileTypes.some(h => name.includes(h));
    });
  }

  getNearbyPassiveMobs(maxDistance = 16) {
    const passiveTypes = ['cow', 'pig', 'sheep', 'chicken', 'horse', 'donkey', 'rabbit', 'villager', 'cat', 'wolf'];
    return this.getNearbyMobs(maxDistance).filter(entity => {
      const name = entity.name ? entity.name.toLowerCase() : '';
      return passiveTypes.some(p => name.includes(p));
    });
  }

  getNearbyPlayers(maxDistance = 32) {
    if (!this.bot.entity) return [];
    return Object.values(this.bot.players)
      .filter(p => p.username !== this.bot.username && p.entity)
      .filter(p => this.bot.entity.position.distanceTo(p.entity.position) <= maxDistance);
  }

  getNearbyItems(maxDistance = 16) {
    if (!this.bot.entity) return [];
    return Object.values(this.bot.entities).filter(entity => {
      if (!entity || entity.type !== 'object' && entity.name !== 'item') return false;
      return this.bot.entity.position.distanceTo(entity.position) <= maxDistance;
    });
  }

  // --- Block & Environmental Senses ---

  getNearbyBlock(blockName, maxDistance = 16) {
    if (!this.bot.entity) return null;
    const blocks = this.bot.findBlocks({
      matching: (block) => block && block.name.includes(blockName),
      maxDistance: maxDistance,
      count: 1
    });
    return blocks.length > 0 ? this.bot.blockAt(blocks[0]) : null;
  }

  getNearbyBlocks(blockName, maxDistance = 16, count = 5) {
    if (!this.bot.entity) return [];
    const blockPositions = this.bot.findBlocks({
      matching: (block) => block && block.name.includes(blockName),
      maxDistance: maxDistance,
      count: count
    });
    return blockPositions.map(pos => this.bot.blockAt(pos));
  }

  getNearbyBed(maxDistance = 16) {
    return this.getNearbyBlock('bed', maxDistance);
  }

  getNearbyChests(maxDistance = 16) {
    return this.getNearbyBlocks('chest', maxDistance, 5);
  }

  getNearbyFurnaces(maxDistance = 16) {
    return this.getNearbyBlocks('furnace', maxDistance, 5);
  }

  getNearbyOres(maxDistance = 16) {
    const oreNames = ['coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore', 'copper_ore', 'redstone_ore', 'lapis_ore', 'deepslate_iron_ore', 'deepslate_diamond_ore'];
    if (!this.bot.entity) return [];
    const blockPositions = this.bot.findBlocks({
      matching: (block) => block && oreNames.some(ore => block.name.includes(ore)),
      maxDistance: maxDistance,
      count: 10
    });
    return blockPositions.map(pos => this.bot.blockAt(pos));
  }

  getNearbyTrees(maxDistance = 16) {
    return this.getNearbyBlocks('log', maxDistance, 5);
  }

  getNearbyWater(maxDistance = 16) {
    return this.getNearbyBlock('water', maxDistance);
  }

  getNearbyLava(maxDistance = 16) {
    return this.getNearbyBlock('lava', maxDistance);
  }

  // --- World State & Atmosphere ---

  isNight() {
    return this.bot.time && (this.bot.time.timeOfDay >= 13000 && this.bot.time.timeOfDay <= 23000);
  }

  getTimeOfDay() {
    if (!this.bot.time) return 'day';
    const tod = this.bot.time.timeOfDay;
    if (tod >= 0 && tod < 6000) return 'morning';
    if (tod >= 6000 && tod < 12000) return 'afternoon';
    if (tod >= 12000 && tod < 13000) return 'sunset';
    if (tod >= 13000 && tod < 22000) return 'night';
    return 'sunrise';
  }

  getLightLevel() {
    if (!this.bot.entity) return 15;
    const block = this.bot.blockAt(this.bot.entity.position);
    return block ? block.light : 15;
  }

  getBiome() {
    if (!this.bot.entity) return 'unknown';
    const block = this.bot.blockAt(this.bot.entity.position);
    return block && block.biome ? block.biome.name : 'plains';
  }

  isRaining() {
    return this.bot.isRaining || false;
  }

  // --- Inventory & Physical State ---

  getInventoryFood() {
    if (!this.bot.inventory) return [];
    const foodNames = ['bread', 'cooked_beef', 'cooked_porkchop', 'cooked_chicken', 'apple', 'carrot', 'baked_potato', 'cooked_mutton', 'cooked_salmon', 'cooked_cod', 'golden_apple'];
    return this.bot.inventory.items().filter(item => foodNames.includes(item.name));
  }

  getInventoryTools() {
    if (!this.bot.inventory) return [];
    const toolKeywords = ['pickaxe', 'axe', 'shovel', 'sword', 'hoe'];
    return this.bot.inventory.items().filter(item => toolKeywords.some(kw => item.name.includes(kw)));
  }

  getEquipmentSummary() {
    const slots = this.bot.inventory ? this.bot.inventory.slots : [];
    return {
      helmet: this.bot.inventory ? this.bot.inventory.slots[5]?.name || null : null,
      chestplate: this.bot.inventory ? this.bot.inventory.slots[6]?.name || null : null,
      leggings: this.bot.inventory ? this.bot.inventory.slots[7]?.name || null : null,
      boots: this.bot.inventory ? this.bot.inventory.slots[8]?.name || null : null,
      mainHand: this.bot.heldItem?.name || null
    };
  }

  canSeeEntity(entity) {
    if (!this.bot.entity || !entity) return false;
    return this.bot.canSeeEntity(entity);
  }
}

module.exports = Senses;
