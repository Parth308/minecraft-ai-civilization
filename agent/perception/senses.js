const Vec3 = require('vec3');

class Senses {
  constructor(bot) {
    this.bot = bot;
  }

  // ─── Entity & Mob Senses ─────────────────────────────────────────────────────

  getNearbyMobs(maxDistance = 16) {
    if (!this.bot.entity) return [];
    return Object.values(this.bot.entities).filter(entity => {
      if (!entity || entity === this.bot.entity) return false;
      if (entity.type !== 'mob') return false;
      return this.bot.entity.position.distanceTo(entity.position) <= maxDistance;
    });
  }

  getNearbyHostileMobs(maxDistance = 16) {
    const hostileTypes = [
      'zombie', 'skeleton', 'creeper', 'spider', 'cave_spider', 'enderman',
      'witch', 'drowned', 'husk', 'stray', 'phantom', 'warden', 'pillager',
      'ravager', 'vindicator', 'evoker', 'blaze', 'ghast', 'magma_cube',
      'slime', 'silverfish', 'elder_guardian', 'guardian', 'shulker',
      'zombified_piglin', 'piglin_brute', 'hoglin', 'zoglin', 'endermite'
    ];
    return this.getNearbyMobs(maxDistance).filter(entity => {
      const name = entity.name ? entity.name.toLowerCase() : '';
      return hostileTypes.some(h => name.includes(h));
    });
  }

  getNearbyPassiveMobs(maxDistance = 16) {
    const passiveTypes = [
      'cow', 'pig', 'sheep', 'chicken', 'horse', 'donkey', 'mule',
      'rabbit', 'villager', 'cat', 'wolf', 'fox', 'parrot', 'turtle',
      'axolotl', 'goat', 'frog', 'allay', 'strider', 'mooshroom'
    ];
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

  // Dropped item entities on the ground (e.g. to pick up)
  getNearbyItems(maxDistance = 16) {
    if (!this.bot.entity) return [];
    return Object.values(this.bot.entities).filter(entity => {
      if (!entity || entity === this.bot.entity) return false;
      // Mineflayer marks dropped items as type 'object' with entityType name containing 'item'
      const isDroppedItem = entity.objectType === 'Item' || entity.name === 'item' || (entity.type === 'object' && entity.objectType === 'Item');
      if (!isDroppedItem) return false;
      return this.bot.entity.position.distanceTo(entity.position) <= maxDistance;
    });
  }

  // Detect incoming projectiles (arrows, fireballs) within radius
  getNearbyProjectiles(maxDistance = 12) {
    if (!this.bot.entity) return [];
    const projectileTypes = ['arrow', 'spectral_arrow', 'fireball', 'small_fireball', 'snowball', 'egg', 'trident', 'wither_skull'];
    return Object.values(this.bot.entities).filter(entity => {
      if (!entity || entity === this.bot.entity) return false;
      const name = (entity.name || entity.objectType || '').toLowerCase();
      if (!projectileTypes.some(p => name.includes(p))) return false;
      return this.bot.entity.position.distanceTo(entity.position) <= maxDistance;
    });
  }

  // ─── Block & Environmental Senses ────────────────────────────────────────────

  getNearbyBlock(blockName, maxDistance = 16) {
    if (!this.bot.entity) return null;
    const blocks = this.bot.findBlocks({
      matching: (block) => block && block.name.includes(blockName),
      maxDistance,
      count: 1
    });
    return blocks.length > 0 ? this.bot.blockAt(blocks[0]) : null;
  }

  getNearbyBlocks(blockName, maxDistance = 16, count = 5) {
    if (!this.bot.entity) return [];
    const blockPositions = this.bot.findBlocks({
      matching: (block) => block && block.name.includes(blockName),
      maxDistance,
      count
    });
    return blockPositions.map(pos => this.bot.blockAt(pos)).filter(Boolean);
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

  getNearbyCraftingTables(maxDistance = 8) {
    return this.getNearbyBlocks('crafting_table', maxDistance, 3);
  }

  getNearbyOres(maxDistance = 16) {
    const oreKeywords = ['coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore', 'copper_ore', 'redstone_ore', 'lapis_ore', 'emerald_ore', 'nether_quartz_ore', 'ancient_debris'];
    if (!this.bot.entity) return [];
    const blockPositions = this.bot.findBlocks({
      matching: (block) => block && oreKeywords.some(ore => block.name.includes(ore)),
      maxDistance,
      count: 10
    });
    return blockPositions.map(pos => this.bot.blockAt(pos)).filter(Boolean);
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

  // ─── World State & Atmosphere ────────────────────────────────────────────────

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

  // ─── Physical State Checks ───────────────────────────────────────────────────

  isInWater() {
    return this.bot.entity ? (this.bot.entity.isInWater || false) : false;
  }

  isOnFire() {
    return this.bot.entity ? (this.bot.entity.onFire || false) : false;
  }

  isUnderground() {
    if (!this.bot.entity) return false;
    return this.bot.entity.position.y < 60;
  }

  isFalling() {
    if (!this.bot.entity) return false;
    return this.bot.entity.velocity.y < -0.1;
  }

  // ─── Inventory & Equipment ───────────────────────────────────────────────────

  getInventoryFood() {
    if (!this.bot.inventory) return [];
    const foodNames = [
      'bread', 'cooked_beef', 'cooked_porkchop', 'cooked_chicken', 'apple',
      'carrot', 'baked_potato', 'cooked_mutton', 'cooked_salmon', 'cooked_cod',
      'golden_apple', 'enchanted_golden_apple', 'golden_carrot', 'mushroom_stew',
      'rabbit_stew', 'pumpkin_pie', 'melon_slice', 'sweet_berries', 'chorus_fruit'
    ];
    return this.bot.inventory.items().filter(item => foodNames.includes(item.name));
  }

  getInventoryTools() {
    if (!this.bot.inventory) return [];
    const toolKeywords = ['pickaxe', 'axe', 'shovel', 'sword', 'hoe', 'bow', 'trident', 'crossbow'];
    return this.bot.inventory.items().filter(item => toolKeywords.some(kw => item.name.includes(kw)));
  }

  hasItem(itemName) {
    if (!this.bot.inventory) return false;
    return !!this.bot.inventory.items().find(i => i.name === itemName);
  }

  countItem(itemName) {
    if (!this.bot.inventory) return 0;
    return this.bot.inventory.items()
      .filter(i => i.name === itemName)
      .reduce((sum, i) => sum + i.count, 0);
  }

  getEquipmentSummary() {
    return {
      helmet: this.bot.inventory?.slots[5]?.name || null,
      chestplate: this.bot.inventory?.slots[6]?.name || null,
      leggings: this.bot.inventory?.slots[7]?.name || null,
      boots: this.bot.inventory?.slots[8]?.name || null,
      mainHand: this.bot.heldItem?.name || null,
      offHand: this.bot.inventory?.slots[45]?.name || null
    };
  }

  // ─── Line of Sight ───────────────────────────────────────────────────────────

  canSeeEntity(entity) {
    if (!this.bot.entity || !entity) return false;
    try {
      return this.bot.canSeeEntity(entity);
    } catch (err) {
      return false;
    }
  }
}

module.exports = Senses;
