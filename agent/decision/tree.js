const evaluateEat = require('./rules/eat');
const evaluateFlee = require('./rules/flee');
const evaluateFight = require('./rules/fight');
const evaluateSleep = require('./rules/sleep');
const evaluateMine = require('./rules/mine');
const evaluateCraft = require('./rules/craft');
const evaluateExplore = require('./rules/explore');
const evaluateTrade = require('./rules/trade');
const evaluateTalk = require('./rules/talk');
const evaluateCooperate = require('./rules/cooperate');
const evaluateFarm = require('./rules/farm');
const evaluateSteal = require('./rules/steal');
const evaluateDefend = require('./rules/defend');
const evaluateHunt = require('./rules/hunt');
const evaluateSmelt = require('./rules/smelt');
const evaluateScout = require('./rules/scout');
const evaluateGuard = require('./rules/guard');
const evaluateBuild = require('./rules/build');
const buildAffordances = require('../perception/affordances');
const DynamicRuleEngine = require('./dynamicRules');
const ConfidenceEvaluator = require('./confidence');
const EscalationManager = require('./escalate');
const SocietyClient = require('../memory/societyClient');
const EmotionalState = require('../cognition/emotions');
const BeliefNetwork = require('../cognition/beliefs');
const logger = require('../../shared/logger');

/** Slim a Mineflayer block object: strip 200+ fields down to the ~8 the broker uses.
 *  Prevents V8 old-gen bloat from retained block-state objects causing heap OOM. */
function slimBlock(block) {
  if (!block || typeof block !== 'object') return block;
  return {
    name: block.name, displayName: block.displayName || block.name,
    position: block.position ? { x: block.position.x, y: block.position.y, z: block.position.z } : null,
    type: block.type ?? block.stateId, hardness: block.hardness,
    lightLevel: block.lightLevel, isUnderground: block.isUnderground,
    drops: block.drops ? (Array.isArray(block.drops) ? block.drops[0] : block.drops) : null,
  };
}

class DecisionTree {
  constructor(threshold = 0.6, memoryClient = null, brainClient = null) {
    this.confidenceEvaluator = new ConfidenceEvaluator(threshold);
    this.escalator = new EscalationManager(brainClient);
    this.dynamicRuleEngine = new DynamicRuleEngine(memoryClient);
    this._recentChatMessages = new Map();
    this._eventsCache = { data: '', expiry: 0 };
    this._lessonsCache = { data: [], expiry: 0 };
    this._discoveriesCache = new Map();
  }

