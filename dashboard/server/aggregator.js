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
  const list = [];
  const raw = process.env.AGENT_STATUS_ENDPOINTS || '';
  if (raw) {
    for (const entry of raw.split(',')) {
      const idx = entry.indexOf(':');
      if (idx !== -1) {
        const name = entry.slice(0, idx).trim();
        const url = entry.slice(idx + 1).trim();
        if (name && url) list.push({ name, url });
      }
    }
  }

  // Also include explicit single-agent env vars if provided
  if (process.env.AGENT_ALPHA_STATUS_URL) list.push({ name: 'Agent_Alpha', url: process.env.AGENT_ALPHA_STATUS_URL.trim() });
  if (process.env.AGENT_BETA_STATUS_URL)  list.push({ name: 'Agent_Beta',  url: process.env.AGENT_BETA_STATUS_URL.trim() });
  if (process.env.AGENT_GAMMA_STATUS_URL) list.push({ name: 'Agent_Gamma', url: process.env.AGENT_GAMMA_STATUS_URL.trim() });

  // Default fallback candidates if none configured
  if (list.length === 0) {
    list.push(
      { name: 'Agent_Alpha', url: 'http://agent-alpha:3010' },
      { name: 'Agent_Beta',  url: 'http://agent-beta:3011' },
      { name: 'Agent_Gamma', url: 'http://agent-gamma:3012' },
      { name: 'Agent_Local', url: 'http://localhost:3010' }
    );
  }
  return list;
}

class Aggregator {
  constructor() {
    this.agentEndpoints = new Map(); // url -> { name, url, dynamic: boolean, lastSeen: number }
    for (const ep of parseAgentEndpoints()) {
      this.agentEndpoints.set(ep.url, { name: ep.name, url: ep.url, dynamic: false, lastSeen: 0 });
    }

    this.wsClients = new Set();
    this.chatHistory = [];    // last 100 messages across all agents
    this.state = {
      broker: { status: 'unknown', uptime: 0, providers: [], responseMs: null, lastError: null },
      brokerStats: null,
      memoryService: { status: 'unknown', uptime: 0, responseMs: null, lastError: null },
      spectator: { online: false, currentTarget: null, viewerReady: false },
      agents: []
    };
    this._intervals = [];
  }

  // ─── Dynamic Agent Registration ───────────────────────────────────────────

