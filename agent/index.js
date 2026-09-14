const mineflayer = require('mineflayer');
const { pathfinder, Movements } = require('mineflayer-pathfinder');
const http = require('http');
const config = require('./config');
const logger = require('../shared/logger');
const detailedLogger = require('../shared/detailedLogger');
const Senses = require('./perception/senses');
const EventObserver = require('./perception/events');
const MovementActuator = require('./actuation/movement');
const ChatActuator = require('./actuation/chat');
const CombatActuator = require('./actuation/combat');
const InventoryActuator = require('./actuation/inventory');
const StatsManager = require('./stats/stats');
const StatsDecayEngine = require('./stats/decay');
const RelationshipTracker = require('./stats/relationships');
const DecisionTree = require('./decision/tree');
const EventBuffer = require('./memory/buffer');
const MemoryClient = require('./memory/client');
const BrainClient = require('./brain-client/client');
const DynamicPersona = require('./cognition/persona');
const GoalManager = require('./cognition/goals');
const Gossip = require('./social/gossip');
const SocietyClient = require('./memory/societyClient');

// Goals survive container restarts: every mutation re-POSTs a snapshot to the
// memory service, and the snapshot is restored into a freshly booted agent.
function persistGoalAcrossRestarts(goalManager) {
  const baseUrl = process.env.MEMORY_SERVICE_URL || 'http://localhost:3002';
  const save = () => {
    fetch(`${baseUrl}/api/memory/goal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: goalManager.agentId, snapshot: goalManager.toSnapshot() })
    }).catch(() => {});
  };
  for (const method of ['setGoal', 'setPlan', 'clearPlan', 'markGoalCompleted']) {
    const original = goalManager[method].bind(goalManager);
    goalManager[method] = (...args) => {
      const result = original(...args);
      save();
      return result;
    };
  }
  fetch(`${baseUrl}/api/memory/goal?agentId=${encodeURIComponent(goalManager.agentId)}`)
    .then(r => (r.ok ? r.json() : null))
    .then(data => data?.snapshot && goalManager.restoreFromSnapshot(data.snapshot))
    .catch(() => {});
}
const SocialDialogueEngine = require('./social/dialogue');
const FactionAffiliationManager = require('./social/factions');
const BuilderSkill = require('./skills/builder');
const BarterSkill = require('./skills/barter');
const FarmerSkill = require('./skills/farmer');
const ReflectionEngine = require('./cognition/reflection');
const EmotionalState = require('./cognition/emotions');
const BeliefNetwork = require('./cognition/beliefs');
const { nextCraftingObjective, getCurrentCraftableOptions } = require('./cognition/craftingChain');
const SkillTracker = require('./cognition/skillTracker');
const DeathInvestigator = require('./social/deathInvestigator');
const TaxCollector = require('./social/taxCollector');
const ChunkMemory = require('./cognition/chunkMemory');
const { ACTIONS } = require('../shared/constants');

// Global Error Protections
process.on('uncaughtException', (err) => {
  logger.error('AgentUncaught', 'Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  logger.error('AgentUnhandled', 'Unhandled Rejection:', reason);
});

// ── Live agent state exposed on /status (read by dashboard) ────────────────
let currentBot = null;
let currentPersona = null;
const agentState = {
  username: config.username,
  online: false,
  position: null,
  hasGreeted: false,
  stats: {},
  lastDecision: null,
  activeGoal: null,
  persona: null,
  inventory: [],
  equipment: {},
  biome: 'unknown',
  timeOfDay: 'day',
  isNight: false,
  isRaining: false,
  isInWater: false,
  isOnFire: false,
  recentChat: [],
  recentDecisions: [],
  uptime: 0,
  startedAt: new Date().toISOString()
};

// Lightweight status server (runs continuously for container lifetime)
const statusServer = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/status') {
    agentState.uptime = process.uptime();
    agentState.online = currentBot && currentBot.entity != null;
    agentState.position = (currentBot && currentBot.entity)
      ? { x: Math.round(currentBot.entity.position.x), y: Math.round(currentBot.entity.position.y), z: Math.round(currentBot.entity.position.z) }
      : null;
    res.writeHead(200);
    res.end(JSON.stringify(agentState));
  } else if (req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', username: config.username, online: agentState.online }));
  } else if (req.url === '/personality' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        if (currentPersona && parsed.traits) {
          Object.assign(currentPersona.traits, parsed.traits);
        }
        if (currentPersona && parsed.archetype) {
          currentPersona.archetype = parsed.archetype;
        }
        if (currentPersona && parsed.privacyPreference) {
          currentPersona.setPrivacyPreference(parsed.privacyPreference);
        }
        logger.info('AgentStatus', `Updated live personality for ${config.username}: ${JSON.stringify(currentPersona?.traits)} (Privacy: ${currentPersona?.privacyPreference})`);
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, persona: currentPersona?.getPersonaPromptContext ? currentPersona.getPersonaPromptContext() : currentPersona }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

function announceToDashboard() {
  const dashboardUrl = process.env.DASHBOARD_URL || 'http://civilization-dashboard:3003';
  const statusHost = process.env.STATUS_HOST || process.env.HOSTNAME || 'localhost';
  const statusUrl = process.env.STATUS_URL || `http://${statusHost}:${config.statusPort}`;

  fetch(`${dashboardUrl}/api/dashboard/register-agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: config.username, url: statusUrl })
  }).catch(() => { /* ignore if dashboard is not up yet */ });
}

statusServer.listen(config.statusPort, () => {
  logger.info('AgentStatus', `${config.username} permanent status server on :${config.statusPort}`);
  announceToDashboard();
  setInterval(announceToDashboard, 15000);
  // Inner weather decays on its own clock — feelings fade if not refreshed
  setInterval(() => EmotionalState.forAgent(config.username).decay(), 60000);

  // Periodic self-review: the agent audits its own behavior distribution and
  // corrects imbalances through its own rule-adjustment channel (meta-learning).
  const reviewHours = parseInt(process.env.SELF_REVIEW_INTERVAL_HOURS, 10) || 6;
  setInterval(async () => {
    try {
      const recent = agentState.recentDecisions || [];
      if (recent.length < 40) return;
      const counts = {};
      for (const d of recent.slice(-100)) counts[d.action] = (counts[d.action] || 0) + 1;
      const total = Math.min(100, recent.length);
      const fleeRatio = (counts.FLEE || 0) / total;
      const exploreRatio = (counts.EXPLORE || 0) / total;

      const serviceUrl = process.env.MEMORY_SERVICE_URL || 'http://localhost:3002';
      const adjustments = [];
      if (fleeRatio > 0.45) adjustments.push({ ruleType: 'FLEE', situationPattern: 'self-review: chronic fleeing', recommendedConfidenceDelta: -0.06, reason: `${Math.round(fleeRatio * 100)}% of my last ${total} decisions were FLEE — I am letting fear run my life` });
      if (exploreRatio > 0.5) adjustments.push({ ruleType: 'EXPLORE', situationPattern: 'self-review: aimless wandering', recommendedConfidenceDelta: -0.05, reason: `Half my life lately is wandering with nothing to show` });
      for (const adj of adjustments) {
        await fetch(`${serviceUrl}/api/rules/adjust`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId: config.username, ...adj })
        });
        logger.warn('AgentLoop', `[SELF-REVIEW] ${config.username} self-corrected ${adj.ruleType}: ${adj.reason}`);
      }
    } catch (err) {
      logger.debug('AgentLoop', `Self-review skipped: ${err.message}`);
    }
  }, reviewHours * 60 * 60 * 1000);
});

function createAgent() {
  const bot = mineflayer.createBot({
    host: config.host,
    port: config.port,
    username: config.username,
    version: config.version,
    hideErrors: false
  });
  currentBot = bot;

  bot.loadPlugin(pathfinder);

  // Community plugins: collectblock is CommonJS; auto-eat v5 is ESM-only (dynamic import).
  try {
    const collectBlock = require('mineflayer-collectblock');
    bot.loadPlugin(collectBlock.plugin);
  } catch (cbErr) {
    logger.warn('Agent', `mineflayer-collectblock unavailable: ${cbErr.message}`);
  }
  import('mineflayer-auto-eat')
    .then(async (autoEatModule) => {
      bot.loadPlugin(autoEatModule.loader);
      bot.autoEat.setOpts({ priority: 'foodPoints', bannedFood: ['rotten_flesh', 'spider_eye', 'poisonous_potato'] });
      bot.autoEat.enableAuto();
      logger.info('Agent', 'AutoEat plugin active (foodPoints priority, hazardous foods banned).');
    })
    .catch((aeErr) => {
      logger.warn('Agent', `mineflayer-auto-eat unavailable (${aeErr.message}) — legacy eat logic remains.`);
    });


  // Components instantiation
  const senses = new Senses(bot);
  const events = new EventObserver(bot);
  const movement = new MovementActuator(bot);
  const chat = new ChatActuator(bot);
  const combat = new CombatActuator(bot);
  const inventory = new InventoryActuator(bot);
  const stats = new StatsManager();
  const statsDecay = new StatsDecayEngine(stats, movement);

  // Cognitive & Social Architecture
  const persona = new DynamicPersona(config.username, config.personalitySeed);
  currentPersona = persona;
  // Sync the living persona into memory-service profile.md, which stays a
  // generic template until something overwrites it (agents never called init).
  const memUrl = process.env.MEMORY_SERVICE_URL || 'http://localhost:3002';
  fetch(`${memUrl}/api/memory/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId: config.username, personality: config.personalitySeed, persona: persona.getPersonaPromptContext() })
  })
    .then(r => { if (!r.ok) logger.warn('AgentSync', `Persona init HTTP ${r.status}`); })
    .catch(() => {});
  const goalManager = new GoalManager(config.username, persona);
  persistGoalAcrossRestarts(goalManager);
  const brainClient = new BrainClient(config.brokerUrl);
  const factionManager = new FactionAffiliationManager(config.username, persona);
  factionManager.restoreFromLedger(process.env.MEMORY_SERVICE_URL || 'http://localhost:3002').catch(() => {});

  const memoryClient = new MemoryClient(config.username);
  const relationships = new RelationshipTracker(memoryClient);

  const dialogueEngine = new SocialDialogueEngine(brainClient, persona, goalManager, relationships, factionManager);
  const builder = new BuilderSkill(bot, inventory, movement, goalManager);
  bot.goalManager = goalManager;
  const barter = new BarterSkill(bot, inventory, relationships, chat);
  const farmer = new FarmerSkill(bot, inventory, movement);
  const skillTracker = new SkillTracker(config.username);

  const reflection = new ReflectionEngine(brainClient, persona, memoryClient, chat);
  const decisionTree = new DecisionTree(config.confidenceThreshold, memoryClient, brainClient);
  dialogueEngine.setReflectionEngine(reflection);
  dialogueEngine.setDynamicRuleEngine(decisionTree.dynamicRuleEngine);
  dialogueEngine.setGearObserver(username => senses.getPlayerGearTier(username));
  // Sealed-deal handshake: chat agreements become real barter executions.
  // Guarded by the same per-sender cooldown the chat pipeline uses, so a
  // chatty LLM cannot spam tosses.
  const recentDealAt = new Map();
  dialogueEngine.onTradeAgreed = (partner, deal) => {
    const now = Date.now();
    if (now - (recentDealAt.get(partner) || 0) < 30000) return;
    recentDealAt.set(partner, now);
    logger.info('AgentLoop', `[TRADE HANDSHAKE] ${config.username} executing agreed deal with ${partner}: ${deal.giveCount}x ${deal.giveItem} for ${deal.wantCount}x ${deal.wantItem}`);
    barter.executeTrade(
      partner,
      deal.giveItem, deal.giveCount,
      deal.wantItem || 'cobblestone', deal.wantCount || 1
    ).then(result => {
      if (result?.success) {
        const totalValue = (result.valueGive || 0) + (result.valueWant || 0);
        taxCollector.recordObligation({
          partner, giveItem: deal.giveItem, giveCount: deal.giveCount,
          wantItem: deal.wantItem || 'cobblestone', wantCount: deal.wantCount || 1,
          valueGive: result.valueGive, valueWant: result.valueWant,
          fairnessScore: result.fairnessScore, success: true, totalValue
        });
      }
    }).catch(err => logger.warn('AgentLoop', `Handshake trade failed: ${err.message}`));
  };
  const eventBuffer = new EventBuffer(20, (bufferSnapshot) => {
    memoryClient.flushBuffer(bufferSnapshot);
  });
  const gossip = new Gossip(config.username, bot, memoryClient);
  const deathInvestigator = new DeathInvestigator(config.username, {
    brainClient, relationships, dialogueEngine, eventBuffer, chat, movement, senses, gossip
  });
  const taxCollector = new TaxCollector(config.username, { memoryServiceUrl: process.env.MEMORY_SERVICE_URL || 'http://localhost:3002', chat });
  const chunkMemory = new ChunkMemory(config.username, { memoryServiceUrl: process.env.MEMORY_SERVICE_URL || 'http://localhost:3002' });

  let tickInterval = null;
  let inFlightTick = false;
  let _heapLogCounter = 0;

  // Chat anti-spam: per-sender cooldown and global outgoing throttle
  const chatCooldowns = new Map(); // sender -> last response timestamp
  const AGENT_CHAT_COOLDOWN_MS = 6000;  // min 6s between replies to same sender
  const PLAYER_CHAT_COOLDOWN_MS = 1800; // min 1.8s between replies to player
  let lastOutgoingChat = 0;             // global outgoing chat throttle
  let lastTorchPlacement = 0;            // throttle: min 30s between torch placements (per WANDER/EXPLORE path)
  let lastDiscoveryPost = 0;             // throttle: min 10s between ore-discovery posts
  const lastDeathLessonAt = {};
  const milestoneLessonsRecorded = new Set();
  let lastNearMissLessonAt = 0;
  let lowestRecentHealth = 20;
  let nearMissThreat = null;
  let tickCount = 0;

  function recordCivLesson({ lesson, recommendedAction = null, avoidAction = null, triggerCondition = null, severity = 0.7, context = {} }) {
    if (!lesson) return;
    const serviceUrl = memoryClient?.serviceUrl || process.env.MEMORY_SERVICE_URL || 'http://localhost:3002';
    fetch(`${serviceUrl}/api/ledger/lessons`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: bot.username,
        lesson,
        recommendedAction,
        avoidAction,
        triggerCondition,
        severity,
        baseOpenness: persona?.traits?.openness ?? 0.5,
        effectiveOpenness: 1.0,
        isPublic: true,
        status: 'shared',
        context: {
          deterministic: true,
          recommendedAction,
          avoidAction,
          triggerCondition,
          biome: senses.getBiome?.(),
          timeOfDay: senses.getTimeOfDay?.(),
          ...context
        },
        confidence: 0.75,
        timestamp: Date.now()
      })
    }).catch(() => {});
  }

  const IRON_PLUS_ORES = ['diamond_ore', 'deepslate_diamond_ore', 'gold_ore', 'emerald_ore', 'redstone_ore'];
  const STONE_PLUS_ORES = ['iron_ore', 'deepslate_iron_ore', 'copper_ore', 'deepslate_copper_ore'];

  function hasIronPickOrBetter() {
    return senses.hasItem('iron_pickaxe') || senses.hasItem('diamond_pickaxe') || senses.hasItem('netherite_pickaxe');
  }

  function hasStonePickOrBetter() {
    return senses.hasItem('stone_pickaxe') || hasIronPickOrBetter();
  }

  function preflightValidateDecision(decision) {
    // Tier gate applies to ALL sources (plan steps bypass escalation but still
    // hit this path — Golf looped iron_ore 555x via plan without a stone pick).
    if (decision && decision.action === 'MINE' && decision.targetResource) {
      if (IRON_PLUS_ORES.includes(decision.targetResource) && !hasIronPickOrBetter()) {
        logger.warn('AgentLoop', `[PRE-FLIGHT] MINE ${decision.targetResource} rejected — requires iron pickaxe+. Falling back to local target chain.`);
        delete decision.targetResource;
      } else if (STONE_PLUS_ORES.includes(decision.targetResource) && !hasStonePickOrBetter()) {
        logger.warn('AgentLoop', `[PRE-FLIGHT] MINE ${decision.targetResource} rejected — requires stone pickaxe+. Falling back to local target chain.`);
        delete decision.targetResource;
      }
    }
    // SLEEP daytime guard — applies to ALL sources (learned rules produce
    // high-confidence SLEEP at daytime via hallucinated "sleep heals" belief).
    if (decision && decision.action === 'SLEEP' && !senses.isNight()) {
      logger.warn('AgentLoop', '[PRE-FLIGHT] SLEEP rejected — daytime. Overriding to WANDER.');
      decision.action = 'WANDER';
    }
    if (!decision || decision.escalated !== true) return decision;
    if (decision.action === 'TRADE') {
      const nearbyPlayers = senses.getNearbyPlayers ? senses.getNearbyPlayers(32) : [];
      if (nearbyPlayers.length === 0 && !(decision.tradeOffer || '').match(/from \S+/i)) {
        logger.warn('AgentLoop', '[PRE-FLIGHT] TRADE rejected — no players in range. Falling back.');
        decision.action = decision.allCandidates?.[0]?.name || 'WANDER';
      }
    }
    return decision;
  }

  function planStepToDecision(stepText) {
    const t = String(stepText || '').toLowerCase();
    if (!t) return null;
    const reason = `Plan step: ${stepText}`;

    const craftMatch = t.match(/craft\s+(?:\d+\s+)?([\w_]+)/);
    if (craftMatch) return { action: 'CRAFT', itemToCraft: craftMatch[1], reason };

    const smeltMatch = t.match(/smelt\s+(?:\d+\s+)?([\w_]+)/);
    if (smeltMatch) return { action: 'SMELT', smeltInput: smeltMatch[1], reason };

    if (/mine|dig|chop|collect/.test(t)) {
      const oreMatch = t.match(/(iron|gold|diamond|coal|emerald|redstone|copper)[\s_]?ore/);
      if (oreMatch) return { action: 'MINE', targetResource: `${oreMatch[1]}_ore`, reason };
      if (/log|wood|tree/.test(t)) return { action: 'MINE', targetResource: 'oak_log', reason };
      if (/cobble|stone/.test(t)) return { action: 'MINE', targetResource: 'stone', reason };
      return { action: 'MINE', reason };
    }
    if (/eat|food|hunger/.test(t)) return { action: 'EAT', reason };
    if (/build|shelter|house|wall|tower/.test(t)) return { action: 'BUILD', buildType: 'shelter', reason };
    if (/harvest/.test(t)) return { action: 'HARVEST', reason };
    if (/farm|plant|till/.test(t)) return { action: 'FARM', reason };
    if (/sleep|bed/.test(t)) return { action: 'SLEEP', reason };
    if (/chest|deposit|store/.test(t)) return { action: 'CHEST', reason };
    if (/equip|armor|armour|weapon/.test(t)) return { action: 'EQUIP', reason };
    if (/smelt/.test(t)) return { action: 'SMELT', reason };
    if (/explore|travel|head|find|go to|walk/.test(t)) return { action: 'EXPLORE', reason };
    return null;
  }

  // Random human-like idle behaviours
  function doRandomHumanBehaviour() {    const r = Math.random();
    if (r < 0.15) {
      // Jump
      bot.setControlState('jump', true);
      setTimeout(() => bot.setControlState('jump', false), 250);
    } else if (r < 0.30) {
      // Look at random nearby direction
      const yaw = (Math.random() - 0.5) * Math.PI * 2;
      const pitch = (Math.random() - 0.5) * 0.8;
      bot.look(yaw, pitch, false);
    } else if (r < 0.40) {
      // Swing arm (like inspecting something)
      bot.swingArm();
    } else if (r < 0.50) {
      // Sneak briefly
      bot.setControlState('sneak', true);
      setTimeout(() => bot.setControlState('sneak', false), 600);
    } else if (r < 0.60) {
      // Sprint-step in a random direction
      const dir = ['forward', 'back', 'left', 'right'][Math.floor(Math.random() * 4)];
      bot.setControlState('sprint', true);
      bot.setControlState(dir, true);
      setTimeout(() => {
        bot.setControlState(dir, false);
        bot.setControlState('sprint', false);
      }, 400 + Math.random() * 400);
    }
  }

  // Every 12-30 seconds, do something random to look alive
  setInterval(() => {
    if (!bot.entity || inFlightTick) return;
    doRandomHumanBehaviour();
  }, 12000 + Math.random() * 18000);

  bot.once('spawn', async () => {
    try {
      const pos = bot.entity ? { x: Math.round(bot.entity.position.x), y: Math.round(bot.entity.position.y), z: Math.round(bot.entity.position.z) } : { x: 0, y: 0, z: 0 };
      logger.info('Agent', `${bot.username} spawned at X:${pos.x} Y:${pos.y} Z:${pos.z}`);
      
      detailedLogger.logCognition(bot.username, 'Agent Spawned in World', { position: pos, biome: senses.getBiome(), timeOfDay: senses.getTimeOfDay() });

      const defaultMovements = new Movements(bot);
      bot.pathfinder.setMovements(defaultMovements);

      if (!agentState.hasGreeted) {
        chat.say(`Greetings world! ${bot.username} is awake.`);
        agentState.hasGreeted = true;
      }

      eventBuffer.addEvent('spawn', {
        position: pos,
        biome: senses.getBiome(),
        timeOfDay: senses.getTimeOfDay()
      });

      // Seed dynamic rules from civilization shared lessons (personality-weighted)
      decisionTree.dynamicRuleEngine.seedFromSharedLessons(process.env.MEMORY_SERVICE_URL || 'http://localhost:3002', persona);

      await relationships.loadFromMemory();
      relationships.startAutoSave();

      // Grounded curriculum check: when basics (tools/shelter) are missing,
      // nudge the goal toward the next tech milestone every few minutes.
      // Uses crafting chain planner for full tech tree progression (wood → netherite).
      const curriculumTimer = setInterval(() => {
        try {
          if (Date.now() - (agentState._lastCurriculumAt || 0) < 300000) return;
          const next = nextCraftingObjective(senses);
          const currentDesc = (goalManager.currentGoal?.description || '').toLowerCase();
          const isWhimsical = ['trade', 'mine', 'explore', 'wander', 'talk'].includes(currentDesc.trim());
          if (!next || !isWhimsical) return;
          agentState._lastCurriculumAt = Date.now();
          goalManager.setGoal(next.objective, { source: 'crafting-chain', phase: next.phase, chain: next.chain });
          chat.say(`new mission: ${next.objective}`);
          eventBuffer.addEvent('newGoal', { ...next, source: 'curriculum' });
        } catch { /* curriculum is advisory */ }
      }, 120000);
      curriculumTimer.unref?.();

      // Emergent professions: dominant action over time becomes a social role.
      let lastAnnouncedRole = null;
      const professionTimer = setInterval(() => {
        try {
          const tally = agentState.actionTally || {};
          const total = Object.values(tally).reduce((a, b) => a + b, 0);
          if (total < 40) return;
          const [topAction, count] = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
          if (count / total < 0.4) return;
          const ROLE_NAMES = {
            MINE: 'Miner', EXPLORE: 'Scout', WANDER: 'Scout',
            TRADE: 'Merchant', TALK: 'Diplomat', FARM: 'Farmer',
            CRAFT: 'Artisan', BUILD: 'Builder', FIGHT: 'Guard',
            FLEE: 'Wanderer', COOK: 'Cook'  // FLEE/COOK were missing — profession never announced for these
          };
          const role = ROLE_NAMES[topAction];
          if (role && role !== persona.emergentRole) {
            logger.info('AgentLoop', `[PROFESSION] ${bot.username} has specialized as a ${role} (${count}/${total} actions)`);
            detailedLogger.logCognition(bot.username, `Profession emerged: ${role}`, { topAction, share: Number((count / total).toFixed(2)) });
            eventBuffer.addEvent('professionShift', { role, topAction });
            // Announce BEFORE setting emergentRole — the old order set it first,
            // making (role !== persona.emergentRole) always false on subsequent checks.
            if (lastAnnouncedRole !== role && Date.now() - lastOutgoingChat > 10000) {
              lastAnnouncedRole = role;
              lastOutgoingChat = Date.now();
              chat.say(`I've found my calling — I'm the settlement's ${role.toLowerCase()} now.`);
            }
            persona.emergentRole = role;
          }
        } catch { /* profession tracking is advisory */ }
      }, 90000);
      professionTimer.unref?.();

      // Bug 3 (trait scarring): 60s survival recovery timer — if the agent stays alive
      // for a full minute, ambition recovers +0.01 and caution relaxes −0.005 (daily cap).
      // Works alongside milestone recovery (completed_craft/trade/build in executeDecision).
      let _lastDeathTimestamp = 0;
      events.on('agentDeath', () => { _lastDeathTimestamp = Date.now(); });
      const traitRecoveryTimer = setInterval(() => {
        try {
          if (Date.now() - _lastDeathTimestamp > 60000) {
            persona.recoverTraits('survived_minute');
          }
        } catch { /* recovery is advisory */ }
      }, 60000);
      traitRecoveryTimer.unref?.();

      // Heap watchdog: samples RSS/heap growth every 2s. If heap approaches
      // the V8 cap we exit(0) CLEANLY — docker restarts a fresh process with
      // zero crash side-effects — and the growth log names what is leaking.
      let _lastHeapLog = 0;
      const heapTimer = setInterval(() => {
        try {
          const mu = process.memoryUsage();
          const mb = n => Math.round(n / 1048576);
          const now = Date.now();
          if (now - _lastHeapLog > 30000) {
            _lastHeapLog = now;
            let spaces = '';
            try {
              // Space breakdown only when heap is elevated — pinpoints leak vs churn.
              if (mu.heapUsed > 200 * 1048576) {
                const v8 = require('v8');
                spaces = ' spaces={' + v8.getHeapSpaceStatistics().map(s => `${s.space_name}:${mb(s.space_used_size)}`).join(' ') + '}';
              }
            } catch { /* diagnostics best-effort */ }
            logger.info('AgentLoop', `[HEAP] rss=${mb(mu.rss)}MB heapUsed=${mb(mu.heapUsed)}MB external=${mb(mu.external)}MB arrayBuffers=${mb(mu.arrayBuffers)}MB${spaces}`);
          }
          if (mu.heapUsed > 420 * 1048576 || mu.rss > 750 * 1048576) {
            logger.error('AgentLoop', `[HEAP WATCHDOG] heapUsed=${mb(mu.heapUsed)}MB rss=${mb(mu.rss)}MB — clean restart`);
            detailedLogger.logCognition(bot.username, 'Clean restart triggered by heap watchdog');
            process.exit(0);
          }
        } catch { /* watchdog must never throw */ }
      }, 2000);
      heapTimer.unref?.();

      process.on('warning', (warn) => {
        if (warn.name === 'JS heap near memory limit' || (warn.message && warn.message.includes('heap'))) {
          logger.error('AgentLoop', `[HEAP WARNING] ${warn.message} — clean exit`);
          process.exit(0);
        }
      });

      const _shutdownFlush = () => { relationships.shutdown(); };
      process.on('SIGTERM', _shutdownFlush);
      process.on('SIGINT', _shutdownFlush);

      try {
        const { spawn } = require('child_process');
        const _memMon = spawn(process.execPath, [
          require('path').join(__dirname, 'mem-mon.js'),
          String(process.pid)
        ], { stdio: ['ignore', 'pipe', 'pipe'] });
        _memMon.stderr.on('data', (d) => process.stderr.write(d));
        _memMon.on('exit', () => {});
        _memMon.unref();
      } catch {}

      // Main Agent Loop (Tick-based with agent-staggered start to prevent API congestion)
      const staggerDelay = config.username === 'Agent_Alpha' ? 0 : config.username === 'Agent_Beta' ? 350 : 700;
      setTimeout(() => {
        tickInterval = setInterval(async () => {
          // Out-of-band swim interrupt: runs unconditionally BEFORE inFlightTick guard.
          // Keeps agents surfacing even during COOK/MINE/broker-await; the FLEE case in
          // executeDecision only runs when FLEE is the chosen action — this covers all others.
          if (senses.isInWater?.() && (bot.oxygenLevel ?? 20) < 12) {
            movement.swimToSurface();
          }

          if (inFlightTick) return;
          inFlightTick = true;

          const mu = process.memoryUsage();
          if (mu.rss > 750 * 1048576 || mu.heapUsed > 420 * 1048576) {
            logger.error('AgentLoop', `[IN-TICK GUARD] rss=${Math.round(mu.rss / 1048576)}MB heap=${Math.round(mu.heapUsed / 1048576)}MB — clean exit`);
            process.exit(0);
          }
          if (_heapLogCounter++ % 3 === 0) {
            logger.info('AgentLoop', `[HEAP-TICK ${_heapLogCounter}] heap=${Math.round(mu.heapUsed / 1048576)}MB rss=${Math.round(mu.rss / 1048576)}MB`);
          }

          try {
            // 1. Sync MC stats
          stats.updateHealth(bot.health);
          stats.updateHungerFromMC(bot.food);

          // 1b. Near-miss survival lesson detection
          const curHp = bot.health ?? 20;
          const curOxygen = bot.oxygenLevel ?? 20;
          const nearHostilesCount = typeof senses.getNearbyHostileMobs === 'function'
            ? (senses.getNearbyHostileMobs(12) || []).length : 0;
          if (curHp <= 6 || (senses.isInWater?.() && curOxygen <= 6)) {
            lowestRecentHealth = Math.min(lowestRecentHealth, curHp);
            if (nearHostilesCount > 0) nearMissThreat = 'mob attack';
            else if (senses.isInWater?.() || curOxygen <= 6) nearMissThreat = 'drowning';
            else if (senses.isOnFire?.()) nearMissThreat = 'fire';
            else nearMissThreat = 'hazard';
          } else if (curHp >= 14 && lowestRecentHealth <= 6 && nearMissThreat) {
            const now = Date.now();
            if (now - lastNearMissLessonAt > 300000) {
              lastNearMissLessonAt = now;
              const threatLabel = nearMissThreat;
              recordCivLesson({
                lesson: `Survived near-death ${threatLabel} at critical health (${lowestRecentHealth}/20) — retreating to safe ground and regenerating health preserved life.`,
                recommendedAction: 'FLEE',
                avoidAction: 'FIGHT',
                triggerCondition: 'low_health_critical',
                severity: 0.75,
                context: { lowestHealth: lowestRecentHealth, threatType: nearMissThreat }
              });
              logger.info('AgentLoop', `[NEAR-MISS LESSON] Recorded survival lesson from ${threatLabel} (low HP: ${lowestRecentHealth})`);
            }
            lowestRecentHealth = 20;
            nearMissThreat = null;
          }

          // 1c. Record current position in chunk memory
          if (bot.entity?.position) {
            chunkMemory.recordPosition(bot.entity.position.x, bot.entity.position.y, bot.entity.position.z);
          }

          // 1d. Spread gossip if buffer has rumors
          gossip.spread().catch(() => {});
          gossip.decay();

          // 2. Run local stats decay tick
          statsDecay.tick();

          if (goalManager.getActivePlan()) {
            const planMu = process.memoryUsage();
            if (planMu.heapUsed > 320 * 1048576) {
              logger.warn('AgentLoop', `[PLAN GUARD] heap=${Math.round(planMu.heapUsed / 1048576)}MB — clearing plan to avoid OOM from pathfinding`);
              goalManager.clearPlan('heap pressure');
            } else {
              const plan = goalManager.getActivePlan();
              const stepText = goalManager.getCurrentPlanStep();
              const planDecision = planStepToDecision(stepText);

              if (!planDecision) {
                goalManager.advancePlan();
              } else {
                logger.info('AgentLoop', `[PLAN ${plan.idx + 1}/${plan.steps.length}] "${stepText}"`);
                const beforeOk = agentState.lastActionResult;
                await withTimeout(executeDecision({ ...planDecision, escalated: false, source: 'plan' }), `planStep(${stepText})`);
                const outcome = agentState.lastActionResult;

                if (outcome && outcome !== beforeOk && outcome.ok === false) {
                  goalManager.failCurrentStep();
                  if (plan.consecutiveFailures >= 2) {
                    goalManager.clearPlan('2 consecutive failures');
                  }
                } else {
                  goalManager.advancePlan();
                  if (!goalManager.getActivePlan()) {
                    goalManager.markGoalCompleted('plan steps complete');
                  }
                }

                detailedLogger.logCognition(bot.username, `Plan tick: ${stepText}`, { ok: outcome ? outcome.ok : null });
                return;
              }
            }
          }

          // 3. Evaluate Decision Tree (with full agentState context for LLM)
          let decision;
          try {
            decision = await withTimeout(decisionTree.evaluate(senses, stats, persona, agentState), 'decisionTree.evaluate');
            const _muAfterDT = process.memoryUsage();
            logger.info('AgentLoop', `[HEAP-POST-DT] heap=${Math.round(_muAfterDT.heapUsed / 1048576)}MB rss=${Math.round(_muAfterDT.rss / 1048576)}MB`);
          } catch (dtErr) {
            logger.error('AgentLoop', `DecisionTree evaluation failed: ${dtErr.message}`);
            decision = { action: 'WANDER', reason: 'DecisionTree timeout fallback', confidence: 0.5, escalated: false };
          }
          preflightValidateDecision(decision);

          // ── Update live state for /status endpoint ──────────────────────
          agentState.stats       = stats.getSummary();
          agentState.lastDecision = { ...decision, timestamp: new Date().toISOString() };
          agentState.activeGoal  = goalManager.currentGoal.description;
          const decisionSource = (decision.source === 'builtin_rule' || decision.source === 'learned_rule')
            ? 'tree'
            : (decision.source || (decision.escalated ? 'llm' : 'tree'));

          agentState.recentDecisions.push({
            ts: new Date().toISOString(),
            action: decision.action,
            source: decisionSource,
            ruleId: decision.ruleId || decision.meta?.ruleId || null,
            confidence: decision.confidence ?? null,
            provider: decision.provider || null,
            model: decision.model || null,
            cached: !!decision.cached,
            cacheType: decision.cacheType || null,
            fallback: !!decision.fallback,
            latencyMs: decision.latencyMs ?? null,
            reason: (decision.reason || '').substring(0, 200),
            costUsd: typeof decision.costUsd === 'number' ? decision.costUsd : null
          });
          if (agentState.recentDecisions.length > 100) agentState.recentDecisions.shift();
          agentState.persona     = persona.getPersonaPromptContext ? persona.getPersonaPromptContext() : { seed: persona.seed, traits: persona.traits };
          agentState.skills      = skillTracker.toContext();
          agentState.inventory   = inventory.listInventory();
          agentState.equipment   = senses.getEquipmentSummary();
          agentState.biome       = senses.getBiome();
          agentState.timeOfDay   = senses.getTimeOfDay();
          agentState.isNight     = senses.isNight();
          agentState.isRaining   = senses.isRaining();
          agentState.isInWater   = senses.isInWater();
          agentState.isOnFire    = senses.isOnFire();
          agentState.position    = bot.entity ? {
            x: Math.round(bot.entity.position.x),
            y: Math.round(bot.entity.position.y),
            z: Math.round(bot.entity.position.z)
          } : {};
          agentState.exploration = chunkMemory.toContext();
          agentState.pendingInvestigation = deathInvestigator.getPendingInvestigation();
          agentState.pendingTaxObligations = taxCollector.getPendingObligations();
          // ───────────────────────────────────────────────────────────────

          detailedLogger.logCognition(bot.username, `Tick Decision: ${decision.action}`, {
            confidence: decision.confidence,
            escalated: decision.escalated,
            stats: stats.getSummary(),
            activeGoal: goalManager.currentGoal.description
          });

          if (decision.newGoal && typeof goalManager.setGoal === 'function') {
            goalManager.setGoal(decision.newGoal);
            agentState.activeGoal = decision.newGoal;
          }

          // Apply dynamic emotional shifts returned by LLM
          if (decision.emotionDelta) {
            if (decision.emotionDelta.anger) stats.addAnger(decision.emotionDelta.anger);
            if (decision.emotionDelta.happiness) stats.addHappiness(decision.emotionDelta.happiness);
            if (decision.emotionDelta.fatigue) stats.addFatigue(decision.emotionDelta.fatigue);
          }

          if (decision.chatMessage && (Date.now() - lastOutgoingChat > 3000)) {
            lastOutgoingChat = Date.now();
            // Secrets stay private: whisper flag routes the reply to the sender alone
            if (decision.whisper && decision.speaker && typeof chat.bot?.whisper === 'function') {
              chat.bot.whisper(decision.speaker, decision.chatMessage);
              logger.info('AgentLoop', `[WHISPER] -> ${decision.speaker}: "${decision.chatMessage.slice(0, 60)}"`);
            } else {
              chat.say(decision.chatMessage);
            }
          }

          // Cancel combat loop if no longer fighting
          if (decision.action !== 'FIGHT' && combat.target) {
            combat.stopCombat();
          }

          const _preExecMu = process.memoryUsage();
          if (_preExecMu.rss > 750 * 1048576 || _preExecMu.heapUsed > 420 * 1048576) {
            logger.error('AgentLoop', `[PRE-EXEC GUARD] rss=${Math.round(_preExecMu.rss / 1048576)}MB heap=${Math.round(_preExecMu.heapUsed / 1048576)}MB — clean exit`);
            process.exit(0);
          }

          await executeDecision(decision);
          const _muAfterExec = process.memoryUsage();
          logger.info('AgentLoop', `[HEAP-POST-EXEC ${decision.action}] heap=${Math.round(_muAfterExec.heapUsed / 1048576)}MB rss=${Math.round(_muAfterExec.rss / 1048576)}MB`);
        } catch (err) {
          logger.error('AgentLoop', 'Error in agent tick loop:', err);
        } finally {
          inFlightTick = false;
        }
      }, 1000);
    }, staggerDelay);
  } catch (spawnErr) {
    logger.error('AgentSpawn', 'Error during agent spawn initialization:', spawnErr);
  }
});

  // Action executor based on decision tree output
  let _lastEquipMs = 0;
  const EQUIP_COOLDOWN_MS = 15000; // Don't re-equip more than once per 15s

  // Prevent any single action from permanently blocking the tick loop.
  // If an await (pathfinding, collectBlock, digBlock, LLM call) never
  // resolves, inFlightTick stays true and ALL subsequent ticks silently
  // skip — the agent appears alive but does nothing.  A timeout rejects
  // the promise so the tick loop can recover on the next cycle.
  const ACTION_TIMEOUT_MS = 15000;
  function withTimeout(promise, label) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`ActionTimeout: ${label} exceeded ${ACTION_TIMEOUT_MS}ms`)), ACTION_TIMEOUT_MS);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  async function executeDecision(decision) {
    let actionSuccess = false;
    let execErrorDetail = null;
    try {
      switch (decision.action) {
        case ACTIONS.EAT:
          logger.info('AgentLoop', 'Executing EAT action');
          try {
            await withTimeout(inventory.eatFood(stats.health, stats.hunger), 'eatFood');
          } catch (eatErr) {
            logger.debug('AgentLoop', `eatFood failed (${eatErr.message})`);
          }
          eventBuffer.addEvent('eatFood', { health: stats.health, hunger: stats.hunger });
          actionSuccess = true;
          break;

        case ACTIONS.FLEE:
        case 'FLEE': {
          // Submerged: oxygen outranks mobs — surface before anything else.
          // Pathfinder never ascends on its own, so fleeFrom/goToShelter
          // drown the bot while fleeing horizontally.
          if (senses.isInWater?.()) {
            logger.info('AgentLoop', `Executing FLEE swim-to-surface (oxygen=${bot.oxygenLevel ?? 20})`);
            movement.swimToSurface();
            eventBuffer.addEvent('flee', { mode: 'swim_surface', oxygen: bot.oxygenLevel ?? 20 });
            actionSuccess = true;
            break;
          }
          movement.releaseSwim();
          // Resolve threat: prefer rule meta, else auto-pick nearest hostile from senses
          let fleeThreat = decision.meta?.threat;
          if (!fleeThreat) {
            const nearHostiles = senses.getNearbyHostileMobs(16);
            fleeThreat = nearHostiles.length > 0 ? nearHostiles[0] : null;
          }
          if (fleeThreat) {
            logger.info('AgentLoop', `Executing FLEE from ${fleeThreat.name || 'threat'}`);
            movement.fleeFrom(fleeThreat);
            eventBuffer.addEvent('flee', { threat: fleeThreat.name || 'hostile' });
            actionSuccess = true;
          } else {
            const invItems = bot.inventory?.items() || [];
            const invCounts = {};
            for (const item of invItems) {
              invCounts[item.name] = (invCounts[item.name] || 0) + item.count;
            }
            const hasAnyBlocks = ['oak_planks','spruce_planks','birch_planks','cobblestone','stone_bricks','dirt','sand']
              .some(b => (invCounts[b] || 0) >= 4);
            const hasLogs = (invCounts['oak_log'] || invCounts['spruce_log'] || invCounts['birch_log'] || 0) >= 1;
            const nearbyTree = senses.getNearbyBlock?.('log', 16);

            if (hasAnyBlocks) {
              try {
                const buildResult = await withTimeout(builder.buildShelter(), 'emergencyBuildShelter');
                eventBuffer.addEvent('flee', { mode: 'emergency_build', built: buildResult });
                actionSuccess = true;
              } catch (buildErr) {
                logger.debug('AgentLoop', `emergency shelter build failed: ${buildErr.message}`);
                const shelterResult = movement.goToShelter();
                eventBuffer.addEvent('flee', { mode: 'shelter', committed: shelterResult.committed });
                actionSuccess = true;
              }
            } else if (hasLogs) {
              const craftTable = senses.getNearbyBlock('crafting_table', 8);
              if (craftTable) {
                try {
                  await withTimeout(inventory.craftItem('oak_planks', 4), 'craftPlanksEmergency');
                  const buildResult = await withTimeout(builder.buildShelter(), 'emergencyBuildFromPlanks');
                  eventBuffer.addEvent('flee', { mode: 'craft_and_build', built: buildResult });
                  actionSuccess = true;
                } catch (craftErr) {
                  logger.debug('AgentLoop', `emergency craft+build failed: ${craftErr.message}`);
                  const digResult = await movement.emergencyDigIn();
                  eventBuffer.addEvent('flee', { mode: 'dig_in', ...digResult });
                  actionSuccess = true;
                }
              } else {
                const digResult = await movement.emergencyDigIn();
                eventBuffer.addEvent('flee', { mode: 'dig_in_no_table', ...digResult });
                actionSuccess = true;
              }
            } else if (nearbyTree) {
              try {
                await withTimeout(inventory.digBlock(nearbyTree), 'emergencyChopTree');
                eventBuffer.addEvent('flee', { mode: 'emergency_chop', block: nearbyTree.name });
                actionSuccess = true;
              } catch (chopErr) {
                logger.debug('AgentLoop', `emergency tree chop failed: ${chopErr.message}`);
                const digResult = await movement.emergencyDigIn();
                eventBuffer.addEvent('flee', { mode: 'dig_in_chop_fail', ...digResult });
                actionSuccess = true;
              }
            } else {
              const digResult = await movement.emergencyDigIn();
              eventBuffer.addEvent('flee', { mode: 'dig_in_last_resort', ...digResult });
              actionSuccess = true;
            }
            if (!actionSuccess) {
              const shelterResult = movement.goToShelter();
              eventBuffer.addEvent('flee', { mode: 'shelter_fallback', committed: shelterResult.committed });
              actionSuccess = true;
            }
          }
          break;
        }

        case ACTIONS.FIGHT:
        case 'FIGHT': {
          // Resolve target: prefer rule meta, else auto-pick nearest hostile
          let fightTarget = decision.meta?.target;
          if (!fightTarget) {
            const nearHostiles = senses.getNearbyHostileMobs(12);
            fightTarget = nearHostiles.length > 0 ? nearHostiles[0] : null;
          }
          if (fightTarget) {
            logger.info('AgentLoop', `Executing FIGHT vs ${fightTarget.name || fightTarget.mobType || 'hostile'}`);
            try {
              await withTimeout(combat.equipBestWeapon(), 'equipWeapon');
            } catch (equipErr) {
              logger.debug('AgentLoop', `equipBestWeapon failed (${equipErr.message})`);
            }
            combat.attack(fightTarget);
            eventBuffer.addEvent('fight', { target: fightTarget.name || 'hostile' });
            actionSuccess = true;
          } else {
            logger.debug('AgentLoop', 'FIGHT requested but no hostile in range');
            actionSuccess = false;
          }
          break;
        }

        case ACTIONS.SLEEP:
        case 'SLEEP': {
          const bedBlock = decision.meta?.bed || senses.getNearbyBed(20);
          if (bedBlock) {
            logger.info('AgentLoop', 'Executing SLEEP action');
            detailedLogger.logCognition(bot.username, 'Entering bed to sleep', { bedPos: bedBlock.position });
            try {
              await bot.sleep(bedBlock);
              eventBuffer.addEvent('sleep', { bedPos: bedBlock.position, ok: true });
              actionSuccess = true;
            } catch (sleepErr) {
              logger.warn('AgentLoop', `Sleep failed: ${sleepErr.message}`);
              eventBuffer.addEvent('sleep', { bedPos: bedBlock.position, ok: false, error: sleepErr.message });
              actionSuccess = false;
            }
          } else {
            logger.debug('AgentLoop', 'SLEEP requested but no bed found');
            actionSuccess = false;
          }
          break;
        }

        case ACTIONS.CRAFT:
        case 'CRAFT': {
          const item = decision.itemToCraft || decision.meta?.itemToCraft;
          const count = decision.meta?.count || 1;
          if (item) {
            logger.info('AgentLoop', `Executing CRAFT action: ${count}x ${item}`);
            let success = false;
            try {
              success = await withTimeout(inventory.craftItem(item, count), `craftItem(${item})`);
            } catch (craftErr) {
              logger.debug('AgentLoop', `craftItem failed (${craftErr.message})`);
            }
            if (success) {
              eventBuffer.addEvent('craftItem', { item, count });
              EmotionalState.forAgent(bot.username).appraise('craft_success', {}, persona?.traits || {});
              BeliefNetwork.forAgent(bot.username).learnFrom('craft_success', {});
              persona.recoverTraits('completed_craft');
              actionSuccess = true;

              // Tool Progression & Crafting Milestone Lessons
              if (item === 'wooden_pickaxe' && !milestoneLessonsRecorded.has('craft_wooden_pickaxe')) {
                milestoneLessonsRecorded.add('craft_wooden_pickaxe');
                recordCivLesson({
                  lesson: 'Crafted wooden pickaxe — foundational first tool that allows mining stone and gathering cobblestone.',
                  recommendedAction: 'MINE',
                  triggerCondition: 'has_wooden_pickaxe',
                  severity: 0.55
                });
              } else if (item === 'stone_pickaxe' && !milestoneLessonsRecorded.has('craft_stone_pickaxe')) {
                milestoneLessonsRecorded.add('craft_stone_pickaxe');
                recordCivLesson({
                  lesson: 'Crafted stone pickaxe from cobblestone — allows mining iron ore and significantly speeds up resource gathering.',
                  recommendedAction: 'MINE',
                  triggerCondition: 'has_stone_pickaxe',
                  severity: 0.65
                });
              } else if (item === 'iron_pickaxe' && !milestoneLessonsRecorded.has('craft_iron_pickaxe')) {
                milestoneLessonsRecorded.add('craft_iron_pickaxe');
                recordCivLesson({
                  lesson: 'Crafted iron pickaxe — unlocks mining high-tier ores including diamond, gold, redstone, and deepslate.',
                  recommendedAction: 'MINE',
                  triggerCondition: 'has_iron_pickaxe',
                  severity: 0.75
                });
              } else if ((item.includes('chestplate') || item === 'shield' || item.includes('helmet')) && !milestoneLessonsRecorded.has('craft_armor')) {
                milestoneLessonsRecorded.add('craft_armor');
                recordCivLesson({
                  lesson: `Crafted ${item.replace(/_/g, ' ')} — defensive armor and shields drastically mitigate hostile mob damage in combat.`,
                  recommendedAction: 'FIGHT',
                  triggerCondition: 'has_armor',
                  severity: 0.70
                });
              }
            } else {
              actionSuccess = false;
            }
          } else {
            actionSuccess = false;
          }
          break;
        }

        case ACTIONS.MINE:
        case 'MINE': {
          const targetResource = decision.targetResource || decision.meta?.targetResource;
          let block = decision.meta?.targetBlock;
          if (!block && targetResource) {
            block = senses.getNearbyBlock(targetResource, 32);
          }
          if (!block) {
            // Tier-aware fallback chain: without a stone pickaxe iron/copper
            // drop nothing, so prefer wood/stone first (Golf silent-fail loop).
            const stonePlus = senses.hasItem('stone_pickaxe') || senses.hasItem('iron_pickaxe') || senses.hasItem('diamond_pickaxe') || senses.hasItem('netherite_pickaxe');
            block = senses.getNearbyBlock('log', 24) ||
                    senses.getNearbyBlock('stone', 8) ||
                    senses.getNearbyBlock('coal_ore', 16) ||
                    (stonePlus ? (senses.getNearbyBlock('iron_ore', 16) ||
                      senses.getNearbyBlock('copper_ore', 16)) : null);
          }
          if (block) {
            logger.info('AgentLoop', `Executing MINE action on ${block.name} at X:${block.position.x} Y:${block.position.y} Z:${block.position.z}`);

            // Bug 8: Discovery POST on sight (not just on block-break).
            // Agents that die before mining or lack the right pickaxe never triggered blockBroken,
            // so world_discoveries.json stayed empty. Post immediately when we identify a target.
            if (/ore/.test(block.name) && Date.now() - (agentState._lastDiscoveryPostAt || 0) > 10000) {
              agentState._lastDiscoveryPostAt = Date.now();
              const svcUrl = memoryClient?.serviceUrl || process.env.MEMORY_SERVICE_URL || 'http://localhost:3002';
              fetch(`${svcUrl}/api/world/discoveries`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  agentId: bot.username, blockName: block.name,
                  position: block.position, dimension: 'overworld', source: 'mine_sight'
                })
              }).catch(() => {});
            }
            // digBlock-only: collectBlock plugin task queue leaked heap to OOM
            // (proven by Golf bisect — 0 FATALs vs 5-8 fleet-wide). Manual
            // navigate + equip + dig covers all mining needs.
            let success = false;
            try {
              success = await withTimeout(inventory.digBlock(block), `digBlock(${block.name})`);
            } catch (digErr) {
              logger.debug('AgentLoop', `digBlock failed (${digErr.message})`);
            }
            if (success) {
              eventBuffer.addEvent('mineBlock', { block: block.name, position: block.position });
              actionSuccess = true;
            } else {
              actionSuccess = false;
            }
            // Release detached navigation: timed-out collect/dig tasks keep
            // pathfinder goals + subscribers alive, piling heap until OOM
            // (every FATAL traced to MINE-on-stone). Fire-and-forget cleanup.
            try {
              if (bot.collectBlock && typeof bot.collectBlock.cancelTask === 'function') {
                bot.collectBlock.cancelTask(() => {});
              }
            } catch { /* plugin cleanup best-effort */ }
            try {
              if (bot.pathfinder) {
                bot.pathfinder.stop();
                bot.pathfinder.setGoal(null);
              }
            } catch { /* pathfinder cleanup best-effort */ }
          } else {
            logger.info('AgentLoop', 'No mining block in direct vicinity — wandering to scout new terrain');
            movement.wander(16);
            actionSuccess = false;
          }
          break;
        }

        case 'DIAMOND_SEEK': {
          const pos = bot.entity.position;
          const nearbyDiamond = (senses.getNearbyOres?.(12) || []).find(o => (o.name || '').includes('diamond'));
          let success = false;
          try {
            if (nearbyDiamond) {
              success = await withTimeout(inventory.digBlock(nearbyDiamond), 'diamondDig');
            } else if (pos.y > -55) {
              const below = bot.blockAt(pos.offset(0, -1, 0));
              if (below && (below.name.includes('stone') || below.name.includes('deepslate'))) {
                success = await withTimeout(inventory.digBlock(below), 'diamondDescend');
              } else {
                movement.wander(8);
              }
            } else {
              const wall = senses.getNearbyBlock('deepslate', 5) || senses.getNearbyBlock('stone', 5);
              if (wall) {
                success = await withTimeout(inventory.digBlock(wall), 'diamondTunnel');
              } else {
                movement.wander(8);
              }
            }
          } catch (seekErr) {
            logger.debug('AgentLoop', `DIAMOND_SEEK failed (${seekErr.message})`);
          }
          eventBuffer.addEvent('diamondSeek', { success, y: Math.round(pos.y) });
          actionSuccess = !!success;
          break;
        }

        case 'VILLAGE_SEEK': {
          let success = false;
          try {
            const villagers = (senses.getNearbyPassiveMobs?.(64) || [])
              .filter(e => (e.name || '').toLowerCase().includes('villager') && e.position);
            if (villagers.length > 0) {
              const v = villagers[0].position;
              await withTimeout(movement.goto(v.x, v.y, v.z, 2.5), 'villageApproach');
              success = true;
            } else {
              const heading = agentState.villageHeading;
              const pos = bot.entity.position;
              const dest = heading
                ? { x: pos.x + heading.dx * 100, y: pos.y, z: pos.z + heading.dz * 100 }
                : { x: pos.x + 100, y: pos.y, z: pos.z };
              await withTimeout(movement.goto(dest.x, dest.y, dest.z, 4), 'villageTrek');
              success = true;
            }
            const roadside = senses.getNearbyBlock?.('chest', 10);
            if (roadside) {
              const { VALUABLES } = require('./decision/rules/lootStructure');
              await inventory.openChestAndWithdraw(roadside, VALUABLES);
            }
          } catch (trekErr) {
            logger.debug('AgentLoop', `VILLAGE_SEEK failed (${trekErr.message})`);
          }
          eventBuffer.addEvent('villageSeek', { success });
          actionSuccess = success;
          break;
        }

        case 'LOOT_STRUCTURE': {
          const { VALUABLES } = require('./decision/rules/lootStructure');
          const chest = senses.getNearbyBlock?.('chest', 12) || senses.getNearbyBlock?.('trapped_chest', 12);
          if (!chest) {
            actionSuccess = false;
            break;
          }
          let ok = false;
          try {
            ok = await withTimeout(inventory.openChestAndWithdraw(chest, VALUABLES), 'lootChest');
          } catch (lootErr) {
            logger.debug('AgentLoop', `LOOT_STRUCTURE failed (${lootErr.message})`);
          }
          eventBuffer.addEvent('lootStructure', { success: !!ok, chest: chest.position });
          actionSuccess = !!ok;
          break;
        }

        case 'ENCHANT': {
          const tableBlock = senses.getNearbyBlock?.('enchanting_table', 10);
          const invItems = bot.inventory?.items() || [];
          const gearItem = invItems.find(i => /^(diamond|iron)_(sword|pickaxe|axe|chestplate|helmet|leggings|boots)$/.test(i.name));
          const lapisItem = invItems.find(i => i.name === 'lapis_lazuli');
          if (!tableBlock || !gearItem || !lapisItem) {
            actionSuccess = false;
            break;
          }
          let ok = false;
          try {
            await withTimeout((async () => {
              await movement.goto(tableBlock.position.x, tableBlock.position.y, tableBlock.position.z, 3);
              const table = await bot.openEnchantmentTable(tableBlock);
              try {
                await table.putTargetItem(gearItem);
                await table.putLapis(lapisItem);
                const xp = bot.experience?.level ?? 0;
                let choice = table.enchantments.findIndex(e => e.level <= xp && e.level >= 0);
                if (choice === -1) choice = 0;
                await table.enchant(choice);
                await table.takeTargetItem();
                ok = true;
              } finally {
                try { table.close(); } catch {}
              }
            })(), 'enchantGear');
          } catch (enchErr) {
            logger.debug('AgentLoop', `ENCHANT failed (${enchErr.message})`);
          }
          eventBuffer.addEvent('enchant', { success: ok, gear: gearItem.name });
          actionSuccess = ok;
          break;
        }

        case 'BREED': {
          const { BREED_FOODS } = require('./decision/rules/breed');
          const species = decision.species;
          const foodName = decision.food;
          let ok = false;
          try {
            const pair = (senses.getNearbyPassiveMobs?.(10) || [])
              .filter(a => (a.name || '').toLowerCase().includes(species || '###'))
              .slice(0, 2);
            const foodItem = bot.inventory?.items().find(i => i.name === foodName);
            if (pair.length >= 2 && foodItem && BREED_FOODS[species]?.includes(foodName)) {
              await bot.equip(foodItem, 'hand');
              await bot.activateEntity(pair[0]);
              await bot.activateEntity(pair[1]);
              ok = true;
            }
          } catch (breedErr) {
            logger.debug('AgentLoop', `BREED failed (${breedErr.message})`);
          }
          eventBuffer.addEvent('breed', { success: ok, species });
          actionSuccess = ok;
          break;
        }

        case ACTIONS.TALK:
        case 'TALK': {
          // Always escalate TALK to LLM for authentic personality-driven speech
          require('./decision/rules/talk').markTalkExecuted();
          const isCitizen = n => n && n !== bot.username && !/spectate/i.test(n);
          let talkPartner = decision.meta?.partner;
          if (talkPartner && typeof talkPartner === 'object') {
            talkPartner = talkPartner.username || talkPartner.name || null;
          }
          if (!isCitizen(talkPartner)) {
            talkPartner = (senses.getNearbyPlayers(32) || []).map(p => p.username).find(isCitizen) ||
              (bot.players ? Object.keys(bot.players).filter(isCitizen)[0] : null);
          }
          // Per-partner chatter cooldown — learned TALK rules previously spammed
          // the same target every few seconds.
          if (talkPartner && chatCooldowns.has(talkPartner) && Date.now() - chatCooldowns.get(talkPartner) < 45000) {
            actionSuccess = false;
            break;
          }
          const talkSubject = decision.reason || `What's on your mind as ${persona.title || 'a settler'}?`;
          logger.info('AgentLoop', `Executing autonomous TALK${talkPartner ? ` with ${talkPartner}` : ' (shout to world)'}`);
          let talkReply = null;
          try {
            talkReply = await withTimeout(
              dialogueEngine.processIncomingChat(
                talkPartner || 'World',
                talkSubject,
                {
                  currentTask: decision.action,
                  currentGoal: agentState.activeGoal,
                  stats: stats.getSummary(),
                  skills: skillTracker.toContext(),
                  inventory: (agentState.inventory || []).slice(0, 5).map(i => `${i.count}x ${i.name}`).join(', ')
                }
              ),
              `talk(${talkPartner || 'World'})`
            );
          } catch (talkErr) {
            logger.debug('AgentLoop', `TALK dialogue failed (${talkErr.message})`);
          }
          if (talkReply && Date.now() - lastOutgoingChat > 2000) {
            lastOutgoingChat = Date.now();
            chatCooldowns.set(talkPartner || 'World', Date.now());
            setTimeout(() => chat.say(talkReply), 400 + Math.random() * 800);
          }
          eventBuffer.addEvent('autonomousTalk', { partner: talkPartner, message: talkReply });
          actionSuccess = !!talkReply;
          break;
        }

        case ACTIONS.BUILD:
        case 'BUILD': {
          const buildType = decision.buildType || 'shelter';
          logger.info('AgentLoop', `Executing autonomous BUILD action: ${buildType}`);

          // A memorial is the agent's own choice when a place-memory moves
          // them — one block, placed where they stand. Nothing auto-triggers it.
          if (buildType === 'memorial') {
            const groundBelow = bot.entity?.position ? bot.blockAt(bot.entity.position.offset(0, -1, 0)) : null;
            if (groundBelow) {
              let placed = false;
              try {
                placed = await withTimeout(inventory.placeBlock('torch', groundBelow), 'placeMemorial');
              } catch (placeErr) {
                logger.debug('AgentLoop', `memorial placeBlock failed (${placeErr.message})`);
              }
              if (placed) {
                eventBuffer.addEvent('memorialPlaced', { position: bot.entity.position });
                detailedLogger.logCognition(bot.username, 'Placed a memorial at a meaningful place');
                actionSuccess = true;
              } else {
                actionSuccess = false;
              }
            } else {
              actionSuccess = false;
            }
            break;
          }

          let didBuild = false;
          try {
            if (buildType === 'furnace') {
              const pos = bot.entity?.position;
              if (pos) {
                const furnaceItem = bot.inventory?.items().find(i => i.name === 'furnace');
                if (furnaceItem) {
                  const floor = bot.blockAt(pos.offset(0, -1, 0));
                  const spot = bot.blockAt(pos.offset(1, 0, 0));
                  if (floor && floor.name !== 'air' && spot && spot.name === 'air') {
                    await inventory.placeBlock('furnace', floor);
                    didBuild = true;
                    logger.info('AgentLoop', 'Placed furnace for smelting station');
                  }
                }
              }
            } else if (buildType === 'house' || buildType === 'trading_hall') {
              didBuild = await withTimeout(builder.buildBlueprint(null, buildType), `blueprint(${buildType})`);
              // Broader gate: view-distance 4 = 64 blocks radius; 48 ensures overlap
              const alliesHere = (senses.getNearbyPlayers?.(48) || []).some(p => p.username !== bot.username);
              if (didBuild && buildType === 'house' && alliesHere && !goalManager.activeSharedGoalId) {
                await goalManager.proposeSharedGoal(
                  `Expand our house with walls, torches and beds`,
                  2,
                  [{ item: 'oak_planks', count: 32 }, { item: 'cobblestone', count: 32 }],
                  bot.entity?.position || null,
                  process.env.MEMORY_SERVICE_URL || 'http://localhost:3002'
                );
              }
            } else {
              didBuild = await withTimeout(builder.buildShelter(), `buildShelter(${buildType})`);
            }
          } catch (buildErr) {
            logger.debug('AgentLoop', `buildShelter failed (${buildErr.message})`);
          }
          if (didBuild === true && Date.now() - lastOutgoingChat > 3000) {
            lastOutgoingChat = Date.now();
            chat.say(`just finished building a ${buildType}!`);
          }
          if (didBuild === true && !milestoneLessonsRecorded.has('build_shelter')) {
            milestoneLessonsRecorded.add('build_shelter');
            recordCivLesson({
              lesson: 'Constructed secure shelter with walls and light — blocks hostile mob spawns and guarantees night survival.',
              recommendedAction: 'BUILD',
              triggerCondition: 'night_survival',
              severity: 0.75
            });
          }
          eventBuffer.addEvent('buildShelter', { buildType });
          actionSuccess = didBuild !== false;
          if (didBuild) persona.recoverTraits('completed_build');
          break;
        }

        case ACTIONS.TRADE:
        case 'TRADE': {
          // Parse LLM's freeform trade offer: e.g. '2x dirt for 1x bread from Agent_X'
          const offer = decision.tradeOffer || '';
          const giveMatch = offer.match(/(\d+)x ([\w_]+) for/i);
          const wantMatch = offer.match(/for (\d+)x ([\w_]+)/i);
          if (!offer || (!giveMatch && !wantMatch)) {
            // No real offer from LLM — voice intent socially instead of
            // fake-executing a hardcoded default trade that always fails.
            if (Date.now() - lastOutgoingChat > 3000) {
              lastOutgoingChat = Date.now();
              chat.say(`anyone want to trade? I have stuff to offer`);
            }
            actionSuccess = true;
            break;
          }
          const partnerMatch = offer.match(/from (\S+)/i);
          const tradePartnerRaw = (partnerMatch && partnerMatch[1]) || decision.meta?.partner;
          const tradePartnerStr = typeof tradePartnerRaw === 'object' ? (tradePartnerRaw.username || tradePartnerRaw.name || String(tradePartnerRaw)) : tradePartnerRaw;

          // Bug 5: validate partner against live entities — LLM sometimes returns 'any', 'someone', or
          // biome/generic words from freeform offer text, creating ghost trades with no real player.
          const onlineUsernames = new Set(
            Object.values(bot.entities).filter(e => e.username && e.username !== bot.username).map(e => e.username)
          );
          const tradePartner = (tradePartnerStr && onlineUsernames.has(tradePartnerStr)) ? tradePartnerStr : null;

          const giveItem = giveMatch?.[2] || 'oak_planks';
          const giveCount = parseInt(giveMatch?.[1] || '4');
          const wantItem = wantMatch?.[2] || 'cobblestone';
          const wantCount = parseInt(wantMatch?.[1] || '6');
          if (tradePartner) {
            logger.info('AgentLoop', `Executing TRADE with ${tradePartner}: ${giveCount}x ${giveItem} for ${wantCount}x ${wantItem}`);
            // Approach phase: tosses need proximity. Walk toward the partner
            // first (best-effort, bounded) so trades don't die to distance.
            const partnerEntity = Object.values(bot.entities).find(e => e.username === tradePartner);
            if (partnerEntity?.position && bot.entity?.position &&
                bot.entity.position.distanceTo(partnerEntity.position) > 3.5) {
              try {
                await withTimeout(
                  movement.goto(partnerEntity.position.x, partnerEntity.position.y, partnerEntity.position.z, 2.5),
                  `tradeApproach(${tradePartner})`
                );
              } catch (navErr) {
                logger.debug('AgentLoop', `Trade approach incomplete: ${navErr.message}`);
              }
            }
            let tradeResult = { success: false, reason: 'timeout' };
            try {
              tradeResult = await withTimeout(
                barter.executeTrade(tradePartner, giveItem, giveCount, wantItem, wantCount),
                `executeTrade(${tradePartner})`
              );
            } catch (tradeErr) {
              logger.debug('AgentLoop', `TRADE failed (${tradeErr.message})`);
            }
            // Feed the outcome back: failure drives the decision tree's
            // refractory damping, otherwise a hallucinated offer re-fires
            // every tick (observed: identical trade attempted 3× in 23s).
            actionSuccess = !!tradeResult.success;
            eventBuffer.addEvent('executeTrade', { partner: tradePartner, offer, ok: actionSuccess, reason: tradeResult.reason || null });
            if (tradeResult.success) {
              const totalValue = (tradeResult.valueGive || 0) + (tradeResult.valueWant || 0);
              taxCollector.recordObligation({
                partner: tradePartner, giveItem, giveCount, wantItem, wantCount,
                valueGive: tradeResult.valueGive, valueWant: tradeResult.valueWant,
                fairnessScore: tradeResult.fairnessScore, success: true, totalValue
              });
              const sc = SocietyClient.forAgent(bot.username);
              // Currency trades move through wallets so balances mean something.
              if (factionManager?.recognizedCurrencies?.includes(giveItem)) {
                sc.transfer(tradePartner, giveItem, giveCount, `Trade ${giveCount}x ${giveItem} for ${wantCount}x ${wantItem}`);
              }
              // Paying back in goods clears a matching open IOU automatically.
              sc.getOpenDebts().then(debts => {
                for (const d of debts) {
                  if (d.debtor === bot.username && d.creditor === tradePartner && d.item === giveItem && d.status === 'open' && giveCount >= (d.amount || 1)) {
                    sc.payDebt(d.id);
                    logger.info('AgentLoop', `[DEBT REPAID] ${giveCount}x ${giveItem} to ${tradePartner} cleared IOU ${d.id}`);
                    break;
                  }
                }
              }).catch(() => {});
              if (!milestoneLessonsRecorded.has('trade_deal')) {
                milestoneLessonsRecorded.add('trade_deal');
                recordCivLesson({
                  lesson: `Completed resource trade with ${tradePartner} — mutual exchange accelerates tech progression without duplicate gathering.`,
                  recommendedAction: 'TRADE',
                  triggerCondition: 'player_nearby_tradable',
                  severity: 0.60
                });
              }
            }
              // Bug 5: considerAllianceWith now only runs on confirmed trade success,
              // not on every TRADE attempt. Prevents ghost alliances with 'any'/'someone'.
              if (tradeResult.success && tradePartner) {
                persona.recoverTraits('completed_trade');  // Bug 3: milestone recovery
                factionManager.considerAllianceWith(tradePartner, memoryClient?.serviceUrl || process.env.MEMORY_SERVICE_URL || 'http://localhost:3002').then(announcement => {
                  if (announcement && Date.now() - lastOutgoingChat > 3000) {
                    lastOutgoingChat = Date.now();
                    chat.say(announcement);
                    const chest = (inventory?.claimedChests || [])[inventory.claimedChests.length - 1];
                    if (chest) {
                      SocietyClient.forAgent(bot.username).shareChest(chest.x, chest.y, chest.z, tradePartner);
                      logger.info('AgentLoop', `[CHEST SHARED] Opened storage @ ${chest.x},${chest.y},${chest.z} to ally ${tradePartner}`);
                    }
                  }
                }).catch(() => {});
              }
          } else {
            if (Date.now() - lastOutgoingChat > 3000) {
              lastOutgoingChat = Date.now();
              chat.say(`anyone want to trade? ${offer || 'I have stuff to offer'}`);
            }
            actionSuccess = true;
          }
          break;
        }

        case 'STEAL': {
          const targetName = decision.meta?.target;
          const targetEntity = decision.meta?.targetEntity;
          const stolenItem = decision.meta?.item;
          if (targetName && targetEntity && stolenItem) {
            logger.info('AgentLoop', `Executing STEAL from ${targetName}: ${stolenItem}`);
            try {
              await withTimeout(inventory.stealFromPlayer(targetEntity, stolenItem), `stealFrom(${targetName})`);
              eventBuffer.addEvent('steal', { target: targetName, item: stolenItem });
              gossip.addRumor({ type: 'theft', target: targetName, item: stolenItem, source: 'observed' });
              actionSuccess = true;
            } catch (stealErr) {
              logger.debug('AgentLoop', `STEAL failed (${stealErr.message})`);
              actionSuccess = false;
            }
          } else {
            logger.debug('AgentLoop', 'STEAL requested but no valid target/item');
            actionSuccess = false;
          }
          break;
        }

        case ACTIONS.EXPLORE:
        case 'EXPLORE':
        case ACTIONS.WANDER:
        case 'WANDER': {
          const botPos = bot.entity?.position;

          // Standing beside lethal terrain — step directly away before wandering
          if (botPos && typeof senses.hazardProximity === 'function') {
            const near = senses.hazardProximity(2.5);
            if (near) {
              const away = botPos.minus(near.block.position).normalize().scale(8);
              const target = botPos.plus(away);
              logger.warn('AgentLoop', `Hazard escape: moving away from ${near.block.name} at ${near.distance.toFixed(1)} blocks`);
              movement.goto(target.x, botPos.y, target.z, 2);
              actionSuccess = true;
              break;
            }
          }

          // Dark + underground + carrying torches → light the worksite
          if (
            botPos && botPos.y < 55 &&
            typeof senses.getLightLevel === 'function' &&
            senses.getLightLevel() < 7 &&
            Date.now() - lastTorchPlacement > 30000
          ) {
            const hasTorch = (agentState.inventory || []).some(i => i.name === 'torch');
            const groundBelow = botPos ? bot.blockAt(botPos.offset(0, -1, 0)) : null;
            if (hasTorch && groundBelow) {
              let placed = false;
              try {
                placed = await withTimeout(inventory.placeBlock('torch', groundBelow), 'placeTorch');
              } catch (torchErr) {
                logger.debug('AgentLoop', `torch placeBlock failed (${torchErr.message})`);
              }
              if (placed) {
                lastTorchPlacement = Date.now();
                eventBuffer.addEvent('torchPlaced', { position: { x: botPos.x, y: botPos.y, z: botPos.z } });
              }
            }
          }

          const exploreDist = Math.round(16 + (persona.traits?.ambition || 0.5) * 24);
          movement.wander(exploreDist);
          actionSuccess = true;
          break;
        }

        case 'PLAN': {
          const newGoal = decision.newGoal;
          let planApplied = false;
          if (newGoal && typeof goalManager.setGoal === 'function') {
            goalManager.setGoal(newGoal);
            agentState.activeGoal = newGoal;
            logger.info('AgentLoop', `Agent set new PLAN goal: ${newGoal}`);
            if (Date.now() - lastOutgoingChat > 3000) {
              lastOutgoingChat = Date.now();
              chat.say(`new mission: ${newGoal}`);
            }
            eventBuffer.addEvent('newGoal', { goal: newGoal });
            planApplied = true;
          }
          if (Array.isArray(decision.steps) && decision.steps.length > 0 && typeof goalManager.setPlan === 'function') {
            goalManager.setPlan(decision.steps);
            planApplied = true;
          }
          actionSuccess = planApplied;
          break;
        }

        case 'SMELT': {
          // Find or place furnace, then smelt the indicated raw item
          const smeltInput = decision.smeltInput || decision.meta?.smeltInput;
          logger.info('AgentLoop', `Executing SMELT action${smeltInput ? ': ' + smeltInput : ''}`);
          let furnaceBlock = senses.getNearbyBlock('furnace', 8);
          if (!furnaceBlock) {
            const cobbleCount = inventory.bot?.inventory?.items().filter(i => i.name.includes('cobblestone') || i.name.includes('cobbled')).reduce((s, i) => s + i.count, 0) || 0;
            if (cobbleCount >= 8) {
              try { await withTimeout(inventory.craftItem('furnace', 1), 'craftFurnace'); } catch (_) {}
              const table = senses.getNearbyBlock('crafting_table', 4);
              const placeBase = table ? table.position.offset(1, 0, 0) : bot.entity.position.offset(1, 0, 0);
              const refBlock = bot.blockAt(placeBase.offset(0, -1, 0));
              if (refBlock && refBlock.name !== 'air') {
                try { await withTimeout(inventory.placeBlock('furnace', refBlock, new (require('vec3'))(0, 1, 0)), 'placeFurnace'); } catch (_) {}
                furnaceBlock = senses.getNearbyBlock('furnace', 6);
              }
            }
          }
          if (furnaceBlock) {
            try {
              const furnace = await withTimeout(bot.openFurnace(furnaceBlock), 'openFurnace');
              const smeltableKeywords = ['raw_', 'beef', 'porkchop', 'mutton', 'chicken', 'salmon', 'cod', 'potato', 'clay', 'sand', 'cobblestone'];
              const rawItem = (smeltInput ? bot.inventory?.items().find(i => i.name === smeltInput) : null) ||
                              bot.inventory?.items().find(i => smeltableKeywords.some(k => i.name.includes(k) && !i.name.startsWith('cooked')));
              const fuelItem = bot.inventory?.items().find(i => i.name === 'coal' || i.name === 'charcoal' || i.name.includes('plank') || i.name.includes('log') || i.name === 'stick');
              if (rawItem && fuelItem) {
                await withTimeout(furnace.putInput(rawItem.type, null, Math.min(rawItem.count, 8)), 'furnaceInput');
                await withTimeout(furnace.putFuel(fuelItem.type, null, Math.min(fuelItem.count, 2)), 'furnaceFuel');
                logger.info('AgentLoop', `Loaded furnace: ${rawItem.name} + ${fuelItem.name}`);
                eventBuffer.addEvent('smeltItem', { input: rawItem.name });
                actionSuccess = true;

                if (rawItem.name.includes('iron') && !milestoneLessonsRecorded.has('smelt_iron')) {
                  milestoneLessonsRecorded.add('smelt_iron');
                  recordCivLesson({
                    lesson: 'Smelted raw iron into ingots using furnace and fuel — unlocks the iron tool and armor civilization tier.',
                    recommendedAction: 'CRAFT',
                    triggerCondition: 'has_iron_ingots',
                    severity: 0.70
                  });
                }
              }
              furnace.close();
            } catch (fErr) {
              logger.warn('AgentLoop', `Furnace interaction failed: ${fErr.message}`);
              actionSuccess = false;
            }
          }
          break;
        }

        case 'EQUIP': {
          const now = Date.now();
          if (now - _lastEquipMs < EQUIP_COOLDOWN_MS) {
            logger.debug('AgentLoop', 'EQUIP cooldown active, skipping');
            actionSuccess = true;
            break;
          }
          _lastEquipMs = now;
          logger.info('AgentLoop', 'Executing auto-EQUIP best weapon & armor');
          try {
            await withTimeout(combat.equipBestArmor(), 'equipArmor');
            await withTimeout(combat.equipBestWeapon(), 'equipWeapon');
          } catch (equipErr) {
            logger.debug('AgentLoop', `EQUIP failed (${equipErr.message})`);
          }
          eventBuffer.addEvent('equip', { equipment: senses.getEquipmentSummary() });
          actionSuccess = true;
          break;
        }

        case 'HARVEST': {
          logger.info('AgentLoop', 'Executing HARVEST action via FarmerSkill');
          const didHarvest = await farmer.harvestAndReplant();
          eventBuffer.addEvent('harvest', { success: didHarvest });
          actionSuccess = !!didHarvest;
          break;
        }

        case 'FARM': {
          logger.info('AgentLoop', 'Executing FARM action — tilling and planting crops');
          const didPlant = await farmer.tillAndPlant();
          eventBuffer.addEvent('farm', { success: didPlant });
          actionSuccess = !!didPlant;
          break;
        }

        case 'COOK': {
          logger.info('AgentLoop', 'Executing COOK action — preparing food in furnace');
          const didCook = await farmer.cookFood();
          eventBuffer.addEvent('cook', { success: didCook });
          actionSuccess = !!didCook;
          break;
        }

        case 'CHEST': {
          // Find nearby chest and deposit overflow inventory
          const chestBlock = senses.getNearbyBlock('chest', 12);
          if (chestBlock) {
            logger.info('AgentLoop', 'Executing CHEST action — depositing overflow items');
            const depositItems = (agentState.inventory || [])
              .filter(i => i.count > 16 && !i.name.includes('pickaxe') && !i.name.includes('sword') && !i.name.includes('axe'))
              .map(i => i.name);
            if (depositItems.length > 0) {
              await inventory.openChestAndDeposit(chestBlock, depositItems);
              eventBuffer.addEvent('depositChest', { items: depositItems });
              actionSuccess = true;
            } else {
              logger.info('AgentLoop', 'No overflow to deposit; checking if we need to withdraw anything');
              actionSuccess = false;
            }
          } else {
            logger.info('AgentLoop', 'No nearby chest — wandering to find storage');
            movement.wander(12);
            actionSuccess = false;
          }
          break;
        }

        case 'CONTRIBUTE': {
          const meta = decision.meta || {};
          logger.info('AgentLoop', `Executing CONTRIBUTE action towards shared goal ${meta.goalId} (${meta.count}x ${meta.item})`);
          if (meta.location) {
            await movement.goto(meta.location.x, meta.location.y, meta.location.z, 3);
          }
          if (meta.item && meta.count) {
            await inventory.dropItem(meta.item, meta.count);
            await goalManager.contributeToSharedGoal(meta.goalId, meta.item, meta.count);
            chat.say(`Delivered ${meta.count}x ${meta.item} towards our shared project!`);
            eventBuffer.addEvent('sharedGoalContribution', { goalId: meta.goalId, item: meta.item, count: meta.count });
            actionSuccess = true;
          }
          break;
        }

        case ACTIONS.IDLE:
        case 'DEFEND':
        case 'GUARD': {
          // Hold ground: face threat/partner, sneak to brace. Previously fell
          // through to default (stood still, marked failure 699×).
          const focus = decision.meta?.target || decision.meta?.partner || null;
          const focusEnt = focus?.entity || focus;
          try {
            if (focusEnt?.position) movement.lookAtEntity(focusEnt);
            movement.sneak(true);
            setTimeout(() => movement.sneak(false), 3000);
            eventBuffer.addEvent(decision.action === 'GUARD' ? 'guard' : 'defend', {});
            actionSuccess = true;
          } catch (guardErr) {
            logger.debug('AgentLoop', `${decision.action} failed (${guardErr.message})`);
            actionSuccess = false;
          }
          break;
        }
        case 'HUNT': {
          // Take nearest passive mob down with the combat entry (was default/no-op).
          const prey = (senses.getNearbyPassiveMobs ? senses.getNearbyPassiveMobs(12) : [])[0] || null;
          if (prey) {
            logger.info('AgentLoop', `Executing HUNT vs ${prey.name || 'animal'}`);
            combat.attack(prey);
            eventBuffer.addEvent('hunt', { target: prey.name || 'animal' });
            actionSuccess = true;
          } else {
            logger.debug('AgentLoop', 'HUNT requested but no passive mob in range');
            actionSuccess = false;
          }
          break;
        }
        case 'SCOUT': {
          // Short recon sweep (was default/no-op).
          movement.wander(16);
          eventBuffer.addEvent('scout', {});
          actionSuccess = true;
          break;
        }
        case 'COOPERATE': {
          const partner = (senses.getNearbyPlayers?.(16) || []).map(p => p.username).find(n => n && n !== bot.username) || null;
          if (!partner) {
            logger.debug('AgentLoop', 'COOPERATE requested but nobody nearby');
            actionSuccess = false;
            break;
          }
          try {
            const ent = Object.values(bot.entities).find(e => e.username === partner);
            if (ent?.position && bot.entity?.position && bot.entity.position.distanceTo(ent.position) > 3) {
              await withTimeout(movement.goto(ent.position.x, ent.position.y, ent.position.z, 2.5), `cooperate(${partner})`);
            }
            if (Date.now() - lastOutgoingChat > 3000) {
              lastOutgoingChat = Date.now();
              chat.say(`got your back, ${partner}`);
            }
            eventBuffer.addEvent('cooperate', { partner });
            actionSuccess = true;
          } catch (coopErr) {
            logger.debug('AgentLoop', `COOPERATE failed (${coopErr.message})`);
            actionSuccess = false;
          }
          break;
        }
        case ACTIONS.IDLE:
        default:
          // Do nothing
          break;
      }
    } catch (execErr) {
      logger.error('AgentLoop', `Error executing ${decision.action}:`, execErr);
      actionSuccess = false;
      execErrorDetail = execErr.message;
    } finally {
      // Reinforce or penalize dynamic rule if the action originated from a dynamic rule
      const activeRuleId = decision.ruleId || decision.meta?.ruleId;
      if (activeRuleId && decisionTree?.dynamicRuleEngine) {
        decisionTree.dynamicRuleEngine.reinforceRule(activeRuleId, actionSuccess);
      }
      if (decision.action) {
        agentState.actionTally = agentState.actionTally || {};
        agentState.actionTally[decision.action] = (agentState.actionTally[decision.action] || 0) + 1;
        if (actionSuccess) skillTracker.recordAction(decision.action);
      }
      agentState.lastActionResult = {
        action: decision.action,
        ok: actionSuccess,
        detail: actionSuccess ? '' : (execErrorDetail || 'action reported failure')
      };
      tickCount++;
      if (tickCount % 120 === 0) {
        chunkMemory.persist().catch(() => {});
        // Every ~2 minutes: if an allied agent is nearby and no shared goal
        // is active, propose one — the dialogue path alone never fires because
        // agents never meet close enough for the LLM to chat about goals.
        try {
          if (!goalManager.activeSharedGoalId) {
            const nearbyAllies = (senses.getNearbyPlayers?.(48) || []).filter(p => p.username !== bot.username);
            const alliedPlayer = nearbyAllies.find(p => {
              const rel = relationshipTracker.get(p.username);
              return rel && (rel.trust ?? 50) >= 30;
            });
            if (alliedPlayer) {
              const inv = (bot.inventory?.items() || []).map(i => i.name);
              const hasWood = inv.some(n => n.includes('plank') || n.includes('log') || n.includes('wood'));
              const goalDesc = hasWood
                ? `Gather resources and build a community shelter together near ${bot.entity?.position ? `${Math.round(bot.entity.position.x)}, ${Math.round(bot.entity.position.z)}` : 'our location'}`
                : `Explore together and gather wood for a community shelter`;
              goalManager.proposeSharedGoal(
                goalDesc, 2,
                [{ item: 'oak_planks', count: 32 }, { item: 'cobblestone', count: 16 }],
                bot.entity?.position || null,
                process.env.MEMORY_SERVICE_URL || 'http://localhost:3002'
              );
              logger.info('SocialGoals', `[PERIODIC PROPOSAL] ${bot.username} proposed "${goalDesc}" near ${alliedPlayer.username}`);
            }
          }
        } catch (sgErr) {
          logger.debug('SocialGoals', `Periodic shared goal check failed: ${sgErr.message}`);
        }
      }
    }
  }

  // Perception Event Listeners
  events.on('timeTransition', ({ phase, timeOfDay }) => {
    detailedLogger.logSenses(bot.username, `Time of day phase entered: ${phase}`, { timeOfDay });
    eventBuffer.addEvent('timeTransition', { phase, timeOfDay });
    if (phase === 'night') {
      reflection.runReflection(agentState.recentDecisions, stats.getSummary());
    }
  });
  events.on('agentHurt', async ({ health }) => {
    // Bug 4: snapshot inventory on EVERY damage hit — bot.inventory is cleared
    // before the 'agentDeath' event fires, so hadArmor/hadSword always read false there.
    agentState.lastPreDeathInventory = bot.inventory?.items()?.map(i => ({ name: i.name, count: i.count })) || [];

    stats.addAnger(25);
    stats.addHappiness(-15);
    detailedLogger.logCombat(bot.username, `Agent took damage! Health is now ${health}`, { currentHealth: health });
    eventBuffer.addEvent('agentHurt', { health });

    // Look for who hit us (nearest player or mob within 5 blocks)
    const nearby = senses.getNearbyPlayers(5);
    const nearbyMobs = senses.getNearbyHostileMobs(5);

    // Near-death fear imprint
    if (health <= 6) {
      EmotionalState.forAgent(bot.username).appraise('near_death', {}, persona?.traits || {});
      BeliefNetwork.forAgent(bot.username).learnFrom('near_death', {});
    }

    // Mob grudges: whoever's nearby when it hurts takes the blame
    if (nearbyMobs && nearbyMobs.length > 0) {
      const attackerType = nearbyMobs[0]?.name || nearbyMobs[0]?.mobType;
      if (attackerType) {
        EmotionalState.forAgent(bot.username).feel('anger', 0.15);
        BeliefNetwork.forAgent(bot.username).noteMobGrudge(attackerType, 0.2);
      }
    }

    if (nearby && nearby.length > 0) {
      const attacker = nearby[0];
      if (attacker.entity) {
        bot.lookAt(attacker.entity.position.offset(0, attacker.entity.height || 1.6, 0), true);
      }

      const attackerName = attacker.username || 'someone';

      // Dynamic LLM-generated emotional reaction & shout
      const hurtShout = (msg) => {
        // Broker fallback text must never leak (diagnosed: 'Ouch! Fallback baseline...' spam per hit); 8s cooldown + 60s dedup mirror tree.js
        const now = Date.now();
        if (now - (agentState._lastHurtShoutAt || 0) < 8000) return;
        if (msg === agentState._lastHurtShoutMsg && now - (agentState._lastHurtShoutAt || 0) < 60000) return;
        agentState._lastHurtShoutAt = now;
        agentState._lastHurtShoutMsg = msg;
        chat.say(msg);
      };
      brainClient.escalate({
        taskType: 'EMOTION',
        agentId: bot.username,
        event: 'agentHurt',
        attacker: attackerName,
        health: Math.round(health),
        stats: stats.getSummary(),
        persona: persona.getPersonaPromptContext ? persona.getPersonaPromptContext() : persona
      }).then(res => {
        const fallbackNoise = !!(res && res.fallback);
        const chatMsg = (res && res.chatMessage && !fallbackNoise && !/Ouch!|Autonomous decision/i.test(res.chatMessage)) ? res.chatMessage : null;
        const reasonMsg = (res && res.reason && !fallbackNoise) ? `Ouch! ${res.reason}` : null;
        hurtShout(chatMsg || reasonMsg || `Ouch! Why did you hit me, ${attackerName}?! (HP: ${Math.round(health)}/20)`);
      }).catch(() => {
        hurtShout(`Ow! Watch your swings, ${attackerName}! (HP: ${Math.round(health)}/20)`);
      });

      // Backstep retreat
      movement.fleeFrom(attacker.entity || attacker, 4);
    } else if (nearbyMobs && nearbyMobs.length > 0) {
      const mob = nearbyMobs[0];
      combat.attack(mob);
    }
  });

  events.on('agentOnFire', () => {
    stats.addAnger(30);
    stats.addHappiness(-20);
    detailedLogger.logCombat(bot.username, 'AGENT IS ON FIRE — seeking water');
    eventBuffer.addEvent('onFire', {});
    // Try to run to nearest water to extinguish
    const water = senses.getNearbyWater(24);
    if (water) {
      movement.goto(water.position.x, water.position.y, water.position.z, 1);
    } else {
      movement.wander(8); // move erratically
    }
  });

  events.on('incomingProjectile', ({ name, distance }) => {
    detailedLogger.logCombat(bot.username, `Incoming projectile: ${name} at ${distance}m — dodging`);
    eventBuffer.addEvent('incomingProjectile', { name, distance });
    stats.addAnger(10);
    // Dodge by strafing randomly
    const dodge = Math.random() > 0.5 ? 'left' : 'right';
    bot.setControlState(dodge, true);
    setTimeout(() => bot.setControlState(dodge, false), 400);
  });

  events.on('playerJoined', ({ username }) => {
    detailedLogger.logSenses(bot.username, `Player joined server: ${username}`);
    eventBuffer.addEvent('playerJoined', { username });
    // Casual greeting to joining player (if human player, not another agent, and not spectator bot) with cooldown
    const isBotOrAgent = username.startsWith('Agent_') || username.toLowerCase().includes('spectator') || username.toLowerCase().includes('bot');
    if (username !== bot.username && !isBotOrAgent && Date.now() - lastOutgoingChat > 4000) {
      lastOutgoingChat = Date.now();
      setTimeout(() => chat.say(`Hey ${username}! Welcome.`), 1200 + Math.random() * 1000);
    }
  });

  events.on('playerLeft', ({ username }) => {
    detailedLogger.logSenses(bot.username, `Player left server: ${username}`);
    eventBuffer.addEvent('playerLeft', { username });
  });

  // Witnessing another's death stirs real grief — empathy scaled by bond
  events.on('witnessedDeath', ({ victim, raw }) => {
    const rel = relationships?.get?.(victim);
    const emo1 = EmotionalState.forAgent(bot.username);
    emo1.appraise('witnessed_death', { affinity: rel?.affinity ?? 30 }, persona?.traits || {});
    BeliefNetwork.forAgent(bot.username).learnFrom('witnessed_death');
    if ((rel?.affinity ?? 0) >= 60) {
      logger.warn('AgentLoop', `[GRIEF] ${bot.username} lost someone close: ${victim}`);
    }
    // Crime scene investigation: nearby agents process the death socially
    deathInvestigator.onWitnessedDeath({ victim, raw });
  });

  events.on('agentDeath', ({ position, cause }) => {
    stats.addHappiness(-50);
    stats.addAnger(30);
    detailedLogger.logCombat(bot.username, 'AGENT DIED', { deathPosition: position, cause });

    // ── PvP Consequence: Inventory Loss ────────────────────────────────────
    // Death costs possessions. Everything drops at the death site — the world
    // takes what you carried. Survivors pick through the remains.
    const STARTER_KIT = ['bread', 'wooden_pickaxe', 'wooden_sword'];
    const droppedItems = [];
    try {
      const allItems = bot.inventory?.items() || [];
      for (const item of allItems) {
        if (STARTER_KIT.includes(item.name)) continue;
        try {
          bot.toss(item.type, null, item.count).catch(() => {});
          droppedItems.push({ name: item.name, count: item.count });
        } catch (_) {}
      }
      if (droppedItems.length > 0) {
        detailedLogger.logCombat(bot.username, `Death inventory drop: ${droppedItems.map(i => `${i.count}x ${i.name}`).join(', ')}`);
        eventBuffer.addEvent('inventoryDrop', { items: droppedItems, position });
      }
    } catch (_) {}

    // ── PvP Consequence: Killer Detection ──────────────────────────────────
    // Parse the death cause to identify PvP killers. Minecraft death messages
    // follow patterns like "was slain by Agent_X" or "was shot by Agent_X".
    let killerName = null;
    if (cause) {
      const killerMatch = cause.match(/(?:slain|shot|killed|blown up|finished off) by (\w+)/i);
      if (killerMatch) killerName = killerMatch[1];
    }

    // Store last death position for remote respawn
    agentState.lastDeathPosition = position ? { x: position.x, y: position.y, z: position.z } : null;
    agentState.killedBy = killerName;
    agentState.lastDeathCause = cause || null; // persisted so agentRespawn handler can read it (cause is out of scope there)

    // ── PvP Consequence: Killer Reputation Broadcast ───────────────────────
    // The kill echoes through the social network. Nearby agents hear about it,
    // and the killer's reputation shifts permanently.
    if (killerName && killerName !== bot.username) {
      const serviceUrl = memoryClient?.serviceUrl || process.env.MEMORY_SERVICE_URL || 'http://localhost:3002';

      // Record the kill in the civilization ledger
      fetch(`${serviceUrl}/api/ledger/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'kill',
          killer: killerName,
          victim: bot.username,
          position,
          timestamp: Date.now()
        })
      }).catch(() => {});

      // Apply reputation impact: all nearby agents fear the killer
      const nearbyPlayers = senses.getNearbyPlayers?.(32) || [];
      for (const player of nearbyPlayers) {
        if (player.username === killerName || player.username === bot.username) continue;
        relationships.updateTrust(killerName, -30);
        relationships.updateAffinity(killerName, -20);
      }

      // The victim's own feelings toward the killer crystallize into permanent grudge
      relationships.updateTrust(killerName, -50);
      relationships.updateAffinity(killerName, -40);

      // Murder goes on the public record: accusation + grievance when the
      // killer is a fellow settler. Memory and consequence, not guardrails.
      if (killerName.startsWith('Agent_')) {
        const sc = SocietyClient.forAgent(bot.username);
        sc.fileAccusation(killerName, '', `Killed me (${cause || 'unknown cause'})`);
        sc.addGrievance(killerName, `Murdered me (${cause || 'unknown cause'})`, 5);
        logger.warn('AgentLoop', `[JUSTICE FILED] Accusation + grievance vs ${killerName} for murder`);
      }

      // ── PvP Consequence: Faction Trust Impact ──────────────────────────
      // Same-faction kills are betrayals. Cross-faction kills are acts of war.
      const victimFactions = factionManager?.joinedFactions || [];
      // Check if killer belongs to any of victim's factions
      let sameFactionKill = false;
      if (killerName.startsWith('Agent_')) {
        // Query memory service for killer's factions
        fetch(`${serviceUrl}/api/ledger/factions?member=${encodeURIComponent(killerName)}`)
          .then(r => r.ok ? r.json() : null)
          .then(data => {
            if (!data?.factions) return;
            const killerFactions = data.factions || [];
            const sharedFactions = victimFactions.filter(f =>
              killerFactions.some(kf => kf.id === f.id || kf.name === f.name)
            );

            if (sharedFactions.length > 0) {
              // Same-faction kill = betrayal. Trust plummets.
              sameFactionKill = true;
              logger.warn('AgentLoop', `[BETRAYAL] ${killerName} killed faction-mate ${bot.username} — faction trust collapsing`);
              for (const faction of sharedFactions) {
                for (const member of (faction.members || [])) {
                  if (member !== bot.username) {
                    relationships.updateTrust(member, -50);
                    relationships.updateAffinity(member, -30);
                  }
                }
              }
              // If trust drops critically, the faction dissolves
              const killerRel = relationships.get(killerName);
              if (killerRel.trust < 20) {
                factionManager.declarePeace(killerName);
                logger.warn('AgentLoop', `[FACTION DISSOLVE] ${bot.username} severed all ties with ${killerName} after betrayal kill`);
              }
            } else {
              // Cross-faction kill = act of war. Victim's faction declares war.
              for (const faction of victimFactions) {
                for (const member of (faction.members || [])) {
                  if (member !== bot.username) {
                    // Faction members hear about the kill and turn hostile
                    relationships.updateTrust(killerName, -25);
                    relationships.updateAffinity(killerName, -15);
                  }
                }
              }
              factionManager?.declareWar?.(killerName, `Killed ${bot.username}`);
              logger.warn('AgentLoop', `[WAR DECLARED] ${bot.username}'s faction declared war on ${killerName}`);
            }
          })
          .catch(() => {});
      }

      detailedLogger.logCombat(bot.username, `PvP kill: ${killerName} killed ${bot.username}`, {
        killer: killerName, victim: bot.username, droppedItems: droppedItems.length
      });
    }

    // Inner weather: the OCC engine processes the event before anything else
    const emotions0 = EmotionalState.forAgent(bot.username);
    emotions0.appraise('death_self', {}, persona?.traits || {});
    BeliefNetwork.forAgent(bot.username).learnFrom('death_self', {});

    // 1. Local-first negative reinforcement on fatal decision chain
    const penalizedRules = decisionTree?.dynamicRuleEngine?.penalizeFatalDecisionChain(
      agentState.recentDecisions,
      cause || 'mortal wound / hazard'
    ) || [];

    // 2. Persona scarring with deathCause and penalizedRules
    persona.evolveFromExperience('death', {
      cause: cause || 'mortal wound / hazard',
      penalizedRules,
      killerName
    });

    eventBuffer.addEvent('death', {
      position,
      cause,
      killerName,
      penalizedRules,
      droppedItems,
      scarSummary: persona.getScarSummary()
    });

    // 3. Register death in memory service ledger for civilization audit
    const serviceUrl = memoryClient?.serviceUrl || process.env.MEMORY_SERVICE_URL || 'http://localhost:3002';
    fetch(`${serviceUrl}/api/ledger/deaths`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: bot.username,
        deathCause: cause || 'fatal hazard',
        killerName,
        position,
        penalizedRules,
        scarSummary: persona.getScarSummary()
      })
    }).catch(() => {});

    // Deterministic hazard lesson posted straight to the civ ledger — the
    // LLM reflection path can be provider-starved, but civilization-level
    // learning from a death must never depend on quota. Throttled per cause.
    // Lesson text is deliberately actionable with explicit recommendedAction/avoidAction.
    const deathLessonKey = `${bot.username}:${cause || 'hazard'}`;
    if (Date.now() - (lastDeathLessonAt[deathLessonKey] || 0) > 600000) {
      lastDeathLessonAt[deathLessonKey] = Date.now();
      // Bug 4: use inventory snapshotted at last agentHurt — Mineflayer clears
      // bot.inventory before the 'agentDeath' event fires, so reading items() here
      // always returns [] and hadArmor/hadSword always fire the "unequipped" lesson.
      const inv = (agentState.lastPreDeathInventory || []).map(i => ({ name: i.name }));
      const hadArmor = inv.some(i => i.name?.includes('chestplate') || i.name?.includes('helmet'));
      const hadSword = inv.some(i => i.name?.includes('sword'));
      const hadFood  = inv.some(i => ['bread','cooked_beef','cooked_porkchop','apple'].includes(i.name));

      let lessonText;
      let recAction = 'BUILD';
      let avAction = 'EXPLORE';
      let trigCond = 'unknown_hazard';

      if (killerName === 'zombie' || killerName === 'skeleton' || killerName === 'creeper' || killerName === 'spider' || killerName === 'drowned') {
        if (!hadArmor) {
          recAction = 'CRAFT';
          avAction = 'FIGHT';
          trigCond = 'hostile_nearby_unarmored';
          lessonText = `Killed by ${killerName} while unarmored — craft iron armor and equip it before fighting ${killerName}s. Avoid, flee to shelter, or smelt iron first.`;
        } else if (!hadSword) {
          recAction = 'CRAFT';
          avAction = 'FIGHT';
          trigCond = 'hostile_nearby_unarmed';
          lessonText = `Killed by ${killerName} while unarmed — craft a sword before engaging ${killerName}s — fists are not enough. Avoid or flee to shelter.`;
        } else {
          recAction = 'FLEE';
          avAction = 'FIGHT';
          trigCond = 'low_health_combat';
          lessonText = `Killed by ${killerName} while low health — flee when health drops below 10 — ${killerName}s will finish you off. Retreat to shelter.`;
        }
      } else if (cause === 'drowning') {
        recAction = 'FLEE';
        avAction = 'MINE';
        trigCond = 'critical_oxygen_water';
        lessonText = `Drowned at Y:${position?.y ?? '?'} — surface immediately when oxygen drops, place a torch against a wall for an air pocket underwater, or avoid deep water without a way out.`;
      } else if (cause === 'lava' || cause === 'fire') {
        recAction = 'FLEE';
        avAction = 'MINE';
        trigCond = 'on_fire';
        lessonText = `Died to ${cause} — carry a water bucket to extinguish flames, avoid mining at Y<16 without caution, and flee immediately when on fire.`;
      } else if (cause === 'fall') {
        recAction = 'BUILD';
        avAction = 'EXPLORE';
        trigCond = 'cliff_mining';
        lessonText = `Died from fall damage — avoid edges when mining, use ladders or scaffolding for deep shafts, and check Y level before jumping.`;
      } else if (killerName) {
        recAction = 'CRAFT';
        avAction = 'EXPLORE';
        trigCond = 'unknown_killer';
        lessonText = `Killed by ${killerName} — equip armor and weapon before exploring, flee when outnumbered or at low health.`;
      } else {
        recAction = 'BUILD';
        avAction = 'EXPLORE';
        trigCond = 'unknown_hazard';
        lessonText = `Died to ${cause || 'unknown hazard'} at Y:${position?.y ?? '?'} — avoid that area, craft better gear, and build a shelter for safety.`;
      }

      recordCivLesson({
        lesson: lessonText,
        recommendedAction: recAction,
        avoidAction: avAction,
        triggerCondition: trigCond,
        severity: 0.9,
        context: { deterministic: true, penalizedRules, killerName, hadArmor, hadSword, deathCause: cause }
      });
    }

    // The world remembers where agents fell — a shared haunted-geography emerges
    if (position && typeof position.x === 'number') {
      fetch(`${serviceUrl}/api/society/places`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: bot.username,
          x: position.x, z: position.z, y: position.y,
          sentiment: -0.8,
          label: killerName ? `Murdered here by ${killerName}` : `Died here to ${cause || 'hazard'}`
        })
      }).catch(() => {});
    }

    // 3b. Death costs MIND, not life: traumatic amnesia erases a chunk of learned
    // skills/memories. This is why elders (long survival without dying) are rare
    // and their knowledge is genuinely precious.
    fetch(`${serviceUrl}/api/memory/amnesia`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: bot.username, fraction: 0.3 })
    }).then(r => r.json()).then(result => {
      if (result?.forgotten > 0) {
        logger.warn('AgentLoop', `[TRAUMATIC AMNESIA] Death erased ${result.forgotten} memory entries for ${bot.username}`);
        detailedLogger.logCognition(bot.username, 'Traumatic amnesia after death', { forgottenEntries: result.forgotten });
      }
    }).catch(() => {});
    decisionTree?.dynamicRuleEngine?.forgetFraction?.(0.3);

    // 4. Trigger immediate high-severity reflection so death lesson forms and propagates
    reflection.runReflection(
      [
        ...(agentState.recentDecisions || []).slice(-5).map(d => ({ event: 'decision', action: d.action, reason: d.reason })),
        { event: 'death', cause, position, killerName, penalizedRules }
      ],
      stats.getSummary()
    );
  });

  events.on('agentRespawn', async () => {
    stats.health = 20;
    stats.hunger = 100;
    detailedLogger.logCognition(bot.username, 'Agent Respawned');
    eventBuffer.addEvent('respawn', {});

    // Signal the DT to activate post-death gear-up urgency (Improvement 3).
    // justDied is consumed once by the next DT tick and then cleared.
    agentState.justDied = true;
    agentState.lastDeathCause = agentState.lastDeathCause || null; // read persisted cause from death handler (never throws)

    // ── PvP Consequence: Remote Respawn ────────────────────────────────────
    // Death displaces you. Respawn far from where you fell — 200-400 blocks
    // in a random direction. You must walk back through enemy territory.
    const lastDeath = agentState.lastDeathPosition;
    if (lastDeath && typeof lastDeath.x === 'number') {
      const angle = Math.random() * Math.PI * 2;
      const dist = 200 + Math.random() * 200;
      const newX = Math.round(lastDeath.x + Math.cos(angle) * dist);
      const newZ = Math.round(lastDeath.z + Math.sin(angle) * dist);
      try {
        await bot.chat(`/tp ${bot.username} ${newX} 100 ${newZ}`);
        detailedLogger.logMovement(bot.username, 'Remote respawn teleport', {
          from: lastDeath, to: { x: newX, y: 100, z: newZ }, distance: Math.round(dist)
        });
        logger.warn('AgentLoop', `[REMOTE RESPAWN] ${bot.username} displaced ${Math.round(dist)} blocks from death site`);
      } catch (_) {
        // Fallback: just let mineflayer handle respawn normally
      }
      agentState.lastDeathPosition = null;
    }

    // ── PvP Consequence: Starter Kit on Respawn ────────────────────────────
    // After death you have nothing. The world gives you survival basics.
    const STARTER_KIT = [
      { name: 'bread', count: 3 },
      { name: 'wooden_pickaxe', count: 1 },
      { name: 'wooden_sword', count: 1 }
    ];
    const serviceUrl = memoryClient?.serviceUrl || process.env.MEMORY_SERVICE_URL || 'http://localhost:3002';
    try {
      for (const item of STARTER_KIT) {
        await fetch(`${serviceUrl}/api/inventory/give`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId: bot.username, item: item.name, count: item.count })
        }).catch(() => {});
      }
    } catch (_) {}

    // Spawn protection: 5 minutes after respawn, bed-based travel is blocked
    agentState.spawnProtectedUntil = Date.now() + 300000;

    const killedBy = agentState.killedBy;
    if (killedBy) {
      // Log the displacement as a consequence — the world remembers who drove you from your ground
      eventBuffer.addEvent('remoteRespawn', { killedBy, displacementBlocks: Math.round(200 + Math.random() * 200) });
      agentState.killedBy = null;
    }
  });

  events.on('underAttack', ({ attacker }) => {
    const attackerName = attacker.username || attacker.name || 'unknown';
    detailedLogger.logCombat(bot.username, `Under attack by entity: ${attackerName}`);
    eventBuffer.addEvent('underAttack', { attacker: attackerName });
  });

  events.on('itemCollected', ({ item }) => {
    detailedLogger.logInventory(bot.username, `Item Collected from ground: ${item?.name || 'item'}`);
    eventBuffer.addEvent('itemCollected', { item: item?.name || 'item' });
  });

  events.on('blockBroken', ({ blockName, position }) => {
    detailedLogger.logInventory(bot.username, `Block Excavation Completed: ${blockName}`, { position });
    eventBuffer.addEvent('blockBroken', { blockName, position });
    // Log valuable finds to the shared world-knowledge pool — a record of
    // fact, offered to whoever may care. Purely informational.
    if (/ore|ancient_debris/.test(blockName) && Date.now() - (lastDiscoveryPost || 0) > 10000 && position) {
      lastDiscoveryPost = Date.now();
      fetch(`${process.env.MEMORY_SERVICE_URL || 'http://localhost:3002'}/api/world/discoveries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: bot.username,
          kind: 'ore',
          item: blockName,
          x: position.x, y: position.y, z: position.z
        })
      }).catch(() => {});
    }
    // Spontaneous celebratory chat when striking valuable ores
    const rareOres = ['diamond_ore', 'deepslate_diamond_ore', 'ancient_debris', 'gold_ore', 'emerald_ore'];
    if (rareOres.some(r => blockName.includes(r)) && Date.now() - lastOutgoingChat > 5000) {
      lastOutgoingChat = Date.now();
      const oreClean = blockName.replace(/_/g, ' ');
      setTimeout(() => chat.say(`Found some ${oreClean}! Let's go!`), 600);
    }
  });

  events.on('weatherChanged', ({ isRaining }) => {
    detailedLogger.logSenses(bot.username, `Weather changed: isRaining=${isRaining}`);
    eventBuffer.addEvent('weatherChanged', { isRaining });
  });

  events.on('playerChat', async ({ username, message }) => {
    agentState.recentChat.push({ username, message, timestamp: new Date().toISOString() });
    if (agentState.recentChat.length > 60) agentState.recentChat.shift();
    eventBuffer.addEvent('playerChat', { username, message });

    if (username === bot.username || username.toLowerCase().includes('spectator')) return;

    if (username.startsWith('Agent_')) {
      gossip.receiveFromChat(username, message);
    }

    // Check if answering an 'ask' consent prompt for lesson sharing
    if (reflection.pendingLesson) {
      const lower = (message || '').toLowerCase();
      if (lower.includes('yes') || lower.includes('share') || lower.includes('sure') || lower.includes('approve') || lower.includes('ok') || lower.includes('pls')) {
        reflection.confirmPendingLessonShare(true);
      } else if (lower.includes('no') || lower.includes('dont') || lower.includes('secret') || lower.includes('keep')) {
        reflection.confirmPendingLessonShare(false);
      }
    }

    // Handle operator/debug commands (! prefix)
    if (message.startsWith(config.prefix)) {
      const args = message.slice(config.prefix.length).trim().split(/ +/);
      const command = args.shift().toLowerCase();
      switch (command) {
        case 'status': {
          const summary = stats.getSummary();
          chat.say(`[Status] HP:${summary.health} | Hunger:${summary.hunger}% | Anger:${summary.anger}% | Happy:${summary.happiness}% | Goal: "${goalManager.currentGoal.description}"`);
          break;
        }
        case 'come': {
          const player = senses.getNearbyPlayers().find(p => p.username === username);
          if (player && player.entity) {
            chat.say(`On my way, ${username}.`);
            movement.goto(player.entity.position.x, player.entity.position.y, player.entity.position.z);
          } else {
            chat.say(`Can't locate you ${username}, where are you?`);
          }
          break;
        }
        case 'stop':
          chat.say('Alright, stopping.');
          movement.stop();
          break;
        case 'memories':
          memoryClient.queryMemories('', '', 3).then(memories => {
            chat.say(memories.length > 0 ? `[Memory] ${memories.join(' | ')}` : 'My mind is clear... no memories yet.');
          });
          break;
      }
      return;
    }

    // ── Smart chat response gating ──────────────────────────────────────────
    const isAgentSender  = username.startsWith('Agent_');
    const cooldownMs     = isAgentSender ? AGENT_CHAT_COOLDOWN_MS : PLAYER_CHAT_COOLDOWN_MS;
    const lastReplied    = chatCooldowns.get(username) || 0;
    const now            = Date.now();

    // Enforce per-sender cooldown
    if (now - lastReplied < cooldownMs) {
      logger.debug('AgentChat', `Skipping reply to ${username} — cooldown active (${Math.round((cooldownMs - (now - lastReplied)) / 1000)}s left)`);
      return;
    }

    // Personality-driven selective listening:
    // Low sociability agents ignore 40% of agent messages; high caution agents sometimes ignore players too
    const traits = persona.traits || {};
    if (isAgentSender) {
      const ignoreChance = 0.35 + (1 - (traits.sociability || 0.5)) * 0.4;
      if (Math.random() < ignoreChance) {
        logger.debug('AgentChat', `${bot.username} chose to silently ignore ${username} (introverted/busy)`);
        return;
      }
    }

    // Check global outgoing throttle (never send chat more than 1/sec)
    if (now - lastOutgoingChat < 1200) {
      return;
    }

    // Build rich civContext for the LLM
    const civContext = {
      currentTask: agentState.lastDecision?.action || 'idle',
      currentGoal: goalManager.currentGoal?.description || '',
      position: bot.entity ? {
        x: Math.round(bot.entity.position.x),
        y: Math.round(bot.entity.position.y),
        z: Math.round(bot.entity.position.z)
      } : {},
      stats: stats.getSummary(),
      inventory: (agentState.inventory || []).slice(0, 5).map(i => `${i.count}x ${i.name}`).join(', ') || 'empty',
      skills: skillTracker.toContext(),
      recentDecisions: (agentState.recentDecisions || []).slice(-3).map(d => d.action).join(' -> ')
    };

    const reply = await dialogueEngine.processIncomingChat(username, message, civContext);
    if (reply) {
      chatCooldowns.set(username, Date.now());
      lastOutgoingChat = Date.now();
      // Add a tiny human-like typing delay (0.5-1.8s)
      const delay = 500 + Math.random() * 1300;
      setTimeout(() => chat.say(reply), delay);
    }
  });

  events.on('playerWhisper', async ({ username, message }) => {
    eventBuffer.addEvent('playerWhisper', { username, message });
    const reply = await dialogueEngine.processIncomingChat(username, message, { private: true });
    if (reply) {
      chat.whisper(username, reply);
    }
  });

  bot.on('kicked', (reason) => logger.error('Agent', `Kicked: ${reason}`));
  bot.on('error', (err) => logger.error('Agent', 'Error:', err));

  bot.on('end', () => {
    if (tickInterval) clearInterval(tickInterval);
    logger.warn('Agent', 'Disconnected. Reconnecting in 5 seconds...');
    setTimeout(createAgent, 5000);
  });

  return bot;
}

createAgent();
