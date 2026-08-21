/**
 * Aggregator — polls all backend services on intervals and maintains
 * a normalized state snapshot. Broadcasts delta updates to WebSocket clients.
 */
const logger = require('../../shared/logger');

const BROKER_URL = process.env.BROKER_URL || 'http://brain-broker:3001';
const MEMORY_URL = process.env.MEMORY_SERVICE_URL || 'http://memory-service:3002';

// Agent status endpoints configured from env (comma-separated list of name:url)
// e.g. "Agent_Alpha:http://agent-alpha:3010,Agent_Beta:http://agent-beta:3011"
function parseAgentEndpoints() {
  const raw = process.env.AGENT_STATUS_ENDPOINTS || '';
  if (!raw) {
    // Fall back to defaults
    return [
      { name: 'Agent_Alpha', url: process.env.AGENT_ALPHA_STATUS_URL || 'http://agent-alpha:3010' },
      { name: 'Agent_Beta', url: process.env.AGENT_BETA_STATUS_URL || 'http://agent-beta:3011' }
    ];
  }
  return raw.split(',').map(entry => {
    const [name, url] = entry.split(':');
    return { name: name.trim(), url: url.trim() };
  });
}

class Aggregator {
  constructor() {
    this.agentEndpoints = parseAgentEndpoints();
    this.wsClients = new Set();
    this.chatHistory = [];    // last 100 messages across all agents
    this.state = {
      broker: { status: 'unknown', uptime: 0, providers: [], responseMs: null, lastError: null },
      memoryService: { status: 'unknown', uptime: 0, responseMs: null, lastError: null },
      spectator: { online: false, currentTarget: null, viewerReady: false },
      agents: []
    };
    this._intervals = [];
  }

  // ─── WebSocket Client Management ────────────────────────────────────────────

  addClient(ws) {
    this.wsClients.add(ws);
    // Send full snapshot immediately on connect
    this._send(ws, 'full_state', this.state);
    this._send(ws, 'chat_history', { messages: this.chatHistory.slice(-50) });
  }

  removeClient(ws) {
    this.wsClients.delete(ws);
  }

  broadcast(type, data) {
    const msg = JSON.stringify({ type, data, ts: Date.now() });
    for (const ws of this.wsClients) {
      try {
        if (ws.readyState === 1 /* OPEN */) ws.send(msg);
      } catch (err) { /* ignore closed sockets */ }
    }
  }

  _send(ws, type, data) {
    try {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type, data, ts: Date.now() }));
    } catch (err) { /* ignore */ }
  }

  // ─── Public getters ──────────────────────────────────────────────────────────

  getState() { return this.state; }

  getChatHistory(limit = 50) {
    return this.chatHistory.slice(-limit);
  }

  pushChat(msg) {
    const entry = { ...msg, timestamp: msg.timestamp || new Date().toISOString() };
    this.chatHistory.push(entry);
    if (this.chatHistory.length > 100) this.chatHistory.shift();
    this.broadcast('chat_message', entry);
  }

  setSpectatorStatus(status) {
    this.state.spectator = status;
    this.broadcast('spectator_state', status);
  }

  // ─── Polling Loops ───────────────────────────────────────────────────────────

  start() {
    // Poll broker every 5s
    this._intervals.push(setInterval(() => this._pollBroker(), 5000));
    // Poll memory-service every 5s
    this._intervals.push(setInterval(() => this._pollMemoryService(), 5000));
    // Poll each agent every 2s
    this._intervals.push(setInterval(() => this._pollAgents(), 2000));

    // Kick off immediately
    this._pollBroker();
    this._pollMemoryService();
    this._pollAgents();

    logger.info('Aggregator', 'Polling started');
  }

  stop() {
    this._intervals.forEach(clearInterval);
    this._intervals = [];
  }

  async _pollBroker() {
    const t0 = Date.now();
    try {
      const res = await fetch(`${BROKER_URL}/health`, { signal: AbortSignal.timeout(4000) });
      const data = await res.json();
      this.state.broker = {
        status: data.status || 'ok',
        uptime: data.uptime,
        providers: data.configuredProviders || [],
        responseMs: Date.now() - t0,
        lastError: null
      };
    } catch (err) {
      this.state.broker = { status: 'error', providers: [], responseMs: null, lastError: err.message };
    }
    this.broadcast('service_health', { broker: this.state.broker, memoryService: this.state.memoryService });
  }

  async _pollMemoryService() {
    const t0 = Date.now();
    try {
      const res = await fetch(`${MEMORY_URL}/health`, { signal: AbortSignal.timeout(4000) });
      const data = await res.json();
      this.state.memoryService = {
        status: data.status || 'ok',
        uptime: data.uptime,
        responseMs: Date.now() - t0,
        lastError: null
      };
    } catch (err) {
      this.state.memoryService = { status: 'error', responseMs: null, lastError: err.message };
    }
    this.broadcast('service_health', { broker: this.state.broker, memoryService: this.state.memoryService });
  }

  async _pollAgents() {
    const updated = [];

    for (const endpoint of this.agentEndpoints) {
      try {
        const res = await fetch(`${endpoint.url}/status`, { signal: AbortSignal.timeout(2000) });
        const data = await res.json();

        // Diff chat — surface new messages to the global feed
        const prev = this.state.agents.find(a => a.username === data.username);
        const prevChatLen = prev?.recentChat?.length || 0;
        if (data.recentChat && data.recentChat.length > prevChatLen) {
          const newMsgs = data.recentChat.slice(prevChatLen);
          for (const msg of newMsgs) {
            this.pushChat({ ...msg, agentUsername: data.username });
          }
        }

        updated.push({ ...data, _reachable: true });
      } catch (err) {
        const prev = this.state.agents.find(a => a.username === endpoint.name);
        updated.push({
          username: endpoint.name,
          online: false,
          _reachable: false,
          _error: err.message,
          stats: prev?.stats || {},
          lastDecision: prev?.lastDecision || null,
          activeGoal: prev?.activeGoal || null
        });
      }
    }

    this.state.agents = updated;
    this.broadcast('agents_state', updated);
  }
}

module.exports = Aggregator;
