/**
 * Web & Minecraft Knowledge Retrieval Client for Brain Broker.
 * Combines three knowledge sources, cheapest/most-reliable first:
 *   1. minecraft-data (local, structured, offline) — exact numeric facts
 *      (food values, effect durations, entity attributes) sourced from the
 *      same PrismarineJS data used by mineflayer itself.
 *   2. Built-in hazard/strategy knowledge base — curated prose counter-
 *      strategies, tagged with hazard metadata for priority routing.
 *   3. Live Minecraft Wiki search API — fallback for genuinely novel queries
 *      not covered by the above.
 */
const logger = require('../../shared/logger');

let mcData = null;
try {
  // Lazy/optional — falls back gracefully if not installed or version unmatched.
  mcData = require('minecraft-data')('1.20.4');
} catch (err) {
  logger.debug('WebKnowledge', `minecraft-data unavailable: ${err.message}`);
}

const HAZARD_TAGS = {
  POWDER_SNOW: 'powder_snow',
  LAVA_FIRE: 'lava_fire',
  DROWNING: 'drowning',
  FALL_DAMAGE: 'fall_damage',
  HUNGER: 'hunger',
  COMBAT: 'combat',
  SUFFOCATION: 'suffocation',
  VOID_RAVINE: 'void_ravine',
  NIGHT_EXPOSURE: 'night_exposure',
};

class WebKnowledgeClient {
  constructor() {
    this.cache = new Map();
    this.maxCacheSize = 200;
  }

  /**
   * @param {string} query
   * @param {{ priority?: 'hazard'|'normal' }} opts
   * @returns {Promise<{ text: string, isHazard: boolean, tags: string[], source: string } | null>}
   */
  async searchKnowledge(query, opts = {}) {
    if (!query || typeof query !== 'string' || query.length < 3) return null;
    const cleanQuery = query.toLowerCase().trim();
    const priority = opts.priority || 'normal';

    if (this.cache.has(cleanQuery)) {
      return this.cache.get(cleanQuery);
    }

    const structuredFact = this._getStructuredFact(cleanQuery);
    const builtIn = this._getEssentialMinecraftFacts(cleanQuery);

    // If we already have a hazard-tagged built-in answer, skip the network
    // round-trip entirely — saves LLM/wiki quota for genuinely novel queries,
    // and hazard responses need to be fast (agent may be actively dying).
    if (builtIn && builtIn.isHazard) {
      const result = this._assemble(structuredFact, builtIn, null);
      this._cacheSet(cleanQuery, result);
      logger.info('WebKnowledge', `Hazard lookup '${cleanQuery}' served from local KB (tags: ${builtIn.tags.join(',')}), wiki fetch skipped`);
      return result;
    }

    let wikiFacts = null;
    try {
      const wikiUrl = `https://minecraft.wiki/api.php?action=query&list=search&srsearch=${encodeURIComponent(cleanQuery)}&utf8=&format=json`;
      const res = await fetch(wikiUrl, {
        headers: { 'User-Agent': 'MinecraftAICivilization/1.0 (Autonomous Agent Sovereign Learning)' },
        signal: AbortSignal.timeout(priority === 'hazard' ? 1500 : 3500),
      });

      if (res.ok) {
        const data = await res.json();
        const searchResults = data?.query?.search || [];
        if (searchResults.length > 0) {
          wikiFacts = searchResults.slice(0, 2).map(r => {
            const cleanSnippet = (r.snippet || '').replace(/<[^>]+>/g, '').trim();
            return `• [Wiki: ${r.title}]: ${cleanSnippet}`;
          }).join('\n');
          logger.info('WebKnowledge', `Retrieved live Minecraft Wiki knowledge for '${cleanQuery}' (${searchResults.length} articles)`);
        }
      }
    } catch (err) {
      logger.debug('WebKnowledge', `Wiki search failed for '${cleanQuery}': ${err.message}`);
    }

    const result = this._assemble(structuredFact, builtIn, wikiFacts);
    if (result) this._cacheSet(cleanQuery, result);
    return result;
  }

