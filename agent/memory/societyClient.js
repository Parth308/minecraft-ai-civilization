const logger = require('../../shared/logger');

// Thin client over memory-service /api/society/*. All calls are knowledge
// retrieval or record-keeping — never behavioral commands.
class SocietyClient {
  constructor(agentId) {
    this.agentId = agentId;
    this.serviceUrl = process.env.MEMORY_SERVICE_URL || 'http://localhost:3002';
    this.cacheTtlMs = parseInt(process.env.SOCIETY_CONTEXT_TTL_MS, 10) || 60000;
    this._contextCache = null;
    this._cacheTs = 0;
  }

  // Per-agent singleton registry so decision/dialogue layers share one cache
  static instances = new Map();
  static forAgent(agentId) {
    if (!SocietyClient.instances.has(agentId)) {
      SocietyClient.instances.set(agentId, new SocietyClient(agentId));
    }
    return SocietyClient.instances.get(agentId);
  }

  async getContext(force = false) {
    const now = Date.now();
    if (!force && this._contextCache && now - this._cacheTs < this.cacheTtlMs) {
      return this._contextCache;
    }
    try {
      const res = await fetch(`${this.serviceUrl}/api/society/context`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this._contextCache = await res.json();
      this._cacheTs = now;
      return this._contextCache;
    } catch (err) {
      logger.debug('SocietyClient', `Context fetch failed for ${this.agentId}: ${err.message}`);
      return this._contextCache;
    }
  }

  postGossip(aboutAgent, sentiment, fact) {
    return fetch(`${this.serviceUrl}/api/society/gossip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromAgent: this.agentId, aboutAgent, sentiment, fact })
    }).catch(err => logger.debug('SocietyClient', `Gossip post failed: ${err.message}`));
  }

  postNotice(type, title, body) {
    return fetch(`${this.serviceUrl}/api/society/notices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ author: this.agentId, type, title, body })
    }).catch(err => logger.debug('SocietyClient', `Notice post failed: ${err.message}`));
  }

  proposeConvention(key, value) {
    return fetch(`${this.serviceUrl}/api/society/conventions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: this.agentId, key, value })
    }).catch(err => logger.debug('SocietyClient', `Convention proposal failed: ${err.message}`));
  }

  makePledge(description) {
    return fetch(`${this.serviceUrl}/api/society/pledges`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: this.agentId, description })
    }).catch(err => logger.debug('SocietyClient', `Pledge failed: ${err.message}`));
  }
}

module.exports = SocietyClient;
