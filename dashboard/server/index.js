/**
 * Dashboard server — Express + WebSocket + spectator bot
 * Port 3003
 */
const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');
const { createProxyMiddleware } = require('http-proxy-middleware');
const logger = require('../../shared/logger');

const Aggregator = require('./aggregator');
const SpectatorManager = require('./spectator');
const RconClient = require('./rcon');

const healthRoutes = require('./routes/health');
const agentRoutes = require('./routes/agents');
const chatRoutes = require('./routes/chat');
const memoryRoutes = require('./routes/memory');
const ledgerRoutes = require('./routes/ledger');

const PORT = parseInt(process.env.DASHBOARD_PORT, 10) || 3003;
const VIEWER_PORT = parseInt(process.env.VIEWER_PORT, 10) || 3004;

const MC_HOST = process.env.MC_HOST || 'minecraft-server';
const MC_PORT = parseInt(process.env.MC_PORT, 10) || 25565;
const MC_VERSION = process.env.MC_VERSION || '1.20.4';

const RCON_HOST = process.env.RCON_HOST || 'minecraft-server';
const RCON_PORT = parseInt(process.env.RCON_PORT, 10) || 25575;
const RCON_PASSWORD = process.env.RCON_PASSWORD || '';

// ─── RCON Setup ──────────────────────────────────────────────────────────────

let rcon = null;

async function initRcon() {
  if (!RCON_PASSWORD) {
    logger.warn('Dashboard', 'RCON_PASSWORD not set — operator chat and spectator commands disabled');
    return null;
  }
  const client = new RconClient(RCON_HOST, RCON_PORT, RCON_PASSWORD);
  try {
    await client.connect();
    logger.info('Dashboard', `RCON connected to ${RCON_HOST}:${RCON_PORT}`);
    return client;
  } catch (err) {
    logger.error('Dashboard', `RCON connection failed: ${err.message}`);
    return null;
  }
}

// ─── App Setup ───────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// Serve static frontend
app.use(express.static(path.join(__dirname, '../client')));

// Proxy prismarine-viewer (internal port 3004) under /viewer/*
// Handles both HTTP and WebSocket upgrade
app.use('/viewer', createProxyMiddleware({
  target: `http://localhost:${VIEWER_PORT}`,
  ws: true,
  changeOrigin: true,
  pathRewrite: { '^/viewer': '' },
  on: {
    error: (err, req, res) => {
      if (res?.writeHead) res.writeHead(503).end('World viewer not ready yet');
    }
  }
}));

const server = http.createServer(app);

// ─── WebSocket Server ─────────────────────────────────────────────────────────

const wss = new WebSocketServer({ server, path: '/ws' });
const aggregator = new Aggregator();

wss.on('connection', (ws, req) => {
  logger.info('Dashboard', `WebSocket client connected from ${req.socket.remoteAddress}`);
  aggregator.addClient(ws);

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw);
      await handleWsMessage(msg, ws);
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', data: { message: err.message } }));
    }
  });

  ws.on('close', () => {
    aggregator.removeClient(ws);
  });

  ws.on('error', (err) => {
    logger.error('Dashboard', `WebSocket error: ${err.message}`);
    aggregator.removeClient(ws);
  });
});

async function handleWsMessage(msg, ws) {
  switch (msg.type) {
    case 'spectate_agent': {
      // Client requests to point spectator bot at a specific agent
      if (!spectator) {
        ws.send(JSON.stringify({ type: 'error', data: { message: 'Spectator bot not running' } }));
        return;
      }
      const agentName = msg.agentId;
      const ok = await spectator.teleportToAgent(agentName);
      aggregator.setSpectatorStatus(spectator.getStatus());
      ws.send(JSON.stringify({ type: 'spectate_ack', data: { agentId: agentName, ok } }));
      break;
    }
    case 'ping': {
      ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
      break;
    }
    default:
      logger.warn('Dashboard', `Unknown WS message type: ${msg.type}`);
  }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

healthRoutes(app, aggregator);
agentRoutes(app, aggregator);
// chatRoutes and ledgerRoutes are wired after rcon is ready
memoryRoutes(app);
ledgerRoutes(app);

// ─── Spectator Bot ───────────────────────────────────────────────────────────

let spectator = null;

// ─── Boot Sequence ────────────────────────────────────────────────────────────

async function boot() {
  // 1. Connect RCON
  rcon = await initRcon();

  // 2. Wire chat routes (needs rcon reference)
  chatRoutes(app, aggregator, rcon);

  // 3. Start aggregator polling
  aggregator.start();

  // 4. Start spectator bot (non-blocking — MC server may not be ready immediately)
  spectator = new SpectatorManager(MC_HOST, MC_PORT, MC_VERSION, rcon);
  spectator.start();

  // Periodically sync spectator status to aggregator
  setInterval(() => {
    if (spectator) aggregator.setSpectatorStatus(spectator.getStatus());
  }, 3000);

  // 5. Start HTTP server (also handles WS upgrades for /viewer proxy)
  server.listen(PORT, () => {
    logger.info('Dashboard', `Civilization Control Dashboard running at http://0.0.0.0:${PORT}`);
    logger.info('Dashboard', `World viewer proxied at http://0.0.0.0:${PORT}/viewer`);
  });
}

// Handle prismarine-viewer WS upgrade via the proxy
server.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith('/viewer')) {
    // Let http-proxy-middleware handle WS upgrades for viewer
  } else if (req.url === '/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  }
});

process.on('SIGTERM', () => {
  logger.info('Dashboard', 'Shutting down...');
  aggregator.stop();
  if (rcon) rcon.disconnect();
  server.close();
});

boot().catch(err => {
  logger.error('Dashboard', `Boot failed: ${err.message}`, err);
  process.exit(1);
});
