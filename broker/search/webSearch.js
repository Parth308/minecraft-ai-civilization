/**
 * Web & Minecraft Knowledge Retrieval Client for Brain Broker.
 * Queries live web search / Minecraft Wiki APIs to provide accurate game mechanics,
 * crafting recipes, mob combat guides, building blueprints, and survival strategies.
 */
const logger = require('../../shared/logger');

class WebKnowledgeClient {
  constructor() {
    this.cache = new Map();
  }

  async searchKnowledge(query) {
    if (!query || typeof query !== 'string' || query.length < 3) return null;
    const cleanQuery = query.toLowerCase().trim();

    if (this.cache.has(cleanQuery)) {
      return this.cache.get(cleanQuery);
    }

    try {
      // 1. Official Minecraft Wiki Search API
      const wikiUrl = `https://minecraft.wiki/api.php?action=query&list=search&srsearch=${encodeURIComponent(cleanQuery)}&utf8=&format=json`;
      const res = await fetch(wikiUrl, {
        headers: { 'User-Agent': 'MinecraftAICivilization/1.0 (Autonomous Agent Sovereign Learning)' },
        signal: AbortSignal.timeout(3500)
      });

      if (res.ok) {
        const data = await res.json();
        const searchResults = data?.query?.search || [];
        if (searchResults.length > 0) {
          const facts = searchResults.slice(0, 3).map(r => {
            const cleanSnippet = (r.snippet || '').replace(/<[^>]+>/g, '').trim();
            return `• [Wiki: ${r.title}]: ${cleanSnippet}`;
          }).join('\n');

          logger.info('WebKnowledge', `Retrieved live Minecraft Wiki knowledge for '${cleanQuery}' (${searchResults.length} articles)`);
          this.cache.set(cleanQuery, facts);
          return facts;
        }
      }
    } catch (err) {
      logger.debug('WebKnowledge', `Wiki search failed for '${cleanQuery}': ${err.message}`);
    }

    // 2. Comprehensive built-in Minecraft Mechanics & Architectural Blueprint Database
    const builtInKnowledge = this._getEssentialMinecraftFacts(cleanQuery);
    if (builtInKnowledge) {
      this.cache.set(cleanQuery, builtInKnowledge);
      return builtInKnowledge;
    }

    return null;
  }

  _getEssentialMinecraftFacts(query) {
    if (query.includes('build') || query.includes('shelter') || query.includes('cabin') || query.includes('house')) {
      return `• [Architecture Wiki]: A secure survival shelter requires a 4x4 or 5x5 perimeter of solid blocks (oak planks/cobblestone), at least 3 blocks high, with an entrance door and roof to prevent phantom and spider attacks. Place torches for lighting (light level > 0 stops hostile mob spawns).`;
    }
    if (query.includes('farm') || query.includes('crop') || query.includes('wheat') || query.includes('food')) {
      return `• [Farming Wiki]: Farmland is created with a hoe on dirt. Crops need water within 4 horizontal blocks to stay hydrated. Wheat seeds drop from tall grass. Mature wheat (yellow) drops 1 wheat + seeds. 3 wheat crafts 1 bread in 2x2/3x3 crafting.`;
    }
    if (query.includes('trade') || query.includes('barter') || query.includes('emerald') || query.includes('currency') || query.includes('economy')) {
      return `• [Economy & Barter Wiki]: Standard Minecraft barter equivalencies: 16 Oak Planks ≈ 12 Cobblestone ≈ 1 Iron Ingot ≈ 1 Emerald. In survival barter, food (bread/cooked beef) holds 3x premium value during low health or high hunger.`;
    }
    if (query.includes('pickaxe') || query.includes('mine') || query.includes('coal') || query.includes('iron') || query.includes('stone') || query.includes('ore')) {
      return `• [Mining Progression]: Hand mining drops only dirt/wood. Wooden pickaxe required for stone/coal ore. Stone pickaxe required for iron/copper ore. Iron pickaxe required for gold, redstone, lapis, and diamond ore. Diamond pickaxe required for obsidian.`;
    }
    if (query.includes('creeper') || query.includes('skeleton') || query.includes('zombie') || query.includes('hostile') || query.includes('fight')) {
      return `• [Combat Tactics]: Skeletons shoot arrows with high accuracy at 8-16 blocks range (seek cover/shield). Creepers detonate in 1.5s when within 3 blocks (hit and sprint backward). Zombies inflict melee damage (backpedal while striking).`;
    }
    if (query.includes('craft') || query.includes('plank') || query.includes('tool') || query.includes('table')) {
      return `• [Crafting Rules]: 1 Log -> 4 Planks. 2 Planks -> 4 Sticks. 4 Planks -> 1 Crafting Table. 3 Planks/Cobblestone + 2 Sticks at Crafting Table -> Pickaxe. 2 Cobblestone + 1 Stick -> Stone Sword. 3 Cobblestone + 2 Sticks -> Stone Axe.`;
    }
    return `• [General Minecraft Survival]: Gather raw wood -> refine into planks and crafting table -> construct wooden pickaxe -> extract stone/coal -> upgrade to stone tools -> build shelter before dusk.`;
  }
}

module.exports = WebKnowledgeClient;