  _assemble(structuredFact, builtIn, wikiFacts) {
    const parts = [structuredFact, builtIn ? builtIn.text : null, wikiFacts].filter(Boolean);
    if (parts.length === 0) return null;
    return {
      text: parts.join('\n'),
      isHazard: !!(builtIn && builtIn.isHazard),
      tags: builtIn ? builtIn.tags : [],
      source: wikiFacts ? 'builtin+wiki' : (structuredFact ? 'builtin+mcdata' : 'builtin'),
    };
  }

  _cacheSet(key, value) {
    this.cache.set(key, value);
    if (this.cache.size > this.maxCacheSize) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
  }

  /**
   * Pulls exact numeric facts from minecraft-data when available.
   * Cheap, offline, and version-accurate — used to ground the prose
   * counter-strategies in real numbers rather than hand-typed constants.
   */
  _getStructuredFact(query) {
    if (!mcData) return null;
    try {
      if (query.includes('beef') || query.includes('steak')) {
        const food = mcData.foodsByName?.cooked_beef;
        if (food) return `• [Data: cooked_beef]: restores ${food.foodPoints} hunger, ${food.saturation} saturation.`;
      }
      if (query.includes('bread')) {
        const food = mcData.foodsByName?.bread;
        if (food) return `• [Data: bread]: restores ${food.foodPoints} hunger, ${food.saturation} saturation.`;
      }
      if (query.includes('zombie')) {
        const entity = mcData.entitiesByName?.zombie;
        if (entity) return `• [Data: zombie]: ${entity.height?.toFixed(1)}m tall, category: ${entity.category || 'hostile'}.`;
      }
      if (query.includes('skeleton')) {
        const entity = mcData.entitiesByName?.skeleton;
        if (entity) return `• [Data: skeleton]: ${entity.height?.toFixed(1)}m tall, category: ${entity.category || 'hostile'}.`;
      }
      if (query.includes('creeper')) {
        const entity = mcData.entitiesByName?.creeper;
        if (entity) return `• [Data: creeper]: ${entity.height?.toFixed(1)}m tall, category: ${entity.category || 'hostile'}.`;
      }
    } catch (err) {
      logger.debug('WebKnowledge', `minecraft-data lookup failed: ${err.message}`);
    }
    return null;
  }

