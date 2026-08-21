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
const agentState = {
  username: config.username,
  online: false,
  position: null,
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
  uptime: 0,
  startedAt: new Date().toISOString()
};

// Lightweight zero-dep status server (runs continuously for container lifetime)
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
  } else {
    res.writeHead(404);
    res.end();
  }
});
statusServer.listen(config.statusPort, () => {
  logger.info('AgentStatus', `${config.username} permanent status server on :${config.statusPort}`);
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
  const goalManager = new GoalManager(config.username, persona);
  const brainClient = new BrainClient(config.brokerUrl);
  const factionManager = new FactionAffiliationManager(config.username, persona);
  const dialogueEngine = new SocialDialogueEngine(brainClient, persona, goalManager, relationships, factionManager);

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

      eventBuffer.addEvent('spawn', {
        position: pos,
        biome: senses.getBiome(),
        timeOfDay: senses.getTimeOfDay()
      });

      // Main Agent Loop (Tick-based)
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
          const decision = await decisionTree.evaluate(senses, stats);

          // ── Update live state for /status endpoint ──────────────────────
          agentState.stats       = stats.getSummary();
          agentState.lastDecision = { ...decision, timestamp: new Date().toISOString() };
          agentState.activeGoal  = goalManager.currentGoal.description;
          agentState.persona     = persona.getPersonaPromptContext ? undefined : { seed: persona.seed, traits: persona.traits };
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
  events.on('agentHurt', ({ health }) => {
    stats.addAnger(25);
    stats.addHappiness(-15);
    detailedLogger.logCombat(bot.username, `Agent took damage! Health is now ${health}`, { currentHealth: health });
    eventBuffer.addEvent('agentHurt', { health });
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
    // Capture in recentChat buffer for dashboard
    agentState.recentChat.push({ username, message, timestamp: new Date().toISOString() });
    if (agentState.recentChat.length > 50) agentState.recentChat.shift();

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
