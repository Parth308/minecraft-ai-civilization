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
const { ACTIONS } = require('../shared/constants');

let prismarineViewer = null;
try {
  prismarineViewer = require('prismarine-viewer').mineflayer;
} catch (e) {
  // prismarine-viewer is optional if running in bare environments
}

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
  viewerReady: false,
  viewerPort: null,
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
          body: JSON.stringify({ agentId: bot.username, ...adj })
        });
        logger.warn('AgentLoop', `[SELF-REVIEW] ${bot.username} self-corrected ${adj.ruleType}: ${adj.reason}`);
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
  const relationships = new RelationshipTracker();

  // Cognitive & Social Architecture
  const persona = new DynamicPersona(config.username, config.personalitySeed);
  currentPersona = persona;
  const goalManager = new GoalManager(config.username, persona);
  persistGoalAcrossRestarts(goalManager);
  const brainClient = new BrainClient(config.brokerUrl);
  const factionManager = new FactionAffiliationManager(config.username, persona);
  factionManager.restoreFromLedger(process.env.MEMORY_SERVICE_URL || 'http://localhost:3002').catch(() => {});
  const dialogueEngine = new SocialDialogueEngine(brainClient, persona, goalManager, relationships, factionManager);
  const builder = new BuilderSkill(bot, inventory, movement, goalManager);
  bot.goalManager = goalManager;
  const barter = new BarterSkill(bot, inventory, relationships, chat);
  const farmer = new FarmerSkill(bot, inventory, movement);

  // Memory components
  const memoryClient = new MemoryClient(config.username);
  const reflection = new ReflectionEngine(brainClient, persona, memoryClient, chat);
  const decisionTree = new DecisionTree(config.confidenceThreshold, memoryClient, brainClient);
  dialogueEngine.setReflectionEngine(reflection);
  dialogueEngine.setDynamicRuleEngine(decisionTree.dynamicRuleEngine);
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
    ).catch(err => logger.warn('AgentLoop', `Handshake trade failed: ${err.message}`));
  };
  const eventBuffer = new EventBuffer(20, (bufferSnapshot) => {
    memoryClient.flushBuffer(bufferSnapshot);
  });

  let tickInterval = null;
  let inFlightTick = false;

  // Chat anti-spam: per-sender cooldown and global outgoing throttle
  const chatCooldowns = new Map(); // sender -> last response timestamp
  const AGENT_CHAT_COOLDOWN_MS = 6000;  // min 6s between replies to same sender
  const PLAYER_CHAT_COOLDOWN_MS = 1800; // min 1.8s between replies to player
  let lastOutgoingChat = 0;             // global outgoing chat throttle
  let lastTorchPlacement = 0;
  let lastDiscoveryPost = 0;
  const lastDeathLessonAt = {};

  const IRON_PLUS_ORES = ['diamond_ore', 'deepslate_diamond_ore', 'gold_ore', 'emerald_ore', 'redstone_ore'];

  function hasIronPickOrBetter() {
    return senses.hasItem('iron_pickaxe') || senses.hasItem('diamond_pickaxe') || senses.hasItem('netherite_pickaxe');
  }

  function preflightValidateDecision(decision) {
    if (!decision || decision.escalated !== true) return decision;

    if (decision.action === 'MINE' && decision.targetResource && IRON_PLUS_ORES.includes(decision.targetResource)) {
      if (!hasIronPickOrBetter()) {
        logger.warn('AgentLoop', `[PRE-FLIGHT] MINE ${decision.targetResource} rejected — requires iron pickaxe+. Falling back to local target chain.`);
        delete decision.targetResource;
      }
    }
    if (decision.action === 'SLEEP' && !decision.meta?.bed && !senses.isNight()) {
      logger.warn('AgentLoop', '[PRE-FLIGHT] SLEEP rejected — not night. Overriding to WANDER.');
      decision.action = 'WANDER';
    }
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

  bot.once('spawn', () => {
    try {
      const pos = bot.entity ? { x: Math.round(bot.entity.position.x), y: Math.round(bot.entity.position.y), z: Math.round(bot.entity.position.z) } : { x: 0, y: 0, z: 0 };
      logger.info('Agent', `${bot.username} spawned at X:${pos.x} Y:${pos.y} Z:${pos.z}`);
      
      detailedLogger.logCognition(bot.username, 'Agent Spawned in World', { position: pos, biome: senses.getBiome(), timeOfDay: senses.getTimeOfDay() });

      const defaultMovements = new Movements(bot);
      bot.pathfinder.setMovements(defaultMovements);

      chat.say(`Greetings world! ${bot.username} is awake.`);

      // Start Native First-Person 3D POV Viewer Stream if VIEWER_PORT is configured
      const viewerPort = process.env.VIEWER_PORT ? parseInt(process.env.VIEWER_PORT, 10) : null;
      if (viewerPort && prismarineViewer) {
        try {
          prismarineViewer(bot, { port: viewerPort, firstPerson: true });
          agentState.viewerReady = true;
          agentState.viewerPort = viewerPort;
          logger.info('AgentViewer', `[POV Stream] Direct 3D First-Person View active for ${bot.username} on port ${viewerPort}`);
        } catch (err) {
          logger.warn('AgentViewer', `Failed to start POV viewer: ${err.message}`);
        }
      }

      eventBuffer.addEvent('spawn', {
        position: pos,
        biome: senses.getBiome(),
        timeOfDay: senses.getTimeOfDay()
      });

      // Seed dynamic rules from civilization shared lessons
      decisionTree.dynamicRuleEngine.seedFromSharedLessons(process.env.MEMORY_SERVICE_URL || 'http://localhost:3002');

      // Grounded curriculum check: when basics (tools/shelter) are missing,
      // nudge the goal toward the next tech milestone every few minutes.
      const curriculumTimer = setInterval(() => {
        try {
          if (Date.now() - (agentState._lastCurriculumAt || 0) < 300000) return;
          const inv = (agentState.inventory || []).map(i => i.name);
          const next = goalManager.nextTechObjective(inv);
          const currentDesc = (goalManager.currentGoal?.description || '').toLowerCase();
          const isWhimsical = ['trade', 'mine', 'explore', 'wander', 'talk'].includes(currentDesc.trim());
          if (!next || !isWhimsical) return;
          agentState._lastCurriculumAt = Date.now();
          goalManager.setGoal(next.objective, { source: 'tech-curriculum', phase: next.phase });
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
          const ROLE_NAMES = { MINE: 'Miner', EXPLORE: 'Scout', WANDER: 'Scout', TRADE: 'Merchant', TALK: 'Diplomat', FARM: 'Farmer', CRAFT: 'Artisan', BUILD: 'Builder', FIGHT: 'Guard' };
          const role = ROLE_NAMES[topAction];
          if (role && role !== persona.emergentRole) {
            persona.emergentRole = role;
            logger.info('AgentLoop', `[PROFESSION] ${bot.username} has specialized as a ${role} (${count}/${total} actions)`);
            detailedLogger.logCognition(bot.username, `Profession emerged: ${role}`, { topAction, share: Number((count / total).toFixed(2)) });
            eventBuffer.addEvent('professionShift', { role, topAction });
            if (lastAnnouncedRole !== role && Date.now() - lastOutgoingChat > 10000) {
              lastAnnouncedRole = role;
              lastOutgoingChat = Date.now();
              chat.say(`I've found my calling — I'm the settlement's ${role.toLowerCase()} now.`);
            }
          }
        } catch { /* profession tracking is advisory */ }
      }, 90000);
      professionTimer.unref?.();

      // Heap watchdog: samples RSS/heap growth every 10s. If heap approaches
      // the V8 cap we exit(0) CLEANLY — docker restarts a fresh process with
      // zero crash side-effects — and the growth log names what is leaking.
      let _lastHeapLog = 0;
      const heapTimer = setInterval(() => {
        try {
          const mu = process.memoryUsage();
          const mb = n => Math.round(n / 1048576);
          if (Date.now() - _lastHeapLog > 60000) {
            _lastHeapLog = Date.now();
            logger.info('AgentLoop', `[HEAP] rss=${mb(mu.rss)}MB heapUsed=${mb(mu.heapUsed)}MB external=${mb(mu.external)}MB arrayBuffers=${mb(mu.arrayBuffers)}MB`);
          }
          if (mu.heapUsed > 440 * 1048576) {
            logger.error('AgentLoop', `[HEAP WATCHDOG] heapUsed=${mb(mu.heapUsed)}MB approaching cap — clean restart (growth trend in [HEAP] logs above)`);
            detailedLogger.logCognition(bot.username, 'Clean restart triggered by heap watchdog');
            process.exit(0);
          }
        } catch { /* watchdog must never throw */ }
      }, 10000);
      heapTimer.unref?.();

      // Main Agent Loop (Tick-based with agent-staggered start to prevent API congestion)
      const staggerDelay = config.username === 'Agent_Alpha' ? 0 : config.username === 'Agent_Beta' ? 350 : 700;
      setTimeout(() => {
        tickInterval = setInterval(async () => {
          if (inFlightTick) return;
          inFlightTick = true;

          try {
            // 1. Sync MC stats
          stats.updateHealth(bot.health);
          stats.updateHungerFromMC(bot.food);

          // 2. Run local stats decay tick
          statsDecay.tick();

          if (goalManager.getActivePlan()) {
            const plan = goalManager.getActivePlan();
            const stepText = goalManager.getCurrentPlanStep();
            const planDecision = planStepToDecision(stepText);

            if (!planDecision) {
              goalManager.advancePlan();
            } else {
              logger.info('AgentLoop', `[PLAN ${plan.idx + 1}/${plan.steps.length}] "${stepText}"`);
              const beforeOk = agentState.lastActionResult;
              await executeDecision({ ...planDecision, escalated: false, source: 'plan' });
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
              return; // finally still resets inFlightTick
            }
          }

          // 3. Evaluate Decision Tree (with full agentState context for LLM)
          const decision = await decisionTree.evaluate(senses, stats, persona, agentState);
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

          await executeDecision(decision);
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
  async function executeDecision(decision) {
    let actionSuccess = false;
    let execErrorDetail = null;
    try {
      switch (decision.action) {
        case ACTIONS.EAT:
          logger.info('AgentLoop', 'Executing EAT action');
          await inventory.eatFood(stats.health, stats.hunger);
          eventBuffer.addEvent('eatFood', { health: stats.health, hunger: stats.hunger });
          actionSuccess = true;
          break;

        case ACTIONS.FLEE:
        case 'FLEE': {
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
            // Ambient night-flee: commit to ONE shelter waypoint instead of
            // re-randomizing a wander target every tick (jitter livelock).
            const shelterResult = movement.goToShelter();
            eventBuffer.addEvent('flee', { mode: 'shelter', committed: shelterResult.committed });
            if (shelterResult.arrived || !shelterResult.committed) {
              require('./decision/rules/flee').setFleeCooldown('night', 45000);
            }
            actionSuccess = true;
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
            await combat.equipBestWeapon();
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
          // Use meta.bed if provided by rule engine, else search for one
          const bedBlock = decision.meta?.bed || senses.getNearbyBed(20);
          if (bedBlock) {
            logger.info('AgentLoop', 'Executing SLEEP action');
            detailedLogger.logCognition(bot.username, 'Entering bed to sleep', { bedPos: bedBlock.position });
            bot.sleep(bedBlock).catch(err => logger.warn('AgentLoop', `Sleep failed: ${err.message}`));
            eventBuffer.addEvent('sleep', { bedPos: bedBlock.position });
            actionSuccess = true;
          } else if (senses.isNight()) {
            logger.info('AgentLoop', 'Night but no bed found — building shelter or staying put');
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
            const success = await inventory.craftItem(item, count);
            if (success) {
              eventBuffer.addEvent('craftItem', { item, count });
              EmotionalState.forAgent(bot.username).appraise('craft_success', {}, persona?.traits || {});
              BeliefNetwork.forAgent(bot.username).learnFrom('craft_success', {});
              actionSuccess = true;
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
            block = senses.getNearbyBlock('iron_ore', 16) ||
                    senses.getNearbyBlock('coal_ore', 16) ||
                    senses.getNearbyBlock('log', 24) ||
                    senses.getNearbyBlock('stone', 8);
          }
          if (block) {
            logger.info('AgentLoop', `Executing MINE action on ${block.name} at X:${block.position.x} Y:${block.position.y} Z:${block.position.z}`);
            let success = false;
            if (bot.collectBlock && typeof bot.collectBlock.collect === 'function') {
              try {
                await bot.collectBlock.collect([block]);
                success = true;
              } catch (cbErr) {
                logger.debug('AgentLoop', `collectBlock failed (${cbErr.message}) — falling back to digBlock`);
              }
            }
            if (!success) {
              success = await inventory.digBlock(block);
            }
            if (success) {
              eventBuffer.addEvent('mineBlock', { block: block.name, position: block.position });
              actionSuccess = true;
            } else {
              actionSuccess = false;
            }
          } else {
            logger.info('AgentLoop', 'No mining block in direct vicinity — wandering to scout new terrain');
            movement.wander(16);
            actionSuccess = false;
          }
          break;
        }

        case ACTIONS.TALK:
        case 'TALK': {
          // Always escalate TALK to LLM for authentic personality-driven speech
          require('./decision/rules/talk').markTalkExecuted();
          const isCitizen = n => n && n !== bot.username && !/spectate/i.test(n);
          let talkPartner = decision.meta?.partner;
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
          const talkReply = await dialogueEngine.processIncomingChat(
            talkPartner || 'World',
            talkSubject,
            {
              currentTask: decision.action,
              currentGoal: agentState.activeGoal,
              stats: stats.getSummary(),
              inventory: (agentState.inventory || []).slice(0, 5).map(i => `${i.count}x ${i.name}`).join(', ')
            }
          );
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
              const placed = await inventory.placeBlock('torch', groundBelow);
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

          const didBuild = await builder.buildShelter();
          if (didBuild && Date.now() - lastOutgoingChat > 3000) {
            lastOutgoingChat = Date.now();
            chat.say(`just finished building a ${buildType}!`);
          }
          eventBuffer.addEvent('buildShelter', { buildType });
          actionSuccess = !!didBuild;
          break;
        }

        case ACTIONS.TRADE:
        case 'TRADE': {
          // Parse LLM's freeform trade offer: e.g. '4x oak_planks for 2x iron_ingot from Agent_Alpha'
          const offer = decision.tradeOffer || '';
          const partnerMatch = offer.match(/from (\S+)/i);
          const tradePartner = (partnerMatch && partnerMatch[1]) || decision.meta?.partner;
          const giveMatch = offer.match(/(\d+)x ([\w_]+) for/i);
          const wantMatch = offer.match(/for (\d+)x ([\w_]+)/i);
          const giveItem = giveMatch?.[2] || 'oak_planks';
          const giveCount = parseInt(giveMatch?.[1] || '4');
          const wantItem = wantMatch?.[2] || 'cobblestone';
          const wantCount = parseInt(wantMatch?.[1] || '4');
          if (tradePartner) {
            logger.info('AgentLoop', `Executing TRADE with ${tradePartner}: ${giveCount}x ${giveItem} for ${wantCount}x ${wantItem}`);
            // Approach phase: tosses need proximity. Walk toward the partner
            // first (best-effort, bounded) so trades don't die to distance.
            const partnerEntity = Object.values(bot.entities).find(e => e.username === tradePartner);
            if (partnerEntity?.position && bot.entity?.position &&
                bot.entity.position.distanceTo(partnerEntity.position) > 3.5) {
              try {
                await movement.goto(partnerEntity.position.x, partnerEntity.position.y, partnerEntity.position.z, 2.5);
              } catch (navErr) {
                logger.debug('AgentLoop', `Trade approach incomplete: ${navErr.message}`);
              }
            }
            await barter.executeTrade(tradePartner, giveItem, giveCount, wantItem, wantCount);
            eventBuffer.addEvent('executeTrade', { partner: tradePartner, offer });
            factionManager.considerAllianceWith(tradePartner).then(announcement => {
              if (announcement && Date.now() - lastOutgoingChat > 3000) {
                lastOutgoingChat = Date.now();
                chat.say(announcement);
              }
            }).catch(() => {});
          } else {
            // Broadcast trade desire to world if no partner specified
            if (Date.now() - lastOutgoingChat > 3000) {
              lastOutgoingChat = Date.now();
              chat.say(`anyone want to trade? ${offer || 'I have stuff to offer'}`);
            }
          }
          actionSuccess = true;
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
              const placed = await inventory.placeBlock('torch', groundBelow);
              if (placed) {
                lastTorchPlacement = Date.now();
                eventBuffer.addEvent('torchPlaced', { position: { x: botPos.x, y: botPos.y, z: botPos.z } });
              }
            }
          }

          // Pick a direction based on ambition — ambitious agents explore further
          const exploreDist = Math.round(16 + (persona.traits?.ambition || 0.5) * 24);
          logger.info('AgentLoop', `Executing ${decision.action} action (range: ${exploreDist} blocks)`);
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
            // Try to craft and place a furnace if we have enough cobblestone
            const cobbleCount = inventory.bot?.inventory?.items().filter(i => i.name.includes('cobblestone') || i.name.includes('cobbled')).reduce((s, i) => s + i.count, 0) || 0;
            if (cobbleCount >= 8) {
              await inventory.craftItem('furnace', 1);
              const table = senses.getNearbyBlock('crafting_table', 4);
              const placeBase = table ? table.position.offset(1, 0, 0) : bot.entity.position.offset(1, 0, 0);
              const refBlock = bot.blockAt(placeBase.offset(0, -1, 0));
              if (refBlock && refBlock.name !== 'air') {
                await inventory.placeBlock('furnace', refBlock, new (require('vec3'))(0, 1, 0));
                furnaceBlock = senses.getNearbyBlock('furnace', 6);
              }
            }
          }
          if (furnaceBlock) {
            try {
              const furnace = await bot.openFurnace(furnaceBlock);
              const smeltableKeywords = ['raw_', 'beef', 'porkchop', 'mutton', 'chicken', 'salmon', 'cod', 'potato', 'clay', 'sand', 'cobblestone'];
              const rawItem = (smeltInput ? bot.inventory?.items().find(i => i.name === smeltInput) : null) ||
                              bot.inventory?.items().find(i => smeltableKeywords.some(k => i.name.includes(k) && !i.name.startsWith('cooked')));
              const fuelItem = bot.inventory?.items().find(i => i.name === 'coal' || i.name === 'charcoal' || i.name.includes('plank') || i.name.includes('log') || i.name === 'stick');
              if (rawItem && fuelItem) {
                await furnace.putInput(rawItem.type, null, Math.min(rawItem.count, 8));
                await furnace.putFuel(fuelItem.type, null, Math.min(fuelItem.count, 2));
                logger.info('AgentLoop', `Loaded furnace: ${rawItem.name} + ${fuelItem.name}`);
                eventBuffer.addEvent('smeltItem', { input: rawItem.name });
                actionSuccess = true;
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
          logger.info('AgentLoop', 'Executing auto-EQUIP best weapon & armor');
          await combat.equipBestArmor();
          await combat.equipBestWeapon();
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
      }
      agentState.lastActionResult = {
        action: decision.action,
        ok: actionSuccess,
        detail: actionSuccess ? '' : (execErrorDetail || 'action reported failure')
      };
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
      brainClient.escalate({
        taskType: 'EMOTION',
        agentId: bot.username,
        event: 'agentHurt',
        attacker: attackerName,
        health: Math.round(health),
        stats: stats.getSummary(),
        persona: persona.getPersonaPromptContext ? persona.getPersonaPromptContext() : persona
      }).then(res => {
        if (res && res.chatMessage) {
          chat.say(res.chatMessage);
        } else if (res && res.reason) {
          chat.say(`Ouch! ${res.reason}`);
        } else {
          chat.say(`Ouch! Why did you hit me, ${attackerName}?! (HP: ${Math.round(health)}/20)`);
        }
      }).catch(() => {
        chat.say(`Ow! Watch your swings, ${attackerName}! (HP: ${Math.round(health)}/20)`);
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
  events.on('witnessedDeath', ({ victim }) => {
    const rel = relationships?.get?.(victim);
    const emo1 = EmotionalState.forAgent(bot.username);
    emo1.appraise('witnessed_death', { affinity: rel?.affinity ?? 30 }, persona?.traits || {});
    BeliefNetwork.forAgent(bot.username).learnFrom('witnessed_death');
    if ((rel?.affinity ?? 0) >= 60) {
      logger.warn('AgentLoop', `[GRIEF] ${bot.username} lost someone close: ${victim}`);
    }
  });

  events.on('agentDeath', ({ position, cause }) => {
    stats.addHappiness(-50);
    stats.addAnger(30);
    detailedLogger.logCombat(bot.username, 'AGENT DIED', { deathPosition: position, cause });

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
      penalizedRules
    });

    eventBuffer.addEvent('death', {
      position,
      cause,
      penalizedRules,
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
        position,
        penalizedRules,
        scarSummary: persona.getScarSummary()
      })
    }).catch(() => {});

    // Deterministic hazard lesson posted straight to the civ ledger — the
    // LLM reflection path can be provider-starved, but civilization-level
    // learning from a death must never depend on quota. Throttled per cause.
    const deathLessonKey = `${bot.username}:${cause || 'hazard'}`;
    if (Date.now() - (lastDeathLessonAt[deathLessonKey] || 0) > 600000) {
      lastDeathLessonAt[deathLessonKey] = Date.now();
      fetch(`${serviceUrl}/api/ledger/lessons`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: bot.username,
          lesson: `Died to ${cause || 'hazard'} at X:${position?.x ?? '?'} Y:${position?.y ?? '?'} Z:${position?.z ?? '?'} — treat that terrain/situation as lethal`,
          severity: 0.9,
          baseOpenness: persona?.traits?.openness ?? 0.5,
          effectiveOpenness: 1.0,
          isPublic: true,
          status: 'shared',
          context: { deterministic: true, penalizedRules },
          confidence: 0.75,
          timestamp: Date.now()
        })
      }).catch(() => {});
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
          label: `Died here to ${cause || 'hazard'}`
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
        { event: 'death', cause, position, penalizedRules }
      ],
      stats.getSummary()
    );
  });

  events.on('agentRespawn', () => {
    stats.health = 20;
    stats.hunger = 100;
    detailedLogger.logCognition(bot.username, 'Agent Respawned');
    eventBuffer.addEvent('respawn', {});
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

  events.on('timeTransition', ({ phase, timeOfDay }) => {
    detailedLogger.logSenses(bot.username, `Time of day phase entered: ${phase}`, { timeOfDay });
    eventBuffer.addEvent('timeTransition', { phase, timeOfDay });
  });

  events.on('playerChat', async ({ username, message }) => {
    // Always record to recentChat
    agentState.recentChat.push({ username, message, timestamp: new Date().toISOString() });
    if (agentState.recentChat.length > 60) agentState.recentChat.shift();
    eventBuffer.addEvent('playerChat', { username, message });

    // Ignore our own echoes and spectator bots
    if (username === bot.username || username.toLowerCase().includes('spectator')) return;

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