  /**
   * Curated hazard/strategy knowledge base. Hazard entries carry isHazard:true
   * and a tags array so callers (decision tree, RESEARCH escalation queue,
   * death-reinforcement pipeline) can route/priority-check without parsing text.
   */
  _getEssentialMinecraftFacts(query) {
    const hazard = (text, tags) => ({ text, isHazard: true, tags });
    const info = (text) => ({ text, isHazard: false, tags: [] });

    if (query.includes('powder_snow') || query.includes('freeze') || query.includes('snow') || query.includes('hypothermia') || query.includes('cold') || query.includes('shiver')) {
      return hazard(
        `• [Hazard Counter-Strategy: Powder Snow & Freezing]: Powder snow causes sinking and fatal freezing/hypothermia damage after 7s (140 ticks). COUNTERMEASURES: (1) Wearing Leather Boots completely negates sinking and prevents all freezing damage. (2) Standing near a Campfire, Torch, Jack o'Lantern, or Lava source resets the freezing meter and restores warmth. (3) If trapped without leather boots, climb out immediately using solid blocks or dig through with a shovel. Avoid exploring high-altitude snowy peaks without leather footwear.`,
        [HAZARD_TAGS.POWDER_SNOW]
      );
    }
    if (query.includes('lava') || query.includes('fire') || query.includes('burn') || query.includes('flame')) {
      return hazard(
        `• [Hazard Counter-Strategy: Lava & Fire]: Lava deals 4 HP/tick fire damage. COUNTERMEASURES: (1) Always carry a Water Bucket on hotbar to douse fire or convert lava into obsidian/cobblestone. (2) Crouch (sneak) when navigating near lava edges to prevent walking off. (3) Place solid cobblestone blocks to seal lava pockets before mining ores. (4) Golden Apples or Fire Resistance potions provide temporary immunity.`,
        [HAZARD_TAGS.LAVA_FIRE]
      );
    }
    if (query.includes('drown') || query.includes('water') || query.includes('underwater') || query.includes('suffocat')) {
      if (query.includes('sand') || query.includes('gravel')) {
        return hazard(
          `• [Hazard Counter-Strategy: Sand/Gravel Suffocation]: Falling sand or gravel can trap an agent in a pocket with no air source, dealing suffocation damage distinct from drowning. COUNTERMEASURES: (1) Never tunnel directly upward under unsupported sand/gravel columns. (2) If trapped, dig sideways rather than up/down to find the nearest open air pocket. (3) Placing a torch against a wall inside the pocket clears the block and creates breathing space instantly.`,
          [HAZARD_TAGS.SUFFOCATION]
        );
      }
      return hazard(
        `• [Hazard Counter-Strategy: Drowning & Suffocation]: Underwater breath depletes after 15s (300 ticks), dealing 2 HP/s suffocation damage. COUNTERMEASURES: (1) Placing a Torch, Door, or Sign against an adjacent solid wall creates an instant 1-block air pocket to refill oxygen bubbles immediately. (2) Surface vertically immediately when breath bubbles drop below 3. (3) Respiration enchantment or Water Breathing potions extend dive durations.`,
        [HAZARD_TAGS.DROWNING]
      );
    }
    if (query.includes('void') || query.includes('ravine') || query.includes('chasm') || query.includes('abyss')) {
      return hazard(
        `• [Hazard Counter-Strategy: Ravine & Void Falls]: Unlike a surface fall, a ravine/void drop often has no ground to water-clutch onto in time. COUNTERMEASURES: (1) Never sprint toward unexplored dark openings — pathfind with a "check ahead" block-scan before moving into unlit caverns. (2) Place blocks defensively (scaffold/cobweb) while falling if a water clutch isn't possible. (3) Keep torches lit along ravine edges once explored so the hazard is remembered spatially, not just as a rule.`,
        [HAZARD_TAGS.VOID_RAVINE, HAZARD_TAGS.FALL_DAMAGE]
      );
    }
    if (query.includes('fall') || query.includes('cliff') || query.includes('height') || query.includes('drop') || query.includes('ledge')) {
      return hazard(
        `• [Hazard Counter-Strategy: Fall Damage]: Falling > 3 blocks inflicts damage (Damage = Distance - 3). Drops > 23 blocks are lethal. COUNTERMEASURES: (1) Water Bucket Clutch: Emptying a water bucket right before landing completely nullifies all fall damage. (2) Hay Bales reduce fall damage by 80%. (3) Place ladders, vines, or scaffolding along vertical drops. (4) Feather Falling boots substantially reduce kinetic impact. Never sprint blindly off blind cliffs.`,
        [HAZARD_TAGS.FALL_DAMAGE]
      );
    }
    if (query.includes('starv') || query.includes('hunger') || query.includes('food') || query.includes('eat') || query.includes('cook')) {
      return hazard(
        `• [Survival Counter-Strategy: Hunger & Nutrition]: Hunger below 18 stops natural health regeneration; hunger at 0 causes starvation damage down to 1 HP (or death). COUNTERMEASURES: (1) Smelt raw meat (beef/pork/mutton/chicken) in a Furnace with coal/wood for 2.5x saturation and nutrition (cooked beef gives 8 hunger + 12.8 saturation). (2) Craft Bread from 3 wheat harvested from tall grass farmland. (3) Prioritize keeping hunger >= 16 to maintain fast auto-healing in combat.`,
        [HAZARD_TAGS.HUNGER]
      );
    }
    if (query.includes('night') && (query.includes('shelter') || query.includes('exposed') || query.includes('threat') || query.includes('unsafe'))) {
      return hazard(
        `• [Hazard Counter-Strategy: Night Exposure]: Remaining outdoors and unlit past tick 13000 sharply raises hostile mob spawn density and encounter risk. COUNTERMEASURES: (1) Prioritize reaching an enclosed, lit shelter before dusk over completing lower-priority tasks. (2) If caught outside, dig an emergency 1x2 pillar/hole and seal it with a placed block rather than continuing to travel. (3) Keep a torch and flint & steel on hand at all times as an emergency light source.`,
        [HAZARD_TAGS.NIGHT_EXPOSURE]
      );
    }
    if (query.includes('creeper') || query.includes('skeleton') || query.includes('zombie') || query.includes('hostile') || query.includes('mob') || query.includes('fight')) {
      const mobTags = [HAZARD_TAGS.COMBAT];
      if (query.includes('skeleton')) mobTags.push('skeleton');
      if (query.includes('creeper')) mobTags.push('creeper');
      if (query.includes('zombie')) mobTags.push('zombie');
      return hazard(
        `• [Combat Tactics & Countermeasures]: (1) Skeletons: Shoot arrows with high accuracy at 8-16 blocks range — use shields or strafe laterally to dodge arrow lines. (2) Creepers: Detonate in 1.5s within 3 blocks — hit and immediately sprint backward; shields block 100% explosion damage. (3) Zombies/Spiders: Build a 3-block high dirt/stone pillar under yourself to attack melee mobs from complete safety. (4) Place torches to keep light level > 0 to stop hostile mob spawning.`,
        mobTags
      );
    }

    // --- Non-hazard informational entries (unchanged priority/routing) ---
    if (query.includes('build') || query.includes('shelter') || query.includes('cabin') || query.includes('house')) {
      return info(`• [Architecture Wiki]: A secure survival shelter requires a 4x4 or 5x5 perimeter of solid blocks (oak planks/cobblestone), at least 3 blocks high, with an entrance door and roof to prevent phantom and spider attacks. Place torches for lighting (light level > 0 stops hostile mob spawns).`);
    }
    if (query.includes('farm') || query.includes('crop') || query.includes('wheat')) {
      return info(`• [Farming Wiki]: Farmland is created with a hoe on dirt. Crops need water within 4 horizontal blocks to stay hydrated. Wheat seeds drop from tall grass. Mature wheat (yellow) drops 1 wheat + seeds. 3 wheat crafts 1 bread in 2x2/3x3 crafting.`);
    }
    if (query.includes('trade') || query.includes('barter') || query.includes('emerald') || query.includes('currency') || query.includes('economy')) {
      return info(`• [Economy & Barter Wiki]: Standard Minecraft barter equivalencies: 16 Oak Planks ≈ 12 Cobblestone ≈ 1 Iron Ingot ≈ 1 Emerald. In survival barter, food (bread/cooked beef) holds 3x premium value during low health or high hunger.`);
    }
    if (query.includes('pickaxe') || query.includes('mine') || query.includes('coal') || query.includes('iron') || query.includes('stone') || query.includes('ore')) {
      return info(`• [Mining Progression]: Hand mining drops only dirt/wood. Wooden pickaxe required for stone/coal ore. Stone pickaxe required for iron/copper ore. Iron pickaxe required for gold, redstone, lapis, and diamond ore. Diamond pickaxe required for obsidian.`);
    }
    if (query.includes('craft') || query.includes('plank') || query.includes('tool') || query.includes('table')) {
      return info(`• [Crafting Rules]: 1 Log -> 4 Planks. 2 Planks -> 4 Sticks. 4 Planks -> 1 Crafting Table. 3 Planks/Cobblestone + 2 Sticks at Crafting Table -> Pickaxe. 2 Cobblestone + 1 Stick -> Stone Sword. 3 Cobblestone + 2 Sticks -> Stone Axe.`);
    }
    return info(`• [General Minecraft Survival]: Gather raw wood -> refine into planks and crafting table -> construct wooden pickaxe -> extract stone/coal -> upgrade to stone tools -> build shelter before dusk -> craft leather boots for snowy biomes -> carry water bucket against fire/fall hazards.`);
  }
}

module.exports = WebKnowledgeClient;