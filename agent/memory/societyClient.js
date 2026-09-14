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

  postGossip(aboutAgent, sentiment, fact, fidelity = 0.75) {
    return fetch(`${this.serviceUrl}/api/society/gossip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromAgent: this.agentId, aboutAgent, sentiment, fact, fidelity })
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
    const payload = { creditor: this.agentId, debtor, item, amount, context };
    // Bug 6: dual-write to ledger/debts so the dashboard/settle-check read from
    // the same source as the society debt store. Fire-and-forget, non-blocking.
    fetch(`${this.serviceUrl}/api/ledger/debts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(() => {});
    return fetch(`${this.serviceUrl}/api/society/debts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(r => r.json()).catch(err => {
      logger.debug('SocietyClient', `Debt creation failed: ${err.message}`);
      return {};
    });
  }

  oweDebt(creditor, item, amount, context = '') {
    const payload = { creditor, debtor: this.agentId, item, amount, context };
    // Bug 6: dual-write to ledger/debts (see createDebt above).
    fetch(`${this.serviceUrl}/api/ledger/debts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(() => {});
    return fetch(`${this.serviceUrl}/api/society/debts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(r => r.json()).catch(err => {
      logger.debug('SocietyClient', `IOU creation failed: ${err.message}`);
      return {};
    });
  }

  logTreaty(target, treatyType, honorsStatus = true) {
    return fetch(`${this.serviceUrl}/api/ledger/treaty`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proposer: this.agentId, target, treatyType, honorsStatus })
    }).then(r => r.json()).catch(err => {
      logger.debug('SocietyClient', `Treaty log failed: ${err.message}`);
      return {};
    });
  }

  registerCurrency(name, description = '') {
    return fetch(`${this.serviceUrl}/api/ledger/currency`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, establishedBy: this.agentId, description })
    }).then(r => r.json()).catch(err => {
      logger.debug('SocietyClient', `Currency register failed: ${err.message}`);
      return {};
    });
  }

  proposeSharedGoal(description, requiredAgents = 2, requiredContributions = [{ item: 'cobblestone', count: 16 }]) {
    return fetch(`${this.serviceUrl}/api/ledger/shared-goals/propose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creatorAgentId: this.agentId, description, requiredAgents, requiredContributions })
    }).then(r => r.json()).catch(err => {
      logger.debug('SocietyClient', `Shared goal propose failed: ${err.message}`);
      return {};
    });
  }

  async getOpenDebts() {
    try {
      const res = await fetch(`${this.serviceUrl}/api/society/debts/open?agentId=${encodeURIComponent(this.agentId)}`, { signal: AbortSignal.timeout(4000) });
      if (res.ok) return (await res.json()).debts || [];
    } catch { /* fall through */ }
    return [];
  }

  payDebt(debtId) {
    return fetch(`${this.serviceUrl}/api/society/debts/${encodeURIComponent(debtId)}/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ byDebtor: this.agentId })
    }).then(r => r.json()).catch(err => {
      logger.debug('SocietyClient', `Debt pay failed: ${err.message}`);
      return {};
    });
  }

  resolveDebt(debtId, action) {    const byField = action === 'paid' ? 'byDebtor' : 'byCreditor';
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
    return fetch(`${this.serviceUrl}/api/society/intel/${encodeURIComponent(intelId)}/purchase`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ buyer: this.agentId })
    }).then(r => r.json()).catch(err => {
      logger.debug('SocietyClient', `Intel purchase failed: ${err.message}`);
      return {};
    });
  }

  async purchaseIntelFromMarket() {
    try {
      const res = await fetch(`${this.serviceUrl}/api/society/intel`, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) return {};
      const listings = ((await res.json()).listings || []).filter(l => l.seller !== this.agentId && l.status === 'listed');
      if (!listings.length) return {};
      return this.purchaseIntel(listings[0].id);
    } catch {
      return {};
    }
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

  // ── Job board ───────────────────────────────────────────────────────────────

  postJob(title, description, currency, amount) {
    return fetch(`${this.serviceUrl}/api/society/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ poster: this.agentId, title, description, currency, amount })
    }).then(r => r.json()).catch(err => {
      logger.debug('SocietyClient', `Job post failed: ${err.message}`);
      return {};
    });
  }

  claimJob(jobId) {
    return fetch(`${this.serviceUrl}/api/society/jobs/${jobId}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worker: this.agentId })
    }).then(r => r.json()).catch(err => {
      logger.debug('SocietyClient', `Job claim failed: ${err.message}`);
      return {};
    });
  }

  resolveJob(jobId, action) {
    const byField = action === 'complete' ? 'byWorker' : 'byPoster';
    return fetch(`${this.serviceUrl}/api/society/jobs/${jobId}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [byField]: this.agentId })
    }).then(r => r.json()).catch(err => {
      logger.debug('SocietyClient', `Job ${action} failed: ${err.message}`);
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

  proposeEvent(type, purpose, location, coords = null) {
    return fetch(`${this.serviceUrl}/api/society/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proposer: this.agentId, type, purpose, location, coords })
    }).then(r => r.json()).catch(err => {
      logger.debug('SocietyClient', `Event propose failed: ${err.message}`);
      return {};
    });
  }

  rsvpEvent(eventId, attending) {
    return fetch(`${this.serviceUrl}/api/society/events/${encodeURIComponent(eventId)}/rsvp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: this.agentId, attending })
    }).then(r => r.json()).catch(err => {
      logger.debug('SocietyClient', `Event RSVP failed: ${err.message}`);
      return {};
    });
  }

  attendEvent(eventId) {
    return fetch(`${this.serviceUrl}/api/society/events/${encodeURIComponent(eventId)}/attend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: this.agentId })
    }).then(r => r.json()).catch(err => {
      logger.debug('SocietyClient', `Event attend failed: ${err.message}`);
      return {};
    });
  }

  completeEvent(eventId, outcome = '') {
    return fetch(`${this.serviceUrl}/api/society/events/${encodeURIComponent(eventId)}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outcome })
    }).then(r => r.json()).catch(err => {
      logger.debug('SocietyClient', `Event complete failed: ${err.message}`);
      return {};
    });
  }

  async getActiveEvents() {
    try {
      const res = await fetch(`${this.serviceUrl}/api/society/events/active`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return (await res.json()).events || [];
    } catch { /* fall through */ }
    return [];
  }

  async getRecentEvents(limit = 10) {
    try {
      const res = await fetch(`${this.serviceUrl}/api/society/events?limit=${limit}`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return (await res.json()).events || [];
    } catch { /* fall through */ }
    return [];
  }

  accuse(target, reason, evidence = '') {
    return fetch(`${this.serviceUrl}/api/society/trials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accuser: this.agentId, target, reason, evidence })
    }).then(r => r.json()).catch(err => {
      logger.debug('SocietyClient', `Accusation failed: ${err.message}`);
      return {};
    });
  }

  supportTrial(trialId) {
    return fetch(`${this.serviceUrl}/api/society/trials/${encodeURIComponent(trialId)}/support`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: this.agentId })
    }).then(r => r.json()).catch(err => {
      logger.debug('SocietyClient', `Trial support failed: ${err.message}`);
      return {};
    });
  }

  declareVerdict(trialId, verdict, sentence = '') {
    return fetch(`${this.serviceUrl}/api/society/trials/${encodeURIComponent(trialId)}/verdict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verdict, sentence })
    }).then(r => r.json()).catch(err => {
      logger.debug('SocietyClient', `Verdict failed: ${err.message}`);
      return {};
    });
  }

  async getPendingTrials() {
    try {
      const res = await fetch(`${this.serviceUrl}/api/society/trials/pending`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return (await res.json()).trials || [];
    } catch { /* fall through */ }
    return [];
  }

  exile(target, reason) {
    return fetch(`${this.serviceUrl}/api/society/exiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initiator: this.agentId, target, reason })
    }).then(r => r.json()).catch(err => {
      logger.debug('SocietyClient', `Exile failed: ${err.message}`);
      return {};
    });
  }

  supportExile(exileId) {
    return fetch(`${this.serviceUrl}/api/society/exiles/${encodeURIComponent(exileId)}/support`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: this.agentId })
    }).then(r => r.json()).catch(err => {
      logger.debug('SocietyClient', `Exile support failed: ${err.message}`);
      return {};
    });
  }

  liftExile(exileId) {
    return fetch(`${this.serviceUrl}/api/society/exiles/${encodeURIComponent(exileId)}/lift`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }
    }).then(r => r.json()).catch(err => {
      logger.debug('SocietyClient', `Lift exile failed: ${err.message}`);
      return {};
    });
  }

  async getActiveExiles() {
    try {
      const res = await fetch(`${this.serviceUrl}/api/society/exiles`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return (await res.json()).exiles || [];
    } catch { /* fall through */ }
    return [];
  }

  async isExiled(agentId) {
    try {
      const res = await fetch(`${this.serviceUrl}/api/society/exiles/check/${encodeURIComponent(agentId)}`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) { const d = await res.json(); return d.exiled; }
    } catch { /* fall through */ }
    return false;
  }

  levyTax(targetId, item, amount = 1, reason = 'tax') {
    return fetch(`${this.serviceUrl}/api/society/leader/tax`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chiefId: this.agentId, targetId, item, amount, reason })
    }).then(r => r.json()).catch(err => {
      logger.debug('SocietyClient', `Tax levy failed: ${err.message}`);
      return {};
    });
  }

  fulfillTax(levyId) {
    return fetch(`${this.serviceUrl}/api/society/leader/tax/${encodeURIComponent(levyId)}/fulfill`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }
    }).then(r => r.json()).catch(err => {
      logger.debug('SocietyClient', `Tax fulfill failed: ${err.message}`);
      return {};
    });
  }

  async getPendingTaxes(agentId) {
    try {
      const res = await fetch(`${this.serviceUrl}/api/society/leader/taxes?targetId=${encodeURIComponent(agentId || this.agentId)}`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return (await res.json()).taxes || [];
    } catch { /* fall through */ }
    return [];
  }
}

module.exports = SocietyClient;
