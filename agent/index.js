const mineflayer = require('mineflayer');
const { pathfinder, movements } = require('mineflayer-pathfinder');
const config = require('./config');
const logger = require('../shared/logger');
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
const { ACTIONS } = require('../shared/constants');

logger.info('Agent', `Initializing agent instance '${config.username}'...`);

function createAgent() {
  const bot = mineflayer.createBot({
    host: config.host,
    port: config.port,
    username: config.username,
    version: config.version,
    hideErrors: false
  });

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
  const decisionTree = new DecisionTree(config.confidenceThreshold);

  let tickInterval = null;

  bot.once('spawn', () => {
    logger.info('Agent', `${bot.username} spawned at X:${Math.round(bot.entity.position.x)} Y:${Math.round(bot.entity.position.y)} Z:${Math.round(bot.entity.position.z)}`);
    
    const defaultMovements = new movements(bot);
    bot.pathfinder.setMovements(defaultMovements);

    chat.say(`Hello world! ${bot.username} is online with active local stats & rule engine.`);

    // Main Agent Loop (Tick-based, zero LLM)
    tickInterval = setInterval(() => {
      // 1. Sync MC stats
      stats.updateHealth(bot.health);
      stats.updateHungerFromMC(bot.food);

      // 2. Run local stats decay tick
      statsDecay.tick();

      // 3. Evaluate Decision Tree
      const decision = decisionTree.evaluate(senses, stats);
      executeDecision(decision);
    }, 1000);
  });

  // Action executor based on decision tree output
  async function executeDecision(decision) {
    switch (decision.action) {
      case ACTIONS.EAT:
        logger.info('AgentLoop', 'Executing EAT action');
        await inventory.eatFood();
        break;

      case ACTIONS.FLEE:
        if (decision.meta && decision.meta.threat) {
          logger.info('AgentLoop', 'Executing FLEE action');
          movement.fleeFrom(decision.meta.threat);
        }
        break;

      case ACTIONS.FIGHT:
        if (decision.meta && decision.meta.target) {
          logger.info('AgentLoop', 'Executing FIGHT action');
          combat.attack(decision.meta.target);
        }
        break;

      case ACTIONS.SLEEP:
        if (decision.meta && decision.meta.bed) {
          logger.info('AgentLoop', 'Executing SLEEP action');
          bot.sleep(decision.meta.bed).catch(err => logger.error('AgentLoop', 'Sleep failed', err));
        }
        break;

      case ACTIONS.MINE:
        if (decision.meta && decision.meta.targetBlock) {
          logger.info('AgentLoop', 'Executing MINE action');
          movement.gotoBlock(decision.meta.targetBlock.position.x, decision.meta.targetBlock.position.y, decision.meta.targetBlock.position.z);
        }
        break;

      case ACTIONS.WANDER:
        if (!movement.isMoving()) {
          logger.info('AgentLoop', 'Executing WANDER action');
          movement.wander();
        }
        break;

      case ACTIONS.IDLE:
      default:
        // Do nothing
        break;
    }
  }

  // Handle normalized event triggers
  events.on('agentHurt', () => {
    stats.addAnger(25);
    stats.addHappiness(-15);
  });

  events.on('playerChat', ({ username, message }) => {
    if (!message.startsWith(config.prefix)) {
      relationships.updateAffinity(username, 2);
      return;
    }

    const args = message.slice(config.prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    switch (command) {
      case 'status':
        const summary = stats.getSummary();
        chat.say(`[Status] HP:${summary.health} | Hunger:${summary.hunger}% | Anger:${summary.anger}% | Happy:${summary.happiness}% | Fatigue:${summary.fatigue}%`);
        break;

      case 'come':
        const player = senses.getNearbyPlayers().find(p => p.username === username);
        if (player && player.entity) {
          chat.say(`Navigating to ${username}`);
          movement.goto(player.entity.position.x, player.entity.position.y, player.entity.position.z);
        } else {
          chat.say(`I cannot see you, ${username}`);
        }
        break;

      case 'wander':
        chat.say('Wandering...');
        movement.wander();
        break;

      case 'stop':
        chat.say('Stopping movement');
        movement.stop();
        break;

      default:
        chat.say(`Unknown command '${command}'. Commands: status, come, wander, stop`);
        break;
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
