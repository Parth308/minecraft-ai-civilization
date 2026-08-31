const Vec3 = require('vec3');

class Senses {
  constructor(bot) {
    this.bot = bot;
    this._blockCache = new Map();
    this._cacheLastPos = null;
  }

  _checkCacheMovement() {
    const pos = this.bot.entity?.position;
    if (!pos) return;
    if (!this._cacheLastPos) {
      this._cacheLastPos = { x: pos.x, y: pos.y, z: pos.z };
      return;
    }
    const dx = pos.x - this._cacheLastPos.x;
    const dy = pos.y - this._cacheLastPos.y;
    const dz = pos.z - this._cacheLastPos.z;
    if (dx * dx + dy * dy + dz * dz > 9) { // moved > 3 blocks
      this._blockCache.clear();
      this._cacheLastPos = { x: pos.x, y: pos.y, z: pos.z };
    }
  }

  _getCached(key, ttlMs, fetchFn) {
    this._checkCacheMovement();
    const now = Date.now();
    const cached = this._blockCache.get(key);
    if (cached && now < cached.expiry) {
      return cached.data;
    }
    const data = fetchFn();
    this._blockCache.set(key, { data, expiry: now + ttlMs });
    if (this._blockCache.size > 60) {
      for (const [k, v] of this._blockCache) {
        if (now >= v.expiry) this._blockCache.delete(k);
      }
    }
    return data;
  }

  clearBlockCache() {
    this._blockCache.clear();
  }

  // ─── Entity & Mob Senses ─────────────────────────────────────────────────────

  getNearbyMobs(maxDistance = 16) {
    if (!this.bot.entity || !this.bot.entities) return [];
    return Object.values(this.bot.entities).filter(entity => {
      if (!entity || entity === this.bot.entity) return false;
      if (entity.type !== 'mob') return false;
      return this.bot.entity.position.distanceTo(entity.position) <= maxDistance;
    });
  }

  getNearbyHostileMobs(maxDistance = 16) {
    // Naturally aggressive hostiles that attack on sight
    const hostileTypes = [
      'zombie', 'skeleton', 'creeper', 'witch', 'drowned', 'husk',
      'stray', 'phantom', 'warden', 'pillager', 'ravager', 'vindicator',
      'evoker', 'blaze', 'ghast', 'magma_cube', 'slime', 'silverfish',
      'elder_guardian', 'guardian', 'shulker', 'piglin_brute', 'hoglin',
      'zoglin', 'endermite', 'cave_spider'
    ];
    return this.getNearbyMobs(maxDistance).filter(entity => {
      const name = entity.name ? entity.name.toLowerCase() : '';
      return hostileTypes.some(h => name.includes(h));
    });
  }

