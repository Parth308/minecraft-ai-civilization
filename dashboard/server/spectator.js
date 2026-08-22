/**
 * SpectatorBot — a mineflayer bot running inside the dashboard container.
 * Joins the Minecraft server as "SpectatorBot", receives OP + spectator gamemode
 * via RCON on spawn, then prismarine-viewer renders its view on an internal port.
 * Switching agents: RCON /tp SpectatorBot <AgentName> — instant noclip teleport.
 */
const mineflayer = require('mineflayer');
const RconClient = require('./rcon');
const logger = require('../../shared/logger');

// prismarine-viewer is optional — gracefully skip if install fails
let prismarineViewer = null;
try {
  prismarineViewer = require('prismarine-viewer').mineflayer;
} catch (err) {
  logger.warn('Spectator', 'prismarine-viewer not available, world view disabled');
}

const VIEWER_PORT = parseInt(process.env.VIEWER_PORT, 10) || 3004;
const SPECTATOR_NAME = process.env.SPECTATOR_USERNAME || 'SpectatorBot';

class SpectatorManager {
  constructor(mcHost, mcPort, mcVersion, rcon) {
    this.mcHost = mcHost;
    this.mcPort = mcPort;
    this.mcVersion = mcVersion;
    this.rcon = rcon;
    this.bot = null;
    this.viewerStarted = false;
    this.currentTarget = null;
    this.onlineAgents = [];
  }

  setAgentList(agents) {
    this.onlineAgents = agents;
  }

  start() {
    this._connect();
  }

  _connect() {
    logger.info('Spectator', `Connecting SpectatorBot to ${this.mcHost}:${this.mcPort}...`);

    this.bot = mineflayer.createBot({
      host: this.mcHost,
      port: this.mcPort,
      username: SPECTATOR_NAME,
      version: this.mcVersion,
      hideErrors: false
    });

    this.bot.once('spawn', async () => {
      logger.info('Spectator', 'SpectatorBot spawned — setting up OP + spectator mode via RCON...');
      await this._setupViaRcon();

      // Start the 3D viewer after a delay to allow gamemode to settle
      setTimeout(() => this._startViewer(), 2000);
    });

    // Listen for in-game player and agent chat to stream to dashboard
    this.bot.on('chat', (username, message) => {
      if (username === SPECTATOR_NAME) return;
      logger.info('Spectator', `[World Chat Relay] <${username}>: ${message}`);
      if (this.onChatCallback) {
        this.onChatCallback({ username, message, timestamp: new Date().toISOString() });
      }
    });

    this.bot.on('messagestr', (message) => {
      if (message.includes('slain by') || message.includes('fell') || message.includes('drowned') || message.includes('burned') || message.includes('blew up')) {
        if (this.onMessageCallback) {
          this.onMessageCallback({ username: 'Server', message, timestamp: new Date().toISOString() });
        }
      }
    });

    this.bot.on('error', (err) => {
      logger.error('Spectator', `Bot error: ${err.message}`);
    });

    this.bot.on('end', () => {
      logger.warn('Spectator', 'SpectatorBot disconnected — reconnecting in 10s...');
      this._cleanupViewer();
      this.viewerStarted = false;
      setTimeout(() => this._connect(), 10000);
    });

    this.bot.on('kicked', (reason) => {
      logger.error('Spectator', `SpectatorBot kicked: ${reason}`);
      this._cleanupViewer();
    });
  }

  _cleanupViewer() {
    if (this.bot && this.bot.viewer) {
      try {
        this.bot.viewer.close();
        logger.info('Spectator', 'Closed previous world viewer instance');
      } catch (err) {
        // ignore close error
      }
    }
  }

  async _setupViaRcon() {
    if (!this.rcon) {
      logger.warn('Spectator', 'No RCON client — cannot auto-set gamemode. Set manually: /gamemode spectator SpectatorBot');
      return;
    }
    try {
      // Grant OP first, then switch to spectator
      await this.rcon.send(`op ${SPECTATOR_NAME}`);
      logger.info('Spectator', `Granted OP to ${SPECTATOR_NAME}`);

      await new Promise(r => setTimeout(r, 600));

      await this.rcon.send(`gamemode spectator ${SPECTATOR_NAME}`);
      logger.info('Spectator', `Set ${SPECTATOR_NAME} to spectator mode`);

      // Ensure full invisibility and silent no-particle stealth
      await this.rcon.send(`effect give ${SPECTATOR_NAME} minecraft:invisibility infinite 1 true`);
      logger.info('Spectator', `Granted permanent silent invisibility to ${SPECTATOR_NAME}`);

      // Teleport to first known agent if any
      if (this.onlineAgents.length > 0) {
        const first = this.onlineAgents[0];
        await this._teleportTo(first);
      }
    } catch (err) {
      logger.error('Spectator', `RCON setup failed: ${err.message}`);
    }
  }

  _startViewer() {
    if (this.viewerStarted || !prismarineViewer || !this.bot) return;
    try {
      this._cleanupViewer();
      prismarineViewer(this.bot, { port: VIEWER_PORT, firstPerson: true, viewDistance: 6 });
      this.viewerStarted = true;
      logger.info('Spectator', `World viewer started in first-person POV on internal port ${VIEWER_PORT}`);
    } catch (err) {
      logger.error('Spectator', `Failed to start viewer: ${err.message}`);
    }
  }

  async teleportToAgent(agentName) {
    if (!this.rcon) {
      logger.warn('Spectator', 'RCON unavailable — cannot teleport');
      return false;
    }
    try {
      await this._teleportTo(agentName);
      this.currentTarget = agentName;
      return true;
    } catch (err) {
      logger.error('Spectator', `Teleport to ${agentName} failed: ${err.message}`);
      return false;
    }
  }

  async _teleportTo(agentName) {
    const result = await this.rcon.send(`tp ${SPECTATOR_NAME} ${agentName}`);
    logger.info('Spectator', `Teleported to ${agentName}: ${result}`);
  }

  isOnline() {
    return this.bot && this.bot.entity != null;
  }

  getStatus() {
    return {
      online: this.isOnline(),
      currentTarget: this.currentTarget,
      viewerPort: VIEWER_PORT,
      viewerReady: this.viewerStarted
    };
  }
}

module.exports = SpectatorManager;
