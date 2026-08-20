class Senses {
  constructor(bot) {
    this.bot = bot;
  }

  getNearbyMobs(maxDistance = 16) {
    if (!this.bot.entity) return [];
    return Object.values(this.bot.entities).filter(entity => {
      if (!entity || entity === this.bot.entity) return false;
      if (entity.type !== 'mob' && entity.type !== 'hostile') return false;
      return this.bot.entity.position.distanceTo(entity.position) <= maxDistance;
    });
  }

  getNearbyHostileMobs(maxDistance = 16) {
    const hostileTypes = ['zombie', 'skeleton', 'creeper', 'spider', 'enderman', 'witch', 'drowned', 'husk', 'stray'];
    return this.getNearbyMobs(maxDistance).filter(entity => {
      const name = entity.name ? entity.name.toLowerCase() : '';
      return hostileTypes.some(h => name.includes(h));
    });
  }

  getNearbyPlayers(maxDistance = 32) {
    if (!this.bot.entity) return [];
    return Object.values(this.bot.players)
      .filter(p => p.username !== this.bot.username && p.entity)
      .filter(p => this.bot.entity.position.distanceTo(p.entity.position) <= maxDistance);
  }

  getNearbyBlock(blockName, maxDistance = 16) {
    if (!this.bot.entity) return null;
    const blocks = this.bot.findBlocks({
      matching: (block) => block && block.name.includes(blockName),
      maxDistance: maxDistance,
      count: 1
    });
    return blocks.length > 0 ? this.bot.blockAt(blocks[0]) : null;
  }

  getNearbyBed(maxDistance = 16) {
    return this.getNearbyBlock('bed', maxDistance);
  }

  isNight() {
    return this.bot.time && (this.bot.time.timeOfDay >= 13000 && this.bot.time.timeOfDay <= 23000);
  }

  getInventoryFood() {
    if (!this.bot.inventory) return [];
    const foodNames = ['bread', 'cooked_beef', 'cooked_porkchop', 'cooked_chicken', 'apple', 'carrot', 'baked_potato', 'cooked_mutton', 'cooked_salmon', 'cooked_cod'];
    return this.bot.inventory.items().filter(item => foodNames.includes(item.name));
  }
}

module.exports = Senses;