  // Neutral mobs that only attack if provoked (Enderman, Zombified Piglin, Iron Golem, Wolf, Spider in daylight)
  getNearbyNeutralMobs(maxDistance = 16) {
    const neutralTypes = ['enderman', 'zombified_piglin', 'spider', 'iron_golem', 'piglin', 'llama', 'polar_bear', 'bee', 'dolphin'];
    return this.getNearbyMobs(maxDistance).filter(entity => {
      const name = entity.name ? entity.name.toLowerCase() : '';
      return neutralTypes.some(n => name.includes(n));
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
    if (!this.bot.entity || !this.bot.players) return [];
    return Object.values(this.bot.players)
      .filter(p => p.username !== this.bot.username && p.entity)
      .filter(p => this.bot.entity.position.distanceTo(p.entity.position) <= maxDistance);
  }

  // Dropped item entities on the ground (e.g. to pick up)
  getNearbyItems(maxDistance = 16) {
    if (!this.bot.entity || !this.bot.entities) return [];
    return Object.values(this.bot.entities).filter(entity => {
      if (!entity || entity === this.bot.entity) return false;
      const kind = String(entity.name || entity.displayName || '').toLowerCase();
      const isDroppedItem = kind === 'item';
      if (!isDroppedItem) return false;
      return this.bot.entity.position.distanceTo(entity.position) <= maxDistance;
    });
  }

  // Detect incoming projectiles (arrows, fireballs) within radius
  getNearbyProjectiles(maxDistance = 12) {
    if (!this.bot.entity || !this.bot.entities) return [];
    const projectileTypes = ['arrow', 'spectral_arrow', 'fireball', 'small_fireball', 'snowball', 'egg', 'trident', 'wither_skull'];
    return Object.values(this.bot.entities).filter(entity => {
      if (!entity || entity === this.bot.entity) return false;
      const name = (entity.name || entity.displayName || '').toLowerCase();
      if (!projectileTypes.some(p => name.includes(p))) return false;
      return this.bot.entity.position.distanceTo(entity.position) <= maxDistance;
    });
  }

  // Ranged-threat resolution: arrows in flight mean SOMEONE is shooting.
  // Nearest hostile within the extended band is the presumed source — this
  // lets FLEE see archers that outrun normal melee-proximity checks.
  getRangedThreat(maxDistance = 24) {
    if (this.getNearbyProjectiles(20).length === 0) return null;
    const hostiles = this.getNearbyHostileMobs(maxDistance);
    return hostiles.length > 0 ? hostiles[0] : null;
  }

  // Best-effort visual read of another player's worn armor. Mineflayer entity
  // metadata slot layout shifts between versions, so scan every metadata entry
  // for armor-piece item names rather than trusting fixed indices. Null means
  // "couldn't see" — never fabricate gear.
  getPlayerGearTier(username) {
    try {
      const entity = Object.values(this.bot.entities).find(e => e.username === username);
      if (!entity || !Array.isArray(entity.metadata)) return null;
      const gear = {};
      const seen = new Set();
      for (const slot of entity.metadata) {
        const itemId = slot?.value?.itemId;
        if (!itemId) continue;
        const itemName = this.bot.registry?.items?.[itemId]?.name || '';
        const piece = ['helmet', 'chestplate', 'leggings', 'boots'].find(p => itemName.includes(p));
        if (piece && !seen.has(piece)) {
          seen.add(piece);
          gear[piece] = itemName.replace(/_/g, ' ');
        }
      }
      return Object.keys(gear).length > 0 ? gear : null;
    } catch {
      return null;
    }
  }

  // ─── Block & Environmental Senses ────────────────────────────────────────────

  getNearbyBlock(blockName, maxDistance = 16) {
    if (!this.bot.entity) return null;
    const key = `block:${blockName}:${maxDistance}`;
    return this._getCached(key, 2500, () => {
      const blocks = this.bot.findBlocks({
        matching: (block) => block && block.name.includes(blockName),
        maxDistance,
        count: 1
      });
      return blocks.length > 0 ? this.bot.blockAt(blocks[0]) : null;
    });
  }

  getNearbyBlocks(blockName, maxDistance = 16, count = 5) {
    if (!this.bot.entity) return [];
    const key = `blocks:${blockName}:${maxDistance}:${count}`;
    return this._getCached(key, 2500, () => {
      const blockPositions = this.bot.findBlocks({
        matching: (block) => block && block.name.includes(blockName),
        maxDistance,
        count
      });
      return blockPositions.map(pos => this.bot.blockAt(pos)).filter(Boolean);
    });
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
    const key = `ores:${maxDistance}`;
    return this._getCached(key, 3000, () => {
      const blockPositions = this.bot.findBlocks({
        matching: (block) => block && oreKeywords.some(ore => block.name.includes(ore)),
        maxDistance,
        count: 10
      });
      return blockPositions.map(pos => this.bot.blockAt(pos)).filter(Boolean);
    });
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

  getNearbyHazards(maxDistance = 4, count = 8) {
    if (!this.bot.entity) return [];
    const key = `hazards:${maxDistance}:${count}`;
    return this._getCached(key, 2000, () => {
      const hazardKeywords = ['lava', 'fire', 'magma_block', 'cactus'];
      const positions = this.bot.findBlocks({
        matching: (block) => block && hazardKeywords.some(h => block.name.includes(h)),
        maxDistance,
        count
      });
      return positions.map(pos => this.bot.blockAt(pos)).filter(Boolean);
    });
  }

  hazardProximity(maxDistance = 3) {
    const botPos = this.bot.entity?.position;
    if (!botPos) return null;
    let nearest = null;
    for (const block of this.getNearbyHazards(maxDistance)) {
      const distance = botPos.distanceTo(block.position);
      if (!nearest || distance < nearest.distance) {
        nearest = { block, distance };
      }
    }
    return nearest;
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

  _matchesItemName(itemActualName, targetName) {
    if (itemActualName === targetName) return true;
    if (targetName === 'log') return itemActualName.endsWith('_log') || itemActualName.endsWith('_wood') || itemActualName.endsWith('_stem') || itemActualName === 'bamboo_block';
    if (targetName === 'planks') return itemActualName.endsWith('_planks') || itemActualName === 'bamboo_mosaic';
    if (targetName === 'ore') return itemActualName.endsWith('_ore');
    if (targetName === 'wool') return itemActualName.endsWith('_wool');
    if (targetName === 'boat') return itemActualName.endsWith('_boat') || itemActualName.endsWith('_raft');
    return false;
  }

  hasItem(itemName) {
    if (!this.bot.inventory) return false;
    return !!this.bot.inventory.items().find(i => this._matchesItemName(i.name, itemName));
  }

  countItem(itemName) {
    if (!this.bot.inventory) return 0;
    return this.bot.inventory.items()
      .filter(i => this._matchesItemName(i.name, itemName))
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
