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

  // ── Property / theft justice ────────────────────────────────────────────────

  claimChest(x, y, z, label = 'chest') {
    return fetch(`${this.serviceUrl}/api/society/property/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: this.agentId, x, y, z, label })
    }).catch(err => logger.debug('SocietyClient', `Chest claim failed: ${err.message}`));
  }

  shareChest(x, y, z, withAgent) {
    return fetch(`${this.serviceUrl}/api/society/property/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: this.agentId, x, y, z, withAgent })
    }).catch(err => logger.debug('SocietyClient', `Chest share failed: ${err.message}`));
  }

  // Returns { trespass, owner } verdict — caller decides how to react
  logAccess(x, y, z) {
    return fetch(`${this.serviceUrl}/api/society/property/access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: this.agentId, x, y, z })
    }).then(r => r.json()).catch(err => {
      logger.debug('SocietyClient', `Access log failed: ${err.message}`);
      return {};
    });
  }

  fileAccusation(accused, chestKey, claimedItems = '') {
    return fetch(`${this.serviceUrl}/api/society/accusations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accuser: this.agentId, accused, chestKey, claimedItems })
    }).then(r => r.json()).catch(err => {
      logger.debug('SocietyClient', `Accusation failed: ${err.message}`);
      return {};
    });
  }

  // ── Credit & debt ───────────────────────────────────────────────────────────

  createDebt(debtor, item, amount, context = '') {
    return fetch(`${this.serviceUrl}/api/society/debts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creditor: this.agentId, debtor, item, amount, context })
    }).then(r => r.json()).catch(err => {
      logger.debug('SocietyClient', `Debt creation failed: ${err.message}`);
      return {};
    });
  }

  resolveDebt(debtId, action) {
    const byField = action === 'paid' ? 'byDebtor' : 'byCreditor';
    return fetch(`${this.serviceUrl}/api/society/debts/${debtId}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [byField]: this.agentId })
    }).then(r => r.json()).catch(err => {
      logger.debug('SocietyClient', `Debt ${action} failed: ${err.message}`);
      return {};
    });
  }
  // ── Intel marketplace ───────────────────────────────────────────────────────

  listIntel(title, fact, priceItem = 'iron_ingot', priceAmount = 1) {
    return fetch(`${this.serviceUrl}/api/society/intel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seller: this.agentId, title, fact, priceItem, priceAmount })
    }).then(r => r.json()).catch(err => {
      logger.debug('SocietyClient', `Intel listing failed: ${err.message}`);
      return {};
    });
  }

  purchaseIntel(intelId) {
    return fetch(`${this.serviceUrl}/api/society/intel/${intelId}/purchase`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ buyer: this.agentId })
    }).then(r => r.json()).catch(err => {
      logger.debug('SocietyClient', `Intel purchase failed: ${err.message}`);
      return {};
    });
  }

  addGrievance(against, reason, weight = 1) {
    return fetch(`${this.serviceUrl}/api/society/grievances`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ by: this.agentId, against, reason, weight })
    }).then(r => r.json()).catch(err => {
      logger.debug('SocietyClient', `Grievance failed: ${err.message}`);
      return {};
    });
  }

  // ── Wallets / market / place-memory ────────────────────────────────────────

  transfer(toAgent, currency, amount, reason = '') {
    return fetch(`${this.serviceUrl}/api/society/wallets/transfer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromAgent: this.agentId, toAgent, currency, amount, reason })
    }).then(r => r.json()).catch(err => {
      logger.debug('SocietyClient', `Transfer failed: ${err.message}`);
      return {};
    });
  }

  mint(currency, amount, reason) {
    return fetch(`${this.serviceUrl}/api/society/wallets/mint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: this.agentId, currency, amount, reason })
    }).then(r => r.json()).catch(err => {
      logger.debug('SocietyClient', `Mint failed: ${err.message}`);
      return {};
    });
  }

  walletBalance() {
    return fetch(`${this.serviceUrl}/api/society/wallets/${encodeURIComponent(this.agentId)}`)
      .then(r => r.json()).catch(() => ({ balances: {} }));
  }

  marketPrice(item) {
    return fetch(`${this.serviceUrl}/api/society/market/price/${encodeURIComponent(item)}`)
      .then(r => r.json()).catch(() => ({ average: null }));
  }

  rememberPlace(x, z, sentiment, label, radius = 16, y = null) {
    return fetch(`${this.serviceUrl}/api/society/places`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: this.agentId, x, z, sentiment, label, radius, y })
    }).then(r => r.json()).catch(err => {
      logger.debug('SocietyClient', `Place memory failed: ${err.message}`);
      return {};
    });
  }

  async placesNear(x, z, radius = 24) {
    try {
      const res = await fetch(`${this.serviceUrl}/api/society/places/near?agentId=${encodeURIComponent(this.agentId)}&x=${Math.round(x)}&z=${Math.round(z)}&radius=${radius}`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return (await res.json()).places || [];
    } catch { /* fall through */ }
    return [];
  }

  // ── Faith vessel ────────────────────────────────────────────────────────────

  setFaith(state = null, tradition = undefined) {
    return fetch(`${this.serviceUrl}/api/society/faith`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: this.agentId, state, tradition })
    }).then(r => r.json()).catch(err => {
      logger.debug('SocietyClient', `Faith update failed: ${err.message}`);
      return {};
    });
  }

  attendRite(riteType = 'reflection') {
    return fetch(`${this.serviceUrl}/api/society/faith/rite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: this.agentId, riteType, coords: this._lastPos || null })
    }).then(r => r.json()).catch(err => {
      logger.debug('SocietyClient', `Rite failed: ${err.message}`);
      return {};
    });
  }

  async faithContext() {
    try {
      const res = await fetch(`${this.serviceUrl}/api/society/faith/${encodeURIComponent(this.agentId)}`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return await res.json();
    } catch { /* optional */ }
    return null;
  }

  // Position cache — rites auto-attach coordinates so group bonding works
  setLastPosition(x, z, y = null) {
    this._lastPos = { x: Math.round(x), y: y == null ? null : Math.round(y), z: Math.round(z) };
  }

  foundClan(name, motto = '') {
    return fetch(`${this.serviceUrl}/api/society/clans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: this.agentId, name, motto })
    }).then(r => r.json()).catch(err => {
      logger.debug('SocietyClient', `Clan founding failed: ${err.message}`);
      return {};
    });
  }

  joinClan(name) {
    return fetch(`${this.serviceUrl}/api/society/clans/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: this.agentId, name })
    }).then(r => r.json()).catch(err => {
      logger.debug('SocietyClient', `Clan join failed: ${err.message}`);
      return {};
    });
  }
}

module.exports = SocietyClient;