  registerAgent({ name, url }) {
    if (!url) return false;
    const cleanUrl = url.replace(/\/+$/, '');
    const cleanName = (name || 'Agent').trim();
    const existing = this.agentEndpoints.get(cleanUrl);

    // Check if we already have an endpoint for this name with a different URL, replace it to avoid duplicate polling
    for (const [key, ep] of this.agentEndpoints.entries()) {
      if (ep.name === cleanName && key !== cleanUrl) {
        this.agentEndpoints.delete(key);
      }
    }

    this.agentEndpoints.set(cleanUrl, {
      name: cleanName,
      url: cleanUrl,
      dynamic: true,
      lastSeen: Date.now()
    });

    if (!existing) {
      logger.info('Aggregator', `[Auto-Discovery] Registered new agent: "${cleanName}" at ${cleanUrl}`);
    }
    return true;
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
    const user = (msg.username || msg.agentUsername || 'Unknown').trim();
    const text = (msg.message || '').trim();
    if (!text) return;
    const now = Date.now();

    // Deduplicate: check if same user sent same message within 4 seconds
    const isDup = this.chatHistory.slice(-15).some(m => {
      const mUser = (m.username || m.agentUsername || 'Unknown').trim();
      const mText = (m.message || '').trim();
      const mTime = new Date(m.timestamp).getTime();
      return mUser === user && mText === text && Math.abs(now - mTime) < 4000;
    });

    if (isDup) return; // Drop duplicate echo!

    const entry = { ...msg, username: user, message: text, timestamp: msg.timestamp || new Date().toISOString() };
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
    // Poll broker stats every 3s (tokens/cost/rate-limits/escalations)
    this._intervals.push(setInterval(() => this._pollBrokerStats(), 3000));
    // Poll memory-service every 5s
    this._intervals.push(setInterval(() => this._pollMemoryService(), 5000));
    // Poll each agent every 2s
    this._intervals.push(setInterval(() => this._pollAgents(), 2000));
    // Auto-discover new agents every 8s
    this._intervals.push(setInterval(() => this._autoDiscoverAgents(), 8000));

    // Kick off immediately
    this._pollBroker();
    this._pollBrokerStats();
    this._pollMemoryService();
    this._pollAgents();
    this._autoDiscoverAgents();

    logger.info('Aggregator', 'Polling & dynamic agent discovery started');
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

  async _pollBrokerStats() {
    try {
      const res = await fetch(`${BROKER_URL}/api/stats`, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) throw new Error(`stats HTTP ${res.status}`);
      this.state.brokerStats = await res.json();

      // Check broker recent escalations to discover active agent IDs
      for (const esc of this.state.brokerStats?.recentEscalations || []) {
        if (esc.agentId && esc.agentId !== 'unknown') {
          // If we don't have this agent username yet, try to discover candidate endpoints
          const hasAgent = this.state.agents.some(a => a.username === esc.agentId);
          if (!hasAgent) {
            this._probeAgentCandidates(esc.agentId);
          }
        }
      }
    } catch (err) {
      if (this.state.brokerStats) {
        this.state.brokerStats._error = err.message;
      }
    }
    this.broadcast('broker_stats', this.state.brokerStats);
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

  // ─── Dynamic Auto-Discovery Prober ─────────────────────────────────────────

  async _probeCandidateUrl(name, url) {
    const cleanUrl = url.replace(/\/+$/, '');
    if (this.agentEndpoints.has(cleanUrl)) return;
    try {
      const res = await fetch(`${cleanUrl}/status`, { signal: AbortSignal.timeout(1200) });
      if (res.ok) {
        const data = await res.json();
        const detectedName = data.username || name;
        this.agentEndpoints.set(cleanUrl, { name: detectedName, url: cleanUrl, dynamic: true, lastSeen: Date.now() });
        logger.info('Aggregator', `[Auto-Discovery] Found active agent "${detectedName}" at ${cleanUrl}`);
      }
    } catch { /* ignore inactive probe candidates */ }
  }

  async _probeAgentCandidates(agentId) {
    const hostCandidates = [
      `http://${agentId.toLowerCase().replace('_', '-')}:3010`,
      `http://${agentId.toLowerCase().replace('_', '-')}:3011`,
      `http://${agentId.toLowerCase()}:3010`,
      `http://${agentId.toLowerCase()}:3011`
    ];
    for (const url of hostCandidates) {
      this._probeCandidateUrl(agentId, url);
    }
  }

  async _autoDiscoverAgents() {
    // 1. Probes localhost ports 3010..3020 for local dev agents
    for (let port = 3010; port <= 3020; port++) {
      this._probeCandidateUrl(`Agent_Port_${port}`, `http://localhost:${port}`);
      this._probeCandidateUrl(`Agent_Port_${port}`, `http://127.0.0.1:${port}`);
    }

    // 2. Probes standard Docker network container names
    const standardContainers = [
      { name: 'Agent_Alpha', url: 'http://agent-alpha:3010' },
      { name: 'Agent_Beta',  url: 'http://agent-beta:3011' },
      { name: 'Agent_Gamma', url: 'http://agent-gamma:3012' },
      { name: 'Agent_Delta', url: 'http://agent-delta:3013' },
      { name: 'Agent_Epsilon', url: 'http://agent-epsilon:3014' },
      { name: 'Agent_1', url: 'http://agent-1:3010' },
      { name: 'Agent_2', url: 'http://agent-2:3011' }
    ];

    for (const c of standardContainers) {
      this._probeCandidateUrl(c.name, c.url);
    }
  }

  async _pollAgentEndpoint(endpoint) {
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

      endpoint.lastSeen = Date.now();
      return { ...data, _reachable: true, _endpointUrl: endpoint.url };
    } catch (err) {
      const prev = this.state.agents.find(a => a.username === endpoint.name || a._endpointUrl === endpoint.url);
      return {
        username: prev?.username || endpoint.name,
        online: false,
        _reachable: false,
        _error: err.message,
        _endpointUrl: endpoint.url,
        stats: prev?.stats || {},
        lastDecision: prev?.lastDecision || null,
        activeGoal: prev?.activeGoal || null,
        recentDecisions: prev?.recentDecisions || []
      };
    }
  }

  async _pollAgents() {
    const promises = [];
    for (const endpoint of this.agentEndpoints.values()) {
      promises.push(this._pollAgentEndpoint(endpoint));
    }

    const results = await Promise.all(promises);

    // Merge by unique username (if multiple URLs resolve to the same agent, keep the online/reachable one)
    const agentMap = new Map();
    for (const res of results) {
      const existing = agentMap.get(res.username);
      if (!existing || (res.online && !existing.online)) {
        agentMap.set(res.username, res);
      }
    }

    const updated = Array.from(agentMap.values());
    this.state.agents = updated;
    this.broadcast('agents_state', updated);
  }
}

module.exports = Aggregator;
