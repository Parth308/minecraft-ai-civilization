/**
 * Web & Minecraft Knowledge Retrieval Client for Brain Broker.
 * Queries live web search / Minecraft Wiki APIs to provide accurate game mechanics,
 * crafting recipes, mob combat guides, and survival strategies to LLM reasoning.
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
      // 1. Try official Minecraft Wiki Search API
      const wikiUrl = `https://minecraft.wiki/api.php?action=query&list=search&srsearch=${encodeURIComponent(cleanQuery)}&utf8=&format=json`;
      const res = await fetch(wikiUrl, {
        headers: { 'User-Agent': 'MinecraftAICivilization/1.0 (Autonomous Agent Learning)' },
        signal: AbortSignal.timeout(3500)
      });

      if (res.ok) {
        const data = await res.json();
        const searchResults = data?.query?.search || [];
        if (searchResults.length > 0) {
          // Take the top 2 snippets and strip HTML tags
          const facts = searchResults.slice(0, 2).map(r => {
            const cleanSnippet = (r.snippet || '').replace(/<[^>]+>/g, '').trim();
            return `• [Wiki: ${r.title}]: ${cleanSnippet}`;
          }).join('\n');

          logger.info('WebKnowledge', `Retrieved Minecraft knowledge for '${cleanQuery}' (${searchResults.length} articles)`);
          this.cache.set(cleanQuery, facts);
          return facts;
        }
      }
    } catch (err) {
      logger.debug('WebKnowledge', `Wiki search failed for '${cleanQuery}': ${err.message}`);
    }

    // 2. Fallback to built-in essential Minecraft mechanics database if offline/timeout
    const builtInKnowledge = this._getEssentialMinecraftFacts(cleanQuery);
    if (builtInKnowledge) {
      this.cache.set(cleanQuery, builtInKnowledge);
      return builtInKnowledge;
    }

    return null;
  }

  _getEssentialMinecraftFacts(query) {
    if (query.includes('pickaxe') || query.includes('mine') || query.includes('coal') || query.includes('iron') || query.includes('stone')) {
      return `• [Minecraft Rules]: Breaking stone, coal ore, or iron ore by hand drops NOTHING. You MUST craft a wooden pickaxe (3 planks + 2 sticks at a crafting table) to mine stone/coal, and a stone pickaxe to mine iron ore.`;
    }
    if (query.includes('tree') || query.includes('log') || query.includes('wood') || query.includes('craft')) {
      return `• [Minecraft Rules]: Punching wood logs drops logs. 1 log = 4 planks (in 2x2 crafting). 2 planks = 4 sticks. 4 planks = 1 crafting table. Place crafting table for 3x3 tools.`;
    }
    if (query.includes('creeper') || query.includes('skeleton') || query.includes('zombie') || query.includes('hostile')) {
      return `• [Combat Rules]: Skeletons shoot arrows at range (seek cover/flee). Creepers explode if close (sprint hit & back away). Zombies have high health (hit & backpedal).`;
    }
    if (query.includes('eat') || query.includes('food') || query.includes('hunger')) {
      return `• [Survival Rules]: Hunger below 6 causes starvation damage. Eat cooked meats, apples, bread, or sweet berries to regenerate health naturally.`;
    }
    return null;
  }
}

module.exports = WebKnowledgeClient;
