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
const SocialDialogueEngine = require('./social/dialogue');
const FactionAffiliationManager = require('./social/factions');
const BuilderSkill = require('./skills/builder');
const BarterSkill = require('./skills/barter');
const ReflectionEngine = require('./cognition/reflection');
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
        logger.info('AgentStatus', `Updated live personality for ${config.username}: ${JSON.stringify(currentPersona?.traits)}`);
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
  const brainClient = new BrainClient(config.brokerUrl);
  const factionManager = new FactionAffiliationManager(config.username, persona);
  const dialogueEngine = new SocialDialogueEngine(brainClient, persona, goalManager, relationships, factionManager);
  const builder = new BuilderSkill(bot, inventory, movement);
  const barter = new BarterSkill(bot, inventory, relationships, chat);
  const reflection = new ReflectionEngine(brainClient, persona, memoryClient, chat);

  // Memory components
  const memoryClient = new MemoryClient(config.username);
  const decisionTree = new DecisionTree(config.confidenceThreshold, memoryClient);
  const eventBuffer = new EventBuffer(20, (bufferSnapshot) => {
    memoryClient.flushBuffer(bufferSnapshot);
  });

  let tickInterval = null;
  let inFlightTick = false;

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

          // 3. Evaluate Decision Tree
          const decision = await decisionTree.evaluate(senses, stats, persona);

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

          if (decision.chatMessage) {
            chat.say(decision.chatMessage);
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
    switch (decision.action) {
      case ACTIONS.EAT:
        logger.info('AgentLoop', 'Executing EAT action');
        await inventory.eatFood(stats.health, stats.hunger);
        eventBuffer.addEvent('eatFood', { health: stats.health, hunger: stats.hunger });
        break;

      case ACTIONS.FLEE:
        if (decision.meta && decision.meta.threat) {
          logger.info('AgentLoop', 'Executing FLEE action');
          movement.fleeFrom(decision.meta.threat);
          eventBuffer.addEvent('flee', { threat: decision.meta.threat.name || 'hostile' });
        }
        break;

      case ACTIONS.FIGHT:
        if (decision.meta && decision.meta.target) {
          logger.info('AgentLoop', 'Executing FIGHT action');
          combat.attack(decision.meta.target);
          eventBuffer.addEvent('fight', { target: decision.meta.target.name || 'hostile' });
        }
        break;

      case ACTIONS.SLEEP:
        if (decision.meta && decision.meta.bed) {
          logger.info('AgentLoop', 'Executing SLEEP action');
          detailedLogger.logCognition(bot.username, 'Entering bed to sleep', { bedPos: decision.meta.bed.position });
          bot.sleep(decision.meta.bed).catch(err => logger.error('AgentLoop', 'Sleep failed', err));
          eventBuffer.addEvent('sleep', { bedPos: decision.meta.bed.position });
        }
        break;

      case ACTIONS.CRAFT:
        if (decision.meta && decision.meta.itemToCraft) {
          const item = decision.meta.itemToCraft;
          const count = decision.meta.count || 1;
          logger.info('AgentLoop', `Executing CRAFT action: ${count}x ${item}`);
          const success = await inventory.craftItem(item, count);
          if (success) {
            eventBuffer.addEvent('craftItem', { item, count });
          }
        }
        break;

      case ACTIONS.MINE:
        if (decision.meta && decision.meta.targetBlock) {
          const block = decision.meta.targetBlock;
          logger.info('AgentLoop', `Executing MINE action on ${block.name} at X:${block.position.x} Y:${block.position.y} Z:${block.position.z}`);
          const success = await inventory.digBlock(block);
          if (success) {
            eventBuffer.addEvent('mineBlock', { block: block.name, position: block.position });
          }
        }
        break;

      case ACTIONS.TALK:
        if (decision.meta && decision.meta.partner) {
          const partner = decision.meta.partner;
          logger.info('AgentLoop', `Executing autonomous TALK with ${partner}`);
          const promptMsg = `Greetings ${partner}! How is your work going?`;
          const reply = await dialogueEngine.processIncomingChat(partner, promptMsg);
          if (reply) {
            chat.say(reply);
          } else {
            const archetype = persona.archetype || 'bold-explorer';
            if (archetype === 'quirky-tinkerer') chat.say(`Hey ${partner}! Look at this biome structure!`);
            else if (archetype === 'cautious-builder') chat.say(`Hello ${partner}. Keeping an eye out for shelter.`);
            else if (archetype === 'shrewd-trader') chat.say(`Greetings ${partner}. Let me know if you need to trade materials.`);
            else chat.say(`Hey ${partner}! Good to see you.`);
          }
          eventBuffer.addEvent('autonomousTalk', { partner });
        }
        break;

      case ACTIONS.BUILD:
      case 'BUILD':
        logger.info('AgentLoop', 'Executing autonomous BUILD action (shelter/structure)');
        await builder.buildShelter();
        eventBuffer.addEvent('buildShelter', {});
        break;

      case ACTIONS.TRADE:
      case 'TRADE':
        if (decision.meta && decision.meta.partner) {
          logger.info('AgentLoop', `Executing autonomous TRADE with ${decision.meta.partner}`);
          await barter.executeTrade(decision.meta.partner, 'oak_planks', 4, 'cobblestone', 4);
          eventBuffer.addEvent('executeTrade', { partner: decision.meta.partner });
        }
        break;

      case ACTIONS.EXPLORE:
      case ACTIONS.WANDER:
        if (!movement.isMoving()) {
          logger.info('AgentLoop', `Executing ${decision.action} action`);
          movement.wander(16);
        }
        break;

      case ACTIONS.IDLE:
      default:
        // Do nothing
        break;
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
    const nearbyMobs = senses.getNearbyHostiles(5);

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
  });

  events.on('playerLeft', ({ username }) => {
    detailedLogger.logSenses(bot.username, `Player left server: ${username}`);
    eventBuffer.addEvent('playerLeft', { username });
  });

  events.on('agentDeath', ({ position }) => {
    stats.addHappiness(-50);
    stats.addAnger(30);
    detailedLogger.logCombat(bot.username, 'AGENT DIED', { deathPosition: position });
    persona.evolveFromExperience('near_death', 1.0);
    eventBuffer.addEvent('death', { position });
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
    // Only capture own messages or human/operator messages in recentChat to avoid cross-agent echo duplicates
    if (username === bot.username || username.toLowerCase() === 'operator' || !username.startsWith('Agent_')) {
      agentState.recentChat.push({ username, message, timestamp: new Date().toISOString() });
      if (agentState.recentChat.length > 50) agentState.recentChat.shift();
    }

    eventBuffer.addEvent('playerChat', { username, message });


    // Handle operator/debug commands
    if (message.startsWith(config.prefix)) {
      const args = message.slice(config.prefix.length).trim().split(/ +/);
      const command = args.shift().toLowerCase();

      switch (command) {
        case 'status':
          const summary = stats.getSummary();
          chat.say(`[Status] HP:${summary.health} | Hunger:${summary.hunger}% | Anger:${summary.anger}% | Happy:${summary.happiness}% | Goal: "${goalManager.currentGoal.description}"`);
          break;

        case 'come':
          const player = senses.getNearbyPlayers().find(p => p.username === username);
          if (player && player.entity) {
            chat.say(`Heading towards you, ${username}.`);
            movement.goto(player.entity.position.x, player.entity.position.y, player.entity.position.z);
          } else {
            chat.say(`I can't locate you, ${username}.`);
          }
          break;

        case 'stop':
          chat.say('Halting.');
          movement.stop();
          break;

        case 'memories':
          memoryClient.queryMemories('', '', 3).then(memories => {
            if (memories.length > 0) {
              chat.say(`[Memories] ${memories.join(' | ')}`);
            } else {
              chat.say('No memories logged yet.');
            }
          });
          break;
      }
      return;
    }

    // Natural Emergent Social Dialogue
    const reply = await dialogueEngine.processIncomingChat(username, message);
    if (reply) {
      chat.say(reply);
    }
  });

  events.on('playerWhisper', async ({ username, message }) => {
    eventBuffer.addEvent('playerWhisper', { username, message });
    const reply = await dialogueEngine.processIncomingChat(username, message);
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