  async evaluate(senses, statsManager, persona = null, agentState = {}) {
    const stats = statsManager.getSummary();

    if (!this._evalCount) this._evalCount = 0;
    this._evalCount++;
    if (this._evalCount % 120 === 0) {
      const agentId = senses.bot?.username || persona?.agentId || 'Agent';
      this.dynamicRuleEngine.pollRuleAdjustments(agentId, process.env.MEMORY_SERVICE_URL || 'http://localhost:3002');
    }

    const staticCandidates = [
      evaluateFlee(senses, stats),
      evaluateEat(senses, stats),
      evaluateFight(senses, stats, persona),
      evaluateSleep(senses, stats, persona, agentState),
      evaluateCraft(senses, stats),
      evaluateMine(senses, stats),
      evaluateExplore(senses, stats),
      evaluateTrade(senses, stats, persona, agentState),
      evaluateTalk(senses, stats, persona, agentState),
      evaluateCooperate(senses, stats, persona, agentState),
      evaluateFarm(senses, stats, persona, agentState),
      evaluateSteal(senses, stats, persona, agentState),
      evaluateDefend(senses, stats, persona, agentState),
      evaluateHunt(senses, stats, persona, agentState),
      evaluateSmelt(senses, stats, persona, agentState),
      evaluateScout(senses, stats, persona, agentState),
      evaluateGuard(senses, stats, persona, agentState),
      evaluateBuild(senses, stats, persona, agentState)
    ];

    // Include dynamically learned rules
    const dynamicCandidates = this.dynamicRuleEngine.evaluateDynamicRules(senses, stats);
    const rawCandidates = [...staticCandidates, ...dynamicCandidates];

    // Apply persona trait biases so different agents make distinct behavioral choices
    // Weights scaled to ±0.50+ so personality can override learned rules (max 0.85)
    const candidates = rawCandidates.map(c => {
      let conf = c.confidence;
      if (persona && persona.traits) {
        const tr = persona.traits;
        if (c.name === 'EXPLORE') conf += (tr.curiosity - 0.5) * 0.50;
        if (c.name === 'FLEE') conf += (tr.caution - 0.5) * 0.45;
        if (c.name === 'CRAFT') conf += (tr.caution - 0.5) * 0.35 + (tr.curiosity - 0.5) * 0.20;
        if (c.name === 'MINE') conf += (tr.ambition - 0.5) * 0.45 + (tr.greed - 0.5) * 0.30;
        if (c.name === 'TRADE' || c.name === 'TALK') conf += (tr.sociability - 0.5) * 0.55 + (tr.greed - 0.5) * 0.30;
        if (c.name === 'FIGHT') conf += (0.5 - tr.caution) * 0.45 + (tr.ambition - 0.5) * 0.30;
        if (c.name === 'STEAL') conf += (tr.greed - 0.5) * 0.40 + (0.5 - tr.caution) * 0.35;
        if (c.name === 'COOPERATE') conf += (tr.sociability - 0.5) * 0.50 + (tr.trust - 0.5) * 0.30;
        if (c.name === 'FARM') conf += (tr.patience - 0.5) * 0.35 + (tr.caution - 0.5) * 0.20;
        if (c.name === 'DEFEND') conf += (tr.caution - 0.5) * 0.40 + (tr.ambition - 0.5) * 0.25;
        if (c.name === 'HUNT') conf += (tr.ambition - 0.5) * 0.35 + (tr.patience - 0.5) * 0.20;
        if (c.name === 'SMELT') conf += (tr.patience - 0.5) * 0.40 + (tr.caution - 0.5) * 0.20;
        if (c.name === 'SCOUT') conf += (tr.curiosity - 0.5) * 0.45 + (tr.caution - 0.5) * 0.25;
        if (c.name === 'GUARD') conf += (tr.sociability - 0.5) * 0.35 + (tr.caution - 0.5) * 0.30;
        if (c.name === 'BUILD') conf += (tr.ambition - 0.5) * 0.40 + (tr.patience - 0.5) * 0.25;
      }
      return { ...c, confidence: Math.min(0.99, Math.max(0.01, Number(conf.toFixed(2)))) };
    });

    // ── Inner weather & needs: feelings tint confidence, never command. ────────
    const selfId = senses.bot?.username || persona?.agentId || 'Agent';
    const emo = EmotionalState.forAgent(selfId);
    const beliefs = BeliefNetwork.forAgent(selfId);
    for (const c of candidates) {
      if (c.name === 'FLEE') c.confidence += emo.emotions.fear * 0.06;
      if (c.name === 'FIGHT') c.confidence += emo.directedSum('anger') * 0.07;
      if (c.name === 'TALK' || c.name === 'COOPERATE') {
        c.confidence += emo.emotions.gratitude * 0.05;
        if (emo.inGrief()) c.confidence += 0.05; // grief seeks company
      }
      if (c.name === 'EXPLORE') c.confidence += emo.emotions.joy * 0.03;
    }

    // Motivation ladder: when survival is handled, unmet higher needs whisper.
    const survivalFine = stats.health > 14 && stats.hunger > 50;
    if (survivalFine && persona?.traits) {
      const tr = persona.traits;
      if ((tr.sociability ?? 0.5) > 0.6) {
        for (const c of candidates) if (c.name === 'TALK') c.confidence += 0.04; // belonging
      }
      if ((tr.curiosity ?? 0.5) > 0.65 || (tr.ambition ?? 0.5) > 0.7) {
        for (const c of candidates) if (c.name === 'MINE' || c.name === 'CRAFT') c.confidence += 0.04; // mastery
      }
    }

    // Mastery: accumulated learned rules per action = lived competence
    const ruleCounts = {};
    for (const r of (this.dynamicRuleEngine.learnedRules || [])) {
      ruleCounts[r.action] = (ruleCounts[r.action] || 0) + 1;
    }
    for (const c of candidates) {
      if (ruleCounts[c.name]) c.confidence += Math.min(0.04, ruleCounts[c.name] * 0.01);
    }

    // Action chains: suggest next logical action after completion
    const ACTION_CHAINS = {
      'MINE': ['SMELT', 'CRAFT'],
      'SMELT': ['CRAFT', 'BUILD'],
      'HUNT': ['COOK', 'EAT'],
      'FARM': ['HARVEST', 'EAT'],
      'EXPLORE': ['MINE', 'SCOUT'],
      'SCOUT': ['EXPLORE', 'MINE'],
      'BUILD': ['GUARD', 'DEFEND'],
    };
    const lastCompletedAction = agentState.lastActionResult?.action;
    if (lastCompletedAction && agentState.lastActionResult?.ok && ACTION_CHAINS[lastCompletedAction]) {
      const nextActions = ACTION_CHAINS[lastCompletedAction];
      for (const c of candidates) {
        if (nextActions.includes(c.name)) {
          c.confidence += 0.12;
          c.reason += ` [chain from ${lastCompletedAction}]`;
        }
      }
    }

    // ── Improvement 1: Productivity stagnation detector ───────────────────────
    // If no resource-gathering action in the last 60s, nudge the agent away from
    // pure exploration loops and toward productive work. This breaks the
    // EXPLORE→SCOUT→EXPLORE soft-loop observed when 10+ ores are visible.
    const PRODUCTIVE_ACTIONS = new Set(['MINE', 'CRAFT', 'SMELT', 'BUILD', 'FARM', 'HARVEST', 'HUNT']);
    if (!this._lastProductiveAt) this._lastProductiveAt = Date.now();
    const recentTen = (this._actionHistory || []).slice(-10);
    if (recentTen.some(a => PRODUCTIVE_ACTIONS.has(a))) {
      this._lastProductiveAt = Date.now();
    } else if (Date.now() - this._lastProductiveAt > 60000) {
      for (const c of candidates) {
        if (PRODUCTIVE_ACTIONS.has(c.name)) {
          c.confidence += 0.15;
          c.reason += ' [productivity nudge: no resource-gathering in 60s]';
        }
        if (c.name === 'EXPLORE' || c.name === 'SCOUT' || c.name === 'WANDER') {
          c.confidence -= 0.10;
        }
      }
    }

    // Time-of-day weighting: actions appropriate for current time get boost
    const timeOfDay = agentState.timeOfDay || 'day';
    const isNight = agentState.isNight || false;
    const isDawn = agentState.isDawn || false;
    const isDusk = agentState.isDusk || false;

    for (const c of candidates) {
      if (isNight) {
        if (c.name === 'SLEEP') c.confidence += 0.20;
        if (c.name === 'BUILD') c.confidence += 0.10;
        if (c.name === 'EXPLORE') c.confidence -= 0.15;
        if (c.name === 'SCOUT') c.confidence -= 0.12;
        if (c.name === 'FARM') c.confidence -= 0.10;
      }
      if (isDawn || isDusk) {
        if (c.name === 'EXPLORE') c.confidence += 0.10;
        if (c.name === 'SCOUT') c.confidence += 0.08;
        if (c.name === 'HUNT') c.confidence += 0.06;
      }
      if (timeOfDay === 'day' && !isNight) {
        if (c.name === 'FARM') c.confidence += 0.12;
        if (c.name === 'MINE') c.confidence += 0.06;
        if (c.name === 'BUILD') c.confidence += 0.08;
        if (c.name === 'GUARD') c.confidence += 0.05;
      }
    }

    // Resource-aware actions: check tool durability before suggesting actions
    const mainHand = senses.bot?.equipment?.items()?.[4];
    if (mainHand) {
      const durability = mainHand.durability || 0;
      const maxDurability = mainHand.maxDurability || 1;
      const durabilityRatio = durability / maxDurability;

      for (const c of candidates) {
        if (c.name === 'MINE' && durabilityRatio < 0.2) {
          c.confidence -= 0.25;
          c.reason += ` [tool low durability: ${Math.round(durabilityRatio * 100)}%]`;
        }
        if (c.name === 'FIGHT' && durabilityRatio < 0.15) {
          c.confidence -= 0.20;
          c.reason += ` [weapon critical: ${Math.round(durabilityRatio * 100)}%]`;
        }
        if (c.name === 'BUILD' && durabilityRatio < 0.1) {
          c.confidence -= 0.15;
        }
      }
    }

    // Memory-weighted decisions: avoid death locations, revisit success spots (cached 30s)
    try {
      const memUrl = process.env.MEMORY_SERVICE_URL || 'http://localhost:3002';
      const agentId = senses.bot?.username || persona?.agentId || 'Agent';
      const pos = senses.bot?.entity?.position;
      if (pos) {
        let recentEvents = '';
        const now = Date.now();
        if (now < this._eventsCache.expiry) {
          recentEvents = this._eventsCache.data;
        } else {
          const memRes = await fetch(`${memUrl}/api/memory/${agentId}/section/events?limit=20`, { signal: AbortSignal.timeout(2000) });
          if (memRes.ok) {
            const events = await memRes.json();
            recentEvents = events.content || '';
            this._eventsCache = { data: recentEvents, expiry: now + 30000 };
          }
        }

        if (recentEvents) {
          const deathNearby = recentEvents.includes('died') && (
            recentEvents.includes(`(${Math.round(pos.x)},`) || recentEvents.includes(`x:${Math.round(pos.x)}`)
          );
          if (deathNearby) {
            for (const c of candidates) {
              if (c.name === 'EXPLORE' || c.name === 'SCOUT') {
                c.confidence -= 0.18;
                c.reason += ' [death memory nearby]';
              }
            }
          }

          const successNearby = recentEvents.includes('success') && (
            recentEvents.includes(`(${Math.round(pos.x)},`) || recentEvents.includes(`x:${Math.round(pos.x)}`)
          );
          if (successNearby) {
            for (const c of candidates) {
              if (c.name === 'MINE' || c.name === 'BUILD') {
                c.confidence += 0.08;
                c.reason += ' [success memory nearby]';
              }
            }
          }
        }
      }
    } catch { /* memory is optional */ }

    // Social graph awareness: actions depend on relationship quality
    try {
      const selfId = senses.bot?.username || persona?.agentId || 'Agent';
      const client = SocietyClient.forAgent(selfId);
      const society = await client.getContext();
      if (society) {
        const rep = society.reputationHighlights || [];
        const isTrusted = rep.some(r => r.includes('trusted') || r.includes('ally'));
        const isDistrusted = rep.some(r => r.includes('distrusted') || r.includes('enemy'));

        for (const c of candidates) {
          if (c.name === 'COOPERATE' || c.name === 'TRADE') {
            if (isTrusted) c.confidence += 0.10;
            if (isDistrusted) c.confidence -= 0.12;
          }
          if (c.name === 'GUARD' || c.name === 'DEFEND') {
            if (isTrusted) c.confidence += 0.08;
          }
          if (c.name === 'STEAL') {
            if (isDistrusted) c.confidence += 0.06;
          }
        }
      }
    } catch { /* society is optional */ }

    // Risk/reward scoring: calculate risk vs reward for each action
    const healthRatio = stats.health / 20;
    const hungerRatio = stats.hunger / 100;
    const mobCount = senses.getNearbyHostileMobs?.(16)?.length || 0;
    const toolDurability = mainHand ? (mainHand.durability || 0) / (mainHand.maxDurability || 1) : 1;
    const isNightNow = agentState.isNight || false;

    for (const c of candidates) {
      let risk = 0;
      let reward = 0;

      // Risk factors
      if (c.name === 'FIGHT' || c.name === 'DEFEND') {
        risk += mobCount * 0.08;
        risk += (1 - healthRatio) * 0.15;
        risk += (1 - toolDurability) * 0.10;
      }
      if (c.name === 'MINE') {
        risk += mobCount * 0.05;
        risk += (1 - toolDurability) * 0.12;
      }
      if (c.name === 'EXPLORE' || c.name === 'SCOUT') {
        risk += mobCount * 0.06;
        risk += isNightNow ? 0.10 : 0;
        risk += (1 - healthRatio) * 0.08;
      }
      if (c.name === 'STEAL') {
        risk += mobCount * 0.04;
        risk += (1 - healthRatio) * 0.06;
      }

      // Reward factors
      if (c.name === 'MINE') {
        reward += 0.12;
        reward += stats.iron < 5 ? 0.08 : 0;
        reward += stats.gold < 3 ? 0.06 : 0;
      }
      if (c.name === 'FARM') {
        reward += 0.10;
        reward += hungerRatio < 0.5 ? 0.10 : 0;
      }
      if (c.name === 'HUNT') {
        reward += 0.08;
        reward += hungerRatio < 0.4 ? 0.12 : 0;
      }
      if (c.name === 'BUILD') {
        reward += 0.09;
        reward += stats.wood > 10 ? 0.06 : 0;
      }
      if (c.name === 'CRAFT') {
        reward += 0.11;
        reward += stats.iron > 3 ? 0.07 : 0;
      }
      if (c.name === 'TRADE' || c.name === 'COOPERATE') {
        reward += 0.07;
      }
      if (c.name === 'SMELT') {
        reward += 0.08;
        reward += stats.raw_iron > 0 || stats.raw_gold > 0 ? 0.09 : 0;
      }

      const riskRewardScore = reward - risk * 0.6;
      c.confidence += Math.max(-0.20, Math.min(0.20, riskRewardScore));
    }

    // Opportunity recognition: spot chances to succeed
    const nearbyPlayers = senses.getNearbyPlayers?.(16) || [];
    const nearbyChests = senses.getNearbyBlock?.('chest', 12);
    const hasFurnace = !!senses.getNearbyBlock?.('furnace', 8);
    const hasCraftingTable = !!senses.getNearbyBlock?.('crafting_table', 8);
    const nearbyAnimals = senses.getNearbyPassiveMobs?.(12) || [];

    for (const c of candidates) {
      if (c.name === 'TRADE' && nearbyPlayers.length > 0) {
        c.confidence += 0.12;
        c.reason += ' [opportunity: player nearby]';
      }
      if (c.name === 'SMELT' && hasFurnace && (stats.raw_iron > 0 || stats.raw_gold > 0)) {
        c.confidence += 0.10;
        c.reason += ' [opportunity: furnace + ores]';
      }
      if (c.name === 'CRAFT' && hasCraftingTable && stats.wood > 3) {
        c.confidence += 0.08;
        c.reason += ' [opportunity: table + materials]';
      }
      if (c.name === 'HUNT' && nearbyAnimals.length > 0 && hungerRatio < 0.6) {
        c.confidence += 0.11;
        c.reason += ' [opportunity: animals + hunger]';
      }
      if (c.name === 'STEAL' && nearbyPlayers.length > 0 && nearbyChests) {
        c.confidence += 0.09;
        c.reason += ' [opportunity: player + chest]';
      }
    }

    // ── Improvement 2: Ore-visible urgency ────────────────────────────────────
    // 10 ores visible in logs but MINE wasn't winning. When ores are detectable
    // and agent has a pickaxe and decent health, MINE gets an urgency boost so
    // it beats ambient EXPLORE/SCOUT.
    const nearbyOres = typeof senses.getNearbyOres === 'function' ? senses.getNearbyOres(20) : [];
    const hasAnyPickaxe = (agentState.inventory || []).some(i => i.name?.includes('pickaxe'));
    if (nearbyOres.length >= 3 && hasAnyPickaxe && stats.health > 12 && stats.hunger > 25) {
      for (const c of candidates) {
        if (c.name === 'MINE') {
          c.confidence += 0.20;
          c.reason += ` [urgency: ${nearbyOres.length} ores visible]`;
        }
      }
    } else if (nearbyOres.length >= 1 && hasAnyPickaxe && stats.health > 14) {
      for (const c of candidates) {
        if (c.name === 'MINE') {
          c.confidence += 0.10;
          c.reason += ` [opportunity: ${nearbyOres.length} ore${nearbyOres.length > 1 ? 's' : ''} spotted]`;
        }
      }
    }

    // Faster learning from others' mistakes (cached 30s)
    try {
      const memUrl = process.env.MEMORY_SERVICE_URL || 'http://localhost:3002';
      const now = Date.now();
      let lessonsList = [];
      if (now < this._lessonsCache.expiry) {
        lessonsList = this._lessonsCache.data;
      } else {
        const ledgerRes = await fetch(`${memUrl}/api/ledger/lessons?limit=10&public=true`, { signal: AbortSignal.timeout(2000) });
        if (ledgerRes.ok) {
          const lessonsData = await ledgerRes.json();
          lessonsList = lessonsData.lessons || [];
          this._lessonsCache = { data: lessonsList, expiry: now + 30000 };
        }
      }

      for (const lesson of lessonsList) {
        const text = lesson.lesson || '';
        const otherAgent = lesson.agentId || '';

        if (otherAgent !== (senses.bot?.username || 'Agent')) {
          if (text.includes('died') && text.includes('lava')) {
            for (const c of candidates) {
              if (c.name === 'MINE' || c.name === 'EXPLORE') {
                c.confidence -= 0.06;
                c.reason += ' [learned: others died to lava]';
              }
            }
          }
          if (text.includes('starved')) {
            for (const c of candidates) {
              if (c.name === 'FARM' || c.name === 'HUNT') {
                c.confidence += 0.05;
                c.reason += ' [learned: others starved]';
              }
            }
          }
          if (text.includes('killed by') && text.includes('zombie')) {
            for (const c of candidates) {
              if (c.name === 'FIGHT' && stats.health < 14) {
                c.confidence -= 0.08;
                c.reason += ' [learned: others killed by zombies]';
              }
            }
          }
        }
      }
    } catch { /* lessons are optional */ }

    // Inventory management: prioritize useful items
    const inventory = agentState.inventory || [];
    const hasPickaxe = inventory.some(i => i.name?.includes('pickaxe'));
    const hasSword = inventory.some(i => i.name?.includes('sword'));
    const hasFood = inventory.some(i => ['bread', 'cooked_beef', 'cooked_porkchop', 'cooked_mutton', 'apple'].includes(i.name));
    const hasWood = inventory.some(i => i.name?.includes('_log'));
    const hasOre = inventory.some(i => i.name?.includes('raw_') || i.name?.includes('iron') || i.name?.includes('gold'));
    const inventoryFull = inventory.length >= 36;

    for (const c of candidates) {
      if (c.name === 'MINE' && !hasPickaxe) {
        c.confidence -= 0.25;
        c.reason += ' [no pickaxe]';
      }
      if (c.name === 'FIGHT' && !hasSword) {
        c.confidence -= 0.15;
        c.reason += ' [no sword]';
      }
      if (c.name === 'EAT' && !hasFood) {
        c.confidence -= 0.30;
        c.reason += ' [no food]';
      }
      if (c.name === 'CRAFT' && !hasWood) {
        c.confidence -= 0.20;
        c.reason += ' [no wood]';
      }
      if (c.name === 'SMELT' && !hasOre) {
        c.confidence -= 0.22;
        c.reason += ' [no ores]';
      }
      if (inventoryFull && (c.name === 'MINE' || c.name === 'HUNT' || c.name === 'FARM')) {
        c.confidence -= 0.18;
        c.reason += ' [inventory full]';
      }
      if (inventoryFull && c.name === 'BUILD') {
        c.confidence += 0.08;
        c.reason += ' [opportunity: use materials]';
      }
    }

    // Death consequences: real penalty for dying
    const deathCount = agentState.deathCount || 0;
    if (deathCount > 0) {
      for (const c of candidates) {
        if (c.name === 'FIGHT' || c.name === 'STEAL' || c.name === 'EXPLORE') {
          c.confidence -= deathCount * 0.04;
          c.reason += ` [died ${deathCount}x: more cautious]`;
        }
        if (c.name === 'BUILD' || c.name === 'GUARD') {
          c.confidence += deathCount * 0.03;
          c.reason += ` [died ${deathCount}x: seeking safety]`;
        }
      }
    }

    // ── Improvement 3: Post-death gear-up urgency ─────────────────────────────
    // When an agent just respawned (justDied flag set by index.js), open a 3min
    // window where CRAFT/SMELT/BUILD are heavily boosted. Creates natural
    // 'die → gear up → survive better' learning without LLM dependency.
    if (agentState.justDied) {
      this._deathRecoveryUntil = Date.now() + 3 * 60 * 1000;
      this._lastDeathCause = agentState.lastDeathCause || 'unknown';
      agentState.justDied = false; // consume once — window is tracked by _deathRecoveryUntil
      logger.info('DecisionTree', `[POST-DEATH RECOVERY] ${this._lastDeathCause} kill — 3min gear-up window activated`);
    }
    if (this._deathRecoveryUntil && Date.now() < this._deathRecoveryUntil) {
      const hasIronInInv = (agentState.inventory || []).some(i => i.name?.includes('iron'));
      const hasWoodInInv = (agentState.inventory || []).some(i => i.name?.includes('log') || i.name?.includes('plank'));
      for (const c of candidates) {
        if (c.name === 'CRAFT' || c.name === 'SMELT') {
          c.confidence += hasIronInInv ? 0.22 : 0.12;
          c.reason += ' [post-death: gear up priority]';
        }
        if (c.name === 'BUILD') {
          c.confidence += 0.15;
          c.reason += ' [post-death: shelter priority]';
        }
        if (c.name === 'MINE' && !hasAnyPickaxe && hasWoodInInv) {
          // Has wood but no pickaxe — craft first, then mine
          c.confidence -= 0.15;
        }
        // Killer-specific avoidance: if a zombie/drowned killed us, extra flee when they're nearby again
        if (c.name === 'FLEE' && (this._lastDeathCause === 'zombie' || this._lastDeathCause === 'drowned') && stats.health < 16) {
          c.confidence += 0.15;
          c.reason += ` [post-death: avoided ${this._lastDeathCause}]`;
        }
      }
    }

    // ── Improvement 4: Tech-tier progression bias ─────────────────────────────
    // Detects which tool tier the agent is on and nudges toward the next upgrade.
    // Wood → Stone → Iron is the critical progression ladder; without it agents
    // mine cobblestone forever with a wooden pickaxe or ignore available iron.
    {
      const inv = agentState.inventory || [];
      const hasStonePick = inv.some(i => i.name === 'stone_pickaxe');
      const hasIronPick  = inv.some(i => i.name === 'iron_pickaxe' || i.name === 'diamond_pickaxe' || i.name === 'netherite_pickaxe');
      const ironIngots   = inv.filter(i => i.name === 'iron_ingot').reduce((s, i) => s + i.count, 0);
      const cobble       = inv.filter(i => i.name === 'cobblestone' || i.name === 'cobbled_deepslate').reduce((s, i) => s + i.count, 0);
      const hasStick     = inv.some(i => i.name === 'stick');
      const woodPlanks   = inv.filter(i => i.name?.includes('planks')).reduce((s, i) => s + i.count, 0);

      if (!hasStonePick && !hasIronPick && cobble >= 3) {
        // Tier 0→1: have cobble, craft stone pickaxe NOW
        for (const c of candidates) {
          if (c.name === 'CRAFT') { c.confidence += 0.25; c.reason += ' [tier-up: craft stone pickaxe]'; }
        }
      } else if (!hasIronPick && ironIngots >= 3) {
        // Tier 1→2: have iron ingots, craft iron pickaxe NOW
        for (const c of candidates) {
          if (c.name === 'CRAFT') { c.confidence += 0.25; c.reason += ' [tier-up: craft iron pickaxe]'; }
        }
      } else if (!hasIronPick && ironIngots < 3 && (hasStonePick || hasAnyPickaxe)) {
        // Tier 1: need more iron ore — mining is the path
        for (const c of candidates) {
          if (c.name === 'MINE') { c.confidence += 0.18; c.reason += ' [tier-up: mining for iron]'; }
        }
      } else if (!hasAnyPickaxe && woodPlanks >= 3) {
        // Tier 0: have planks but no pickaxe at all — craft wooden pickaxe first
        for (const c of candidates) {
          if (c.name === 'CRAFT') { c.confidence += 0.30; c.reason += ' [tier-up: craft wooden pickaxe — no tools]'; }
        }
      }
    }

    // Failure refractory: track consecutive failures per action and apply
    // escalating penalties. A flat -0.18 was overwhelmed by stacked persona
    // (+0.35), opportunity (+0.12), mastery (+0.04), chain (+0.12), and social
    // graph (+0.10) boosts — total ~0.73, leaving confidence at 0.54+ even
    // after repeated failures. Escalating penalty = 0.18 × count (cap 0.50).
    if (!this._actionConsecutiveFailures) this._actionConsecutiveFailures = new Map();
    const lastResult = agentState.lastActionResult;
    if (lastResult && lastResult.action) {
      if (lastResult.ok === false) {
        const prev = this._actionConsecutiveFailures.get(lastResult.action) || 0;
        this._actionConsecutiveFailures.set(lastResult.action, prev + 1);
        const penalty = Math.min(0.50, 0.18 * (prev + 1));
        for (const c of candidates) {
          if (c.name === lastResult.action) c.confidence -= penalty;
        }
      } else if (lastResult.ok === true) {
        this._actionConsecutiveFailures.delete(lastResult.action);
      }
    }

    // Confidence ceiling: persona, emotion, opportunity, mastery, and chain
    // boosts stack additively after the initial 0.99 cap, pushing learned rules
    // past 1.0 and preventing the stuck-loop detector from firing. Hard clamp.
    for (const c of candidates) {
      c.confidence = Math.min(0.99, Math.max(0.01, c.confidence));
    }

    // Sort by highest confidence
    candidates.sort((a, b) => b.confidence - a.confidence);
    let topCandidate = candidates[0];

    // Action loop & stagnation detector: prevent infinite repetitive actions.
    // FIGHT excluded on purpose — re-selecting combat every cycle is correct behavior.
    if (!this._actionHistory) this._actionHistory = [];
    if (!this._loopPenalties) this._loopPenalties = new Map(); // action -> penalty until timestamp
    this._actionHistory.push(topCandidate.name);
    if (this._actionHistory.length > 8) this._actionHistory.shift();

    const now = Date.now();
    for (const [action, expiry] of this._loopPenalties) {
      if (now < expiry) {
        for (const c of candidates) {
          if (c.name === action) c.confidence -= 0.35;
        }
      } else {
        this._loopPenalties.delete(action);
      }
    }
    candidates.sort((a, b) => b.confidence - a.confidence);
    const penalizedTop = candidates[0];

    const LOOPABLE_ACTIONS = new Set(['EXPLORE', 'WANDER', 'MINE', 'CRAFT', 'EAT', 'FLEE', 'EQUIP', 'TRADE', 'TALK']);
    const historyLen = this._actionHistory.length;
    const uniqueRecent = [...new Set(this._actionHistory.slice(-6))];
    const isSingleLoop = (
      historyLen >= 6 &&
      uniqueRecent.length === 1 &&
      LOOPABLE_ACTIONS.has(uniqueRecent[0])
    );
    const isDualLoop = (
      historyLen >= 6 &&
      uniqueRecent.length === 2 &&
      LOOPABLE_ACTIONS.has(uniqueRecent[0]) &&
      LOOPABLE_ACTIONS.has(uniqueRecent[1]) &&
      this._actionHistory.slice(-6).every((a, i) => a === this._actionHistory[i % 2])
    );
    const isStuckInLoop = isSingleLoop || isDualLoop;

    if (isStuckInLoop) {
      const loopType = isSingleLoop ? `repeated '${uniqueRecent[0]}' 6 consecutive` : `alternating ${uniqueRecent.join('/')} (2-action cycle)`;
      logger.warn('DecisionTree', `[STUCK LOOP DETECTED] Agent ${loopType} cycles. Penalizing actions for 30s and escalating.`);
      this._loopPenalties.set(topCandidate.name, Date.now() + 30000);
      for (const u of uniqueRecent) this._loopPenalties.set(u, Date.now() + 30000);
      this._actionHistory = [];
      if (penalizedTop.name !== topCandidate.name) {
        topCandidate = penalizedTop;
      }
    }

    // Escalation suppression: if the last N escalations for this action all returned
    // fallback (providers were down), stop escalating for 90s and resolve locally.
    // This prevents the TRADE/TALK alternation loop where the DT throws away its own
    // correct decision in favour of a stale cached broker response, every single tick.
    if (!this._escalationFallbackStreak) this._escalationFallbackStreak = new Map();
    if (!this._escalationSuppressedUntil) this._escalationSuppressedUntil = new Map();

    logger.info('DecisionTree', `Evaluated top action '${topCandidate.name}' with confidence ${topCandidate.confidence} (${topCandidate.reason}) [Learned Rules: ${this.dynamicRuleEngine.getRulesCount()}]`);

    // ── Improvement 5: Drowning pre-emption (hard gate, not soft boost) ───────
    // Most common death cause in the ledger: drowning. The existing isWaterRisk
    // only fires when already at low health OR oxygen < 15. By that point the
    // DT may still choose MINE or EXPLORE. This hard gate overrides the sort
    // result instantly when oxygen is in the danger zone (< 10 = 2 bubbles left).
    const oxygenLevel = senses.bot?.oxygenLevel ?? 20;
    const isInWaterNow = senses.isInWater?.() || agentState.isInWater;
    if (isInWaterNow && oxygenLevel < 10) {
      for (const c of candidates) {
        if (c.name === 'FLEE') {
          c.confidence = Math.max(c.confidence, 0.97);
          c.reason = `[DROWNING] Oxygen critically low (${oxygenLevel}/20) — surface immediately`;
        }
      }
      candidates.sort((a, b) => b.confidence - a.confidence);
      topCandidate = candidates[0];
      logger.warn('DecisionTree', `[DROWNING PRE-EMPTION] Oxygen=${oxygenLevel} — forcing FLEE`);
    }

    // Environmental Hazard Detection & Counter-Strategy Tagging
    const biomeLower = (agentState.biome || senses.getBiome?.() || '').toLowerCase();
    const isColdBiome = biomeLower.includes('snow') || biomeLower.includes('ice') || biomeLower.includes('frozen') || biomeLower.includes('peak') || biomeLower.includes('cold') || biomeLower.includes('grove');
    const isFreezingRisk = isColdBiome && (stats.health < 20 || (topCandidate.reason || '').toLowerCase().includes('snow') || (topCandidate.reason || '').toLowerCase().includes('freeze'));
    const isFireRisk = senses.isOnFire?.() || agentState.isOnFire || (topCandidate.reason || '').toLowerCase().includes('lava') || (topCandidate.reason || '').toLowerCase().includes('fire');
    const isWaterRisk = isInWaterNow && (stats.health < 16 || oxygenLevel < 15);
    const isMobRisk = (senses.getNearbyHostileMobs?.(8)?.length || 0) >= 2 || (stats.health <= 10 && (senses.getNearbyHostileMobs?.(12)?.length || 0) > 0);

    const isHazard = isFreezingRisk || isFireRisk || isWaterRisk || isMobRisk;
    let hazardType = null;
    let hazardResearchQuery = null;

    if (isFreezingRisk) {
      hazardType = 'powder_snow';
      hazardResearchQuery = 'minecraft powder snow freezing damage counter leather boots';
    } else if (isFireRisk) {
      hazardType = 'lava';
      hazardResearchQuery = 'minecraft lava fire damage water bucket counter';
    } else if (isWaterRisk) {
      hazardType = 'drowning';
      hazardResearchQuery = 'minecraft drowning underwater oxygen torch air pocket counter';
    } else if (isMobRisk) {
      hazardType = 'mob_swarm';
      hazardResearchQuery = 'minecraft hostile mob swarm pillar defense tactics';
    }

    // Society knowledge snapshot (cached ~60s) is only consumed by escalation
    // payloads, so its network calls live inside the escalation branch — they
    // previously ran on every 1s tick even when the decision resolved locally.

    // Self-sufficient local resolution: if escalation has been suppressed for
    // this action (providers were consistently returning fallbacks), bypass the
    // broker entirely and resolve from DT knowledge. Hazards always escalate.
    const suppressedUntil = this._escalationSuppressedUntil.get(topCandidate.name) || 0;
    const isEscalationSuppressed = !isHazard && !isStuckInLoop && (Date.now() < suppressedUntil);

    if (isEscalationSuppressed) {
      logger.info('DecisionTree', `[LOCAL RESOLVE] Escalation suppressed for '${topCandidate.name}' (providers were down). DT resolves locally with confidence ${topCandidate.confidence}.`);
      return {
        action: topCandidate.name,
        confidence: topCandidate.confidence,
        escalated: false,
        source: topCandidate.isDynamic ? 'learned_rule' : 'builtin_rule',
        provider: null,
        model: null,
        cached: false,
        cacheType: null,
        fallback: false,
        costUsd: 0,
        latencyMs: 0,
        reason: `[Local DT — escalation suppressed: providers were down] ${topCandidate.reason || ''}`,
        ruleId: topCandidate.ruleId || topCandidate.meta?.ruleId || null,
        meta: topCandidate,
        allCandidates: candidates.map(c => ({
          name: c.name,
          confidence: c.confidence,
          reason: c.reason || '',
          isDynamic: !!c.isDynamic,
          ruleId: c.ruleId || c.meta?.ruleId || null
        }))
      };
    }

    if (this.confidenceEvaluator.shouldEscalate(topCandidate.confidence) || isStuckInLoop || isHazard) {
      const isResearchNeeded = isHazard || (
        topCandidate.name === 'CRAFT' ||
        topCandidate.name === 'BUILD' ||
        topCandidate.reason?.toLowerCase().includes('unknown') ||
        topCandidate.reason?.toLowerCase().includes('recipe') ||
        topCandidate.reason?.toLowerCase().includes('ingredient') ||
        topCandidate.reason?.toLowerCase().includes('cooldown') ||
        topCandidate.reason?.toLowerCase().includes('fail') ||
        agentState.activeGoal?.toLowerCase().includes('craft') ||
        agentState.activeGoal?.toLowerCase().includes('build')
      );

      const taskType = isStuckInLoop ? 'PLAN' : (isHazard || isResearchNeeded ? 'RESEARCH' : (topCandidate.name === 'TALK' ? 'CHAT' : 'REASONING'));
      const taskHint = isStuckInLoop ? 'PLAN' : (isHazard || isResearchNeeded ? 'RESEARCH' : null);

      // Society snapshot + geography-of-memory: awareness, not instruction —
      // the LLM decides what conventions/pledges/reputation mean for this choice.
      let societyContext = null;
      try {
        const societyAgentId = senses.bot?.username || persona?.agentId || 'Agent';
        const client = SocietyClient.forAgent(societyAgentId);
        societyContext = await client.getContext();

        // Geography that remembers: emotional weight of nearby places colors
        // decisions here. The agent feels the history of the ground it stands on.
        const pos = senses.bot?.entity?.position;
        if (pos && typeof pos.x === 'number') {
          client.setLastPosition(pos.x, pos.z);
          const near = await client.placesNear(pos.x, pos.z, 24);
          if (near.length > 0) societyContext.nearbyPlaceMemories = near;
          // Field observations other settlers logged nearby (cached 30s) — offered as hints,
          // never instructions.
          try {
            const discKey = `${Math.round(pos.x / 32)},${Math.round(pos.z / 32)}`;
            const cachedDisc = this._discoveriesCache.get(discKey);
            const now = Date.now();
            if (cachedDisc && now < cachedDisc.expiry) {
              societyContext.nearbyDiscoveries = cachedDisc.data;
            } else {
              const dRes = await fetch(`${process.env.MEMORY_SERVICE_URL || 'http://localhost:3002'}/api/world/discoveries?x=${Math.round(pos.x)}&z=${Math.round(pos.z)}&radius=64&limit=5`, { signal: AbortSignal.timeout(3000) });
              if (dRes.ok) {
                const discData = (await dRes.json()).discoveries || [];
                societyContext.nearbyDiscoveries = discData;
                this._discoveriesCache.set(discKey, { data: discData, expiry: now + 30000 });
              }
            }
          } catch { /* optional context */ }
        }
      } catch { /* society knowledge is optional */ }

      const payload = {
        agentId: senses.bot?.username || persona?.agentId || 'Agent',
        taskType,
        taskHint,
        isHazard,
        hazardType,
        researchQuery: hazardResearchQuery || null,
        isStuckInLoop,
        stuckWarning: isStuckInLoop ? `You have been looping on '${topCandidate.name}' for multiple cycles without finding trees/progress. Think like a real human player: break this loop. Formulate a multi-step objective, head towards high elevation/vantage point, punch tall grass for seeds, search near rivers, or find companions.` : null,
        topCandidate,
        allCandidates: candidates.slice(0, 15).map(c => ({
          name: c.name,
          confidence: c.confidence,
          reason: c.reason || '',
          isDynamic: !!c.isDynamic
        })),
        stats,
        // Full environmental context for rich LLM reasoning
        inventory: agentState.inventory || [],
        position: agentState.position || {},
        biome: agentState.biome || 'unknown',
        timeOfDay: agentState.timeOfDay || 'day',
        isNight: agentState.isNight || false,
        isRaining: agentState.isRaining || false,
        activeGoal: agentState.activeGoal || '',
        nearby: {
          players: senses.getNearbyPlayers ? senses.getNearbyPlayers(32).map(p => p.username) : [],
          hostiles: senses.getNearbyHostileMobs ? senses.getNearbyHostileMobs(16).map(m => m.name || m.mobType || 'mob') : [],
          animals: senses.getNearbyPassiveMobs ? senses.getNearbyPassiveMobs(16).map(m => m.name || m.mobType || 'animal') : [],
          ores: senses.getNearbyOres ? senses.getNearbyOres(20).map(b => `${b.name}@Y${b.position.y}`) : [],
          trees: senses.getNearbyTrees ? senses.getNearbyTrees(16).map(b => `${b.name}@Y${b.position.y}`) : [],
          blocks: [
            senses.getNearbyBlock('crafting_table', 8) ? 'crafting_table nearby' : null,
            senses.getNearbyBlock('furnace', 8) ? 'furnace nearby' : null,
            senses.getNearbyBlock('chest', 12) ? 'chest nearby' : null,
            senses.getNearbyBlock('bed', 10) ? 'bed nearby' : null,
            senses.getNearbyBlock('water', 8) ? 'water nearby' : null
          ].filter(Boolean)
        },
        equipment: agentState.equipment || {},
        lightLevel: senses.getLightLevel ? senses.getLightLevel() : 15,
        isUnderground: senses.isUnderground ? senses.isUnderground() : false,
        recentEvents: (agentState.recentDecisions || []).slice(-5).map(d => `${d.action}(${d.source})`).join(' → '),
        lastActionResult: agentState.lastActionResult || null,
        affordances: buildAffordances.build(senses.bot, senses, stats),
        persona: persona?.getPersonaPromptContext ? persona.getPersonaPromptContext() : (persona || {}),
        society: societyContext ? {
          conventions: Object.fromEntries(Object.entries(societyContext.conventions || {}).map(([k, v]) => [k, v.value])),
          openPledges: (societyContext.openPledges || []).slice(0, 8).map(p => `${p.agentId}: ${p.description}`),
          recentNotices: (societyContext.notices || []).slice(0, 4).map(n => `[${n.type}] ${n.title}`),
          reputationHighlights: societyContext.reputationHighlights || [],
          openAccusations: (societyContext.openAccusations || []).slice(0, 4).map(a => `${a.accuser} vs ${a.accused}: theft @${a.chestKey} (${a.evidenceCount} evidence records)`),
          nearbyPlaceMemories: (societyContext.nearbyPlaceMemories || []).map(p => `(${p.x},${p.z}): ${p.label} [feeling: ${p.sentiment}]`),
          nearbyDiscoveries: (societyContext.nearbyDiscoveries || []).map(d => `${d.item} @(${d.x},${d.z}) — seen by ${d.agentId}`)
        } : null,
        innerLife: {
          mood: emo.mood,
          emotions: emo.top(),
          feelings: emo.directedContext(),
          grieving: emo.inGrief(),
          beliefs: beliefs.toContext()
        }
      };

      const escalationResult = await this.escalator.escalate(payload);

      // Plans outrank reflexes: a fresh LLM-authored goal suppresses ambient
      // night-flee for a few minutes so decisions stick instead of snapping back
      // to instinct every tick. Hazard-driven flee is never suppressed.
      if ((escalationResult.newGoal || isStuckInLoop) && !isHazard) {
        evaluateFlee.setFleeCooldown('night', 3 * 60 * 1000);
        logger.info('DecisionTree', '[PLAN COMMITMENT] New goal suppresses ambient night-flee for 3 minutes');
      }

      // Replicate learned decision into local dynamic rule engine and long-term skills.md!
      this.dynamicRuleEngine.learnRule(payload, escalationResult);

      // If a severe hazard counter-strategy was learned, immediately seed into dynamic rules and share with ledger
      if (isHazard && escalationResult.tacticLearned) {
        const memUrl = process.env.MEMORY_SERVICE_URL || 'http://localhost:3002';
        fetch(`${memUrl}/api/ledger/lessons`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: senses.bot?.username || 'Agent',
            lesson: `[Hazard Counter-Strategy: ${hazardType || 'survival'}] ${escalationResult.tacticLearned}`,
            isPublic: true,
            severity: 0.90,
            confidence: 0.85,
            context: { isHazard: true, hazardType }
          })
        }).catch(() => {});
      }

      // Apply emotion updates if returned by LLM
      if (escalationResult.emotionDelta) {
        if (escalationResult.emotionDelta.anger) statsManager.addAnger(escalationResult.emotionDelta.anger);
        if (escalationResult.emotionDelta.happiness) statsManager.addHappiness(escalationResult.emotionDelta.happiness);
        if (escalationResult.emotionDelta.fatigue) statsManager.addFatigue(escalationResult.emotionDelta.fatigue);
      }

      const isCached = !!escalationResult.cached;
      const isFallback = !!escalationResult.fallback;
      const source = isCached ? 'cache' : (isFallback ? 'fallback' : 'llm');

      // ── Provider-down self-sufficiency (Issue A fix) ──────────────────────
      // When the broker returns a fallback (all providers down), do NOT blindly
      // use the broker's stale action — that's what caused the TRADE/TALK loop.
      // Instead: trust the DT's own best non-stuck candidate. The agent has
      // accumulated learned rules from prior LLM interactions; it can act on
      // them without needing live LLM confirmation every tick.
      //
      // Exception: stuck-loop breaks and hazard counter-strategies still use
      // the broker result because those require creative new directions the DT
      // alone can't generate.
      let resolvedAction = escalationResult.action || 'WANDER';
      if (isFallback && !isStuckInLoop && !isHazard) {
        // Track consecutive fallback streak for this action
        const streakKey = topCandidate.name;
        const streak = (this._escalationFallbackStreak.get(streakKey) || 0) + 1;
        this._escalationFallbackStreak.set(streakKey, streak);
        logger.warn('DecisionTree', `[PROVIDER DOWN] Broker returned fallback for '${streakKey}' (streak: ${streak}). DT resolving locally.`);

        // After 3 consecutive fallbacks for same action, suppress escalation
        // for 90s so we stop burning broker round-trips during provider outages.
        if (streak >= 3) {
          this._escalationSuppressedUntil.set(streakKey, Date.now() + 90000);
          this._escalationFallbackStreak.set(streakKey, 0);
          logger.warn('DecisionTree', `[ESCALATION SUPPRESSED] Action '${streakKey}' will resolve locally for 90s (3 consecutive provider-down fallbacks).`);
        }

        // Pick the best non-stuck, non-looping candidate from the DT itself.
        // Prefer a different action than the one that kept triggering escalation.
        const loopedActions = new Set([topCandidate.name, ...(uniqueRecent || [])]);
        const dtFallback = candidates.find(c => !loopedActions.has(c.name) && c.confidence > 0.15)
          || candidates.find(c => c.name !== topCandidate.name && c.confidence > 0.10)
          || topCandidate;
        resolvedAction = dtFallback.name;
        logger.info('DecisionTree', `[LOCAL RESOLVE] Provider-down: using DT candidate '${resolvedAction}' (confidence: ${dtFallback.confidence}) instead of broker fallback '${escalationResult.action}'.`);
      } else if (!isFallback) {
        // Successful LLM response — reset fallback streak for this action.
        this._escalationFallbackStreak.set(topCandidate.name, 0);
        this._escalationSuppressedUntil.delete(topCandidate.name);
      }
      // ── end Issue A fix ───────────────────────────────────────────────────

      // Suppress meta-commentary that leaks from cached LLM reasoning
      const rawChat = escalationResult.chatMessage || null;
      const chatMessage = rawChat && !/Ouch!|Autonomous decision/i.test(rawChat) ? rawChat : null;

      const now = Date.now();
      let finalChat = chatMessage;

      // Global chat cooldown: no more than one chat message per agent per 8 seconds
      if (!this._lastChatSentAt) this._lastChatSentAt = 0;
      if (finalChat && now - this._lastChatSentAt < 8000) {
        finalChat = null;
      }

      // Exact dedup: suppress identical message within 60s
      if (finalChat) {
        const CHAT_DEDUP_MS = 60_000;
        const prev = this._recentChatMessages.get(finalChat);
        if (prev && now - prev < CHAT_DEDUP_MS) {
          finalChat = null;
        } else {
          this._recentChatMessages.set(finalChat, now);
          this._lastChatSentAt = now;
        }
        if (this._recentChatMessages.size > 50) {
          for (const [msg, ts] of this._recentChatMessages) {
            if (now - ts > CHAT_DEDUP_MS) this._recentChatMessages.delete(msg);
          }
        }
      }

      return {
        action: resolvedAction,
        confidence: topCandidate.confidence,
        escalated: true,
        source,
        speaker: payload.speaker || null,
        whisper: !!(payload.privateChat || escalationResult.whisper),
        provider: escalationResult.provider || (isCached ? 'Cache' : isFallback ? 'Local Fallback' : 'Broker'),
        model: escalationResult.model || null,
        cached: isCached,
        cacheType: escalationResult.cacheType || null,
        fallback: isFallback,
        costUsd: typeof escalationResult.costUsd === 'number' ? escalationResult.costUsd : null,
        latencyMs: typeof escalationResult.latencyMs === 'number' ? escalationResult.latencyMs : null,
        webKnowledgeUsed: !!escalationResult.webKnowledgeUsed,
        reason: isFallback && !isStuckInLoop && !isHazard
          ? `[Provider-down local DT] ${resolvedAction} chosen from learned rules — broker unavailable`
          : (escalationResult.reason || (isHazard ? `Autonomous hazard counter-strategy executed for ${hazardType}` : 'Escalated to LLM for autonomous reasoning')),
        tacticLearned: escalationResult.tacticLearned || null,
        chatMessage: finalChat,
        newGoal: escalationResult.newGoal || null,
        steps: escalationResult.steps || null,
        targetResource: escalationResult.targetResource || null,
        buildType: escalationResult.buildType || null,
        tradeOffer: escalationResult.tradeOffer || null,
        meta: {
          ...topCandidate,
          itemToCraft: escalationResult.itemToCraft || topCandidate.itemToCraft,
          targetBlock: topCandidate.targetBlock ? slimBlock(topCandidate.targetBlock) : null,
          threat: topCandidate.threat || null,
          target: topCandidate.target || null
        },
        allCandidates: candidates.map(c => ({
          name: c.name,
          confidence: c.confidence,
          reason: c.reason || '',
          isDynamic: !!c.isDynamic
        }))
      };
    }

    return {
      action: topCandidate.name,
      confidence: topCandidate.confidence,
      escalated: false,
      source: topCandidate.isDynamic ? 'learned_rule' : 'builtin_rule',
      provider: null,
      model: null,
      cached: false,
      cacheType: null,
      fallback: false,
      costUsd: 0,
      latencyMs: 0,
      reason: topCandidate.reason || '',
      ruleId: topCandidate.ruleId || topCandidate.meta?.ruleId || null,
      meta: topCandidate,
      allCandidates: candidates.map(c => ({
        name: c.name,
        confidence: c.confidence,
        reason: c.reason || '',
        isDynamic: !!c.isDynamic,
        ruleId: c.ruleId || c.meta?.ruleId || null
      }))
    };
  }
}

module.exports = DecisionTree;
