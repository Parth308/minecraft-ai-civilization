const fs = require('fs');
const path = require('path');
const logger = require('../shared/logger');

// Society knowledge layer: gossip/reputation, public notices, conventions,
// and social pledges. Stores KNOWLEDGE only — agents decide freely what to do
// with it. No endpoint here ever forces behavior.
const SOCIETY_PATH = process.env.SOCIETY_FILE_PATH || path.join(__dirname, 'civilization', 'society.json');

class SocietyStore {
  constructor() {
    this.filePath = SOCIETY_PATH;
    this.ensureFileExists();
  }

  ensureFileExists() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, JSON.stringify({
        reputation: {},
        gossip: [],
        notices: [],
        conventions: {},
        pledges: [],
        property: {},
        accessLog: [],
        accusations: [],
        debts: [],
        intel: [],
        grievances: [],
        updatedAt: new Date().toISOString()
      }, null, 2), 'utf-8');
    }
  }

  load() {
    this.ensureFileExists();
    try {
      const data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      if (!data.reputation || typeof data.reputation !== 'object') data.reputation = {};
      if (!Array.isArray(data.gossip)) data.gossip = [];
      if (!Array.isArray(data.notices)) data.notices = [];
      if (!data.conventions || typeof data.conventions !== 'object') data.conventions = {};
      if (!Array.isArray(data.pledges)) data.pledges = [];
      if (!data.property || typeof data.property !== 'object') data.property = {};
      if (!Array.isArray(data.accessLog)) data.accessLog = [];
      if (!Array.isArray(data.accusations)) data.accusations = [];
      if (!Array.isArray(data.debts)) data.debts = [];
      if (!Array.isArray(data.intel)) data.intel = [];
      if (!Array.isArray(data.grievances)) data.grievances = [];
      return data;
    } catch (err) {
      logger.error('SocietyStore', 'Failed to read society file', err);
      return { reputation: {}, gossip: [], notices: [], conventions: {}, pledges: [], property: {}, accessLog: [], accusations: [], debts: [], intel: [], grievances: [], updatedAt: new Date().toISOString() };
    }
  }

  save(data) {
    data.updatedAt = new Date().toISOString();
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  // ── Gossip & Reputation ──────────────────────────────────────────────────────

  addGossip(fromAgent, aboutAgent, sentiment, fact) {
    const s = Number(sentiment);
    if (!fromAgent || !aboutAgent || !Number.isFinite(s)) {
      return { success: false, reason: 'fromAgent, aboutAgent and numeric sentiment required' };
    }
    if (fromAgent.toLowerCase() === aboutAgent.toLowerCase()) {
      return { success: false, reason: 'Agents cannot gossip about themselves' };
    }

    const data = this.load();
    const entry = {
      id: `gsp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      from: fromAgent,
      about: aboutAgent,
      sentiment: Math.max(-1, Math.min(1, Number(s.toFixed(2)))),
      fact: String(fact || '').slice(0, 280),
      timestamp: new Date().toISOString()
    };
    data.gossip.push(entry);
    if (data.gossip.length > 400) data.gossip.splice(0, data.gossip.length - 400);

    const rep = data.reputation[aboutAgent] || { score: 0, positives: 0, negatives: 0 };
    rep.score = Math.max(-100, Math.min(100, rep.score + entry.sentiment * 10));
    if (entry.sentiment >= 0) rep.positives += 1; else rep.negatives += 1;
    rep.lastUpdated = entry.timestamp;
    data.reputation[aboutAgent] = rep;

    this.save(data);
    logger.info('SocietyStore', `[GOSSIP] ${fromAgent} spread word about ${aboutAgent} (sentiment ${entry.sentiment}): "${entry.fact}" | rep score now ${rep.score}`);
    return { success: true, gossip: entry, reputation: rep };
  }

  getReputation(agentId) {
    const data = this.load();
    const rep = data.reputation[agentId] || { score: 0, positives: 0, negatives: 0 };
    const heard = data.gossip.filter(g => g.about.toLowerCase() === String(agentId).toLowerCase()).slice(-10);
    return { agentId, ...rep, recentGossip: heard };
  }

  // ── Public Notices (persistent artifacts) ────────────────────────────────────

  addNotice(author, type, title, body) {
    if (!author || !title) return { success: false, reason: 'author and title required' };
    const data = this.load();
    const entry = {
      id: `ntc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      author,
      type: ['law', 'guide', 'map', 'request', 'lore'].includes(type) ? type : 'notice',
      title: String(title).slice(0, 120),
      body: String(body || '').slice(0, 600),
      timestamp: new Date().toISOString()
    };
    data.notices.push(entry);
    if (data.notices.length > 200) data.notices.splice(0, data.notices.length - 200);
    this.save(data);
    logger.info('SocietyStore', `[NOTICE POSTED] ${author} (${entry.type}): "${entry.title}"`);
    return { success: true, notice: entry };
  }

  getNotices(limit = 20) {
    return this.load().notices.slice().reverse().slice(0, limit);
  }

  // ── Conventions (emergent norms) ─────────────────────────────────────────────

  proposeConvention(agentId, key, value) {
    if (!agentId || !key || value === undefined) return { success: false, reason: 'agentId, key and value required' };
    const data = this.load();
    const existing = data.conventions[key];

    if (!existing) {
      data.conventions[key] = { value, proposedBy: agentId, adopters: [agentId], history: [], timestamp: new Date().toISOString() };
      logger.info('SocietyStore', `[CONVENTION PROPOSED] ${agentId}: ${key} = "${value}"`);
    } else if (String(existing.value).toLowerCase() === String(value).toLowerCase()) {
      if (!existing.adopters.includes(agentId)) existing.adopters.push(agentId);
      logger.info('SocietyStore', `[CONVENTION ADOPTED] ${agentId} adopted ${key} = "${value}" (${existing.adopters.length} adherents)`);
    } else {
      existing.history.push({ value: existing.value, proposedBy: existing.proposedBy });
      existing.value = value;
      existing.proposedBy = agentId;
      existing.adopters = [agentId];
      existing.timestamp = new Date().toISOString();
      logger.warn('SocietyStore', `[CONVENTION CHALLENGED] ${agentId} replaced ${key}: now "${value}"`);
    }
    this.save(data);
    return { success: true, convention: data.conventions[key] };
  }

  getConventions() {
    return this.load().conventions;
  }

  // ── Pledges (social accountability) ──────────────────────────────────────────

  addPledge(agentId, description) {
    if (!agentId || !description) return { success: false, reason: 'agentId and description required' };
    const data = this.load();
    const entry = {
      id: `plg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      agentId,
      description: String(description).slice(0, 240),
      status: 'open',
      timestamp: new Date().toISOString()
    };
    data.pledges.push(entry);
    if (data.pledges.length > 100) data.pledges.splice(0, data.pledges.length - 100);
    this.save(data);
    logger.info('SocietyStore', `[PLEDGE MADE] ${agentId}: "${entry.description}"`);
    return { success: true, pledge: entry };
  }

  resolvePledge(pledgeId, status, resolvedBy) {
    if (!['kept', 'broken'].includes(status)) return { success: false, reason: "status must be 'kept' or 'broken'" };
    const data = this.load();
    const pledge = data.pledges.find(p => p.id === pledgeId && p.status === 'open');
    if (!pledge) return { success: false, reason: 'Open pledge not found' };

    pledge.status = status;
    pledge.resolvedAt = new Date().toISOString();
    if (resolvedBy && resolvedBy.toLowerCase() !== pledge.agentId.toLowerCase()) {
      pledge.witnessedBy = resolvedBy;

      // Broken promises witnessed by others automatically become negative gossip —
      // social consequence, not mechanical punishment.
      if (status === 'broken') {
        const rep = data.reputation[pledge.agentId] || { score: 0, positives: 0, negatives: 0 };
        rep.score = Math.max(-100, rep.score - 12);
        rep.negatives += 1;
        rep.lastUpdated = pledge.resolvedAt;
        data.reputation[pledge.agentId] = rep;
        data.gossip.push({
          id: `gsp_${Date.now()}_w`, from: resolvedBy, about: pledge.agentId,
          sentiment: -0.7, fact: `Broke a public promise: "${pledge.description}"`,
          timestamp: pledge.resolvedAt
        });
      }
    }
    this.save(data);
    logger.info('SocietyStore', `[PLEDGE ${status.toUpperCase()}] ${pledge.agentId}'s pledge resolved by ${resolvedBy || 'self'}: "${pledge.description}"`);
    return { success: true, pledge };
  }

  getPledges(openOnly = true) {
    const pledges = this.load().pledges;
    return openOnly ? pledges.filter(p => p.status === 'open') : pledges.slice(-30);
  }

  // ── Property Registry & Theft Justice ────────────────────────────────────────

  claimChest(agentId, x, y, z, label = 'chest') {
    if (agentId == null || x == null || y == null || z == null) return { success: false, reason: 'agentId and coordinates required' };
    const data = this.load();
    const key = `${Math.round(x)},${Math.round(y)},${Math.round(z)}`;
    const existing = data.property[key];
    if (existing && existing.owner !== agentId) {
      return { success: false, reason: `Already owned by ${existing.owner}` };
    }
    data.property[key] = { owner: agentId, label, sharedWith: existing?.sharedWith || [], placedAt: existing?.placedAt || new Date().toISOString() };
    this.save(data);
    logger.info('SocietyStore', `[PROPERTY] ${agentId} owns ${label} @ ${key}`);
    return { success: true, key, property: data.property[key] };
  }

  shareChest(agentId, x, y, z, withAgent) {
    const key = `${Math.round(x)},${Math.round(y)},${Math.round(z)}`;
    const data = this.load();
    const prop = data.property[key];
    if (!prop) return { success: false, reason: 'Unknown chest — owner must claim it first' };
    if (prop.owner !== agentId) return { success: false, reason: `Only the owner (${prop.owner}) can share` };
    if (!prop.sharedWith.includes(withAgent)) prop.sharedWith.push(withAgent);
    this.save(data);
    logger.info('SocietyStore', `[PROPERTY SHARED] ${agentId} granted ${withAgent} access to ${key}`);
    return { success: true, property: prop };
  }

  // Every chest opening flows through here. Returns ownership verdict for the
  // accessor and permanently logs the access as potential evidence.
  logChestAccess(agentId, x, y, z) {
    const key = `${Math.round(x)},${Math.round(y)},${Math.round(z)}`;
    const data = this.load();
    data.accessLog.push({ chestKey: key, agentId, timestamp: new Date().toISOString() });
    if (data.accessLog.length > 300) data.accessLog.splice(0, data.accessLog.length - 300);

    const prop = data.property[key];
    let verdict = { chestKey: key, unregistered: !prop };
    if (prop && prop.owner !== agentId && !prop.sharedWith.includes(agentId)) {
      verdict.trespass = true;
      verdict.owner = prop.owner;
      logger.warn('SocietyStore', `[TRESPASS LOGGED] ${agentId} opened ${prop.owner}'s ${prop.label} @ ${key} (evidence recorded)`);
    } else {
      logger.debug('SocietyStore', `[ACCESS OK] ${agentId} @ ${key}${prop ? ` (${prop.owner === agentId ? 'own' : 'shared'})` : ''}`);
    }
    this.save(data);
    return verdict;
  }

  fileAccusation(accuserId, accusedId, chestKey, claimedItems = '') {
    if (!accuserId || !accusedId || accuserId.toLowerCase() === accusedId.toLowerCase()) {
      return { success: false, reason: 'Valid distinct accuser/accused required' };
    }
    const data = this.load();

    // Evidence is objective: the accused's access entries on that exact chest
    const evidence = data.accessLog.filter(a =>
      a.chestKey === String(chestKey) && a.agentId.toLowerCase() === accusedId.toLowerCase()
    );

    const entry = {
      id: `acc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      accuser: accuserId,
      accused: accusedId,
      chestKey,
      claimedItems: String(claimedItems).slice(0, 160),
      evidenceCount: evidence.length,
      status: 'open',
      timestamp: new Date().toISOString()
    };
    data.accusations.push(entry);
    if (data.accusations.length > 80) data.accusations.splice(0, data.accusations.length - 80);
    this.save(data);

    logger.warn('SocietyStore', `[ACCUSATION FILED] ${accuserId} accuses ${accusedId} of theft @ ${chestKey} | access-log evidence: ${evidence.length} records`);
    return { success: true, accusation: entry, evidence };
  }

  resolveAccusation(accusationId, verdict, resolvedBy) {
    if (!['guilty', 'innocent', 'dismissed'].includes(verdict)) return { success: false, reason: "verdict must be guilty|innocent|dismissed" };
    const data = this.load();
    const acc = data.accusations.find(a => a.id === accusationId && a.status === 'open');
    if (!acc) return { success: false, reason: 'Open accusation not found' };

    acc.status = verdict;
    acc.resolvedBy = resolvedBy;
    acc.resolvedAt = new Date().toISOString();

    // Verdicts carry social consequences through the reputation system
    const applyRep = (agentId, delta, fact) => {
      const rep = data.reputation[agentId] || { score: 0, positives: 0, negatives: 0 };
      rep.score = Math.max(-100, Math.min(100, rep.score + delta));
      delta >= 0 ? rep.positives++ : rep.negatives++;
      rep.lastUpdated = acc.resolvedAt;
      data.reputation[agentId] = rep;
      data.gossip.push({ id: `gsp_${Date.now()}_v`, from: resolvedBy || 'community', about: agentId, sentiment: delta / 20, fact, timestamp: acc.resolvedAt });
    };

    if (verdict === 'guilty') applyRep(acc.accused, -20, `Found GUILTY of stealing from ${acc.accuser} (${acc.claimedItems})`);
    else if (verdict === 'innocent' && acc.evidenceCount === 0) applyRep(acc.accuser, -8, `Filed an accusation against ${acc.accused} with zero evidence`);
    else if (verdict === 'innocent') applyRep(acc.accused, 6, `Cleared of ${acc.accuser}'s accusation`);

    if (data.gossip.length > 400) data.gossip.splice(0, data.gossip.length - 400);
    this.save(data);
    logger.warn('SocietyStore', `[VERDICT: ${verdict.toUpperCase()}] Case ${accusationId} resolved by ${resolvedBy}: ${acc.accused} vs ${acc.accuser}`);
    return { success: true, accusation: acc };
  }

  // ── Credit & Debt ────────────────────────────────────────────────────────────

  addDebt(creditor, debtor, item, amount, context = '') {
    if (!creditor || !debtor || creditor.toLowerCase() === debtor.toLowerCase()) {
      return { success: false, reason: 'Distinct creditor and debtor required' };
    }
    const data = this.load();
    const entry = {
      id: `dbt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      creditor,
      debtor,
      item: String(item).slice(0, 60),
      amount: Math.max(1, parseInt(amount, 10) || 1),
      context: String(context).slice(0, 160),
      status: 'open',
      createdAt: new Date().toISOString()
    };
    data.debts.push(entry);
    if (data.debts.length > 120) data.debts.splice(0, data.debts.length - 120);
    this.save(data);
    logger.info('SocietyStore', `[DEBT CREATED] ${debtor} owes ${creditor}: ${entry.amount}x ${entry.item} (${entry.context})`);
    return { success: true, debt: entry };
  }

  _resolveDebt(data, debtId, status, actor) {
    const debt = data.debts.find(d => d.id === debtId && d.status === 'open');
    if (!debt) return { success: false, reason: 'Open debt not found' };

    // Only the party whose action it is may resolve
    if (status === 'paid' && debt.debtor !== actor) return { success: false, reason: 'Only the debtor can repay' };
    if (status === 'forgiven' && debt.creditor !== actor) return { success: false, reason: 'Only the creditor can forgive' };
    if (status === 'defaulted' && debt.creditor !== actor) return { success: false, reason: 'Only the creditor can declare default' };

    debt.status = status;
    debt.resolvedAt = new Date().toISOString();

    const rep = (agentId, delta, fact) => {
      const r = data.reputation[agentId] || { score: 0, positives: 0, negatives: 0 };
      r.score = Math.max(-100, Math.min(100, r.score + delta));
      delta >= 0 ? r.positives++ : r.negatives++;
      r.lastUpdated = debt.resolvedAt;
      data.reputation[agentId] = r;
      data.gossip.push({ id: `gsp_${Date.now()}_d`, from: actor || 'community', about: agentId, sentiment: delta / 20, fact, timestamp: debt.resolvedAt });
    };

    if (status === 'paid') rep(debt.debtor, 8, `Honored a debt: returned ${debt.amount}x ${debt.item} to ${debt.creditor}`);
    else if (status === 'forgiven') rep(debt.creditor, 6, `Generously forgave ${debt.debtor}'s debt of ${debt.amount}x ${debt.item}`);
    else if (status === 'defaulted') rep(debt.debtor, -15, `Defaulted on debt owed to ${debt.creditor}: ${debt.amount}x ${debt.item}`);

    if (data.gossip.length > 400) data.gossip.splice(0, data.gossip.length - 400);
    logger.warn('SocietyStore', `[DEBT ${status.toUpperCase()}] ${debt.debtor}/${debt.creditor} ${debt.amount}x ${debt.item}`);
    return { success: true, debt };
  }

  payDebt(debtId, byDebtor) {
    const data = this.load();
    const result = this._resolveDebt(data, debtId, 'paid', byDebtor);
    this.save(data);
    return result;
  }

  forgiveDebt(debtId, byCreditor) {
    const data = this.load();
    const result = this._resolveDebt(data, debtId, 'forgiven', byCreditor);
    this.save(data);
    return result;
  }

  defaultDebt(debtId, byCreditor) {
    const data = this.load();
    const result = this._resolveDebt(data, debtId, 'defaulted', byCreditor);
    this.save(data);
    return result;
  }

  getOpenDebts(agentId = null) {
    const debts = this.load().debts.filter(d => d.status === 'open');
    if (!agentId) return debts;
    const lower = String(agentId).toLowerCase();
    return debts.filter(d => d.debtor.toLowerCase() === lower || d.creditor.toLowerCase() === lower);
  }

  getOpenAccusations() {
    return this.load().accusations.filter(a => a.status === 'open');
  }

  getAccessLog(chestKey = null, limit = 50) {
    const log = this.load().accessLog;
    const filtered = chestKey ? log.filter(a => a.chestKey === String(chestKey)) : log;
    return filtered.slice(-limit);
  }

  // ── Intel Marketplace (knowledge as property) ────────────────────────────────

  listIntel(seller, title, fact, priceItem = 'iron_ingot', priceAmount = 1) {
    if (!seller || !title || !fact) return { success: false, reason: 'seller, title and fact required' };
    const data = this.load();
    const entry = {
      id: `itl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      seller,
      title: String(title).slice(0, 100),
      fact: String(fact).slice(0, 300),
      priceItem,
      priceAmount: Math.max(1, parseInt(priceAmount, 10) || 1),
      status: 'listed',
      timestamp: new Date().toISOString()
    };
    data.intel.push(entry);
    if (data.intel.length > 60) data.intel.splice(0, data.intel.length - 60);
    this.save(data);
    logger.info('SocietyStore', `[INTEL LISTED] ${seller}: "${entry.title}" for ${entry.priceAmount}x ${entry.priceItem}`);
    return { success: true, listing: entry };
  }

  purchaseIntel(intelId, buyer) {
    const data = this.load();
    const entry = data.intel.find(i => i.id === intelId && i.status === 'listed');
    if (!entry) return { success: false, reason: 'Listing not found or already sold' };
    if (entry.seller === buyer) return { success: false, reason: 'Cannot buy your own intel' };
    entry.status = 'sold';
    entry.buyer = buyer;
    entry.soldAt = new Date().toISOString();
    this.save(data);
    logger.info('SocietyStore', `[INTEL SOLD] ${buyer} bought "${entry.title}" from ${entry.seller}`);
    // Payment itself happens in-world (toss items); the record enables fraud accusations if the tip lies
    return { success: true, fact: entry.fact, seller: entry.seller, price: `${entry.priceAmount}x ${entry.priceItem}` };
  }

  getIntelListings(limit = 15) {
    return this.load().intel.filter(i => i.status === 'listed').slice(-limit);
  }

  // ── Grievance Ledger (raw material of feuds & wars) ──────────────────────────

  addGrievance(by, against, reason, weight = 1) {
    if (!by || !against || by.toLowerCase() === against.toLowerCase()) return { success: false, reason: 'Distinct parties required' };
    const data = this.load();
    const entry = {
      id: `grv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      by, against,
      reason: String(reason).slice(0, 200),
      weight: Math.max(1, Math.min(5, parseInt(weight, 10) || 1)),
      timestamp: new Date().toISOString()
    };
    data.grievances.push(entry);
    if (data.grievances.length > 200) data.grievances.splice(0, data.grievances.length - 200);
    this.save(data);
    logger.warn('SocietyStore', `[GRIEVANCE] ${by} holds grudge against ${against} (weight ${entry.weight}): ${entry.reason}`);
    return { success: true, grievance: entry };
  }

  // Tension between two agents = total grievance weight in BOTH directions.
  // Feeds faction politics: high tension makes conflict probable, not random.
  tensionBetween(agentA, agentB) {
    const data = this.load();
    const a = agentA.toLowerCase(), b = agentB.toLowerCase();
    return data.grievances
      .filter(g => (g.by.toLowerCase() === a && g.against.toLowerCase() === b) ||
                   (g.by.toLowerCase() === b && g.against.toLowerCase() === a))
      .reduce((sum, g) => sum + g.weight, 0);
  }

  getTopGrievances(limit = 10) {
    return this.load().grievances.slice(-limit).reverse();
  }

  getContextSnapshot() {
    const data = this.load();
    return {
      notices: data.notices.slice(-8).reverse(),
      conventions: data.conventions,
      openPledges: data.pledges.filter(p => p.status === 'open').slice(-15),
      openAccusations: data.accusations.filter(a => a.status === 'open').slice(-6),
      openDebts: data.debts.filter(d => d.status === 'open').slice(-10),
      intelListings: data.intel.filter(i => i.status === 'listed').slice(-8),
      topGrievances: data.grievances.slice(-8).reverse(),
      recentGossip: data.gossip.slice(-12),
      reputationHighlights: Object.entries(data.reputation)
        .map(([agentId, r]) => ({ agentId, score: r.score }))
        .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
        .slice(0, 10)
    };
  }
}

function societyRoutes(app) {
  const store = sharedStore;

  app.post('/api/society/gossip', (req, res) => {
    const { fromAgent, aboutAgent, sentiment, fact } = req.body || {};
    res.json(store.addGossip(fromAgent, aboutAgent, sentiment, fact));
  });

  app.get('/api/society/reputation/:agentId', (req, res) => {
    res.json(store.getReputation(req.params.agentId));
  });

  app.post('/api/society/notices', (req, res) => {
    const { author, type, title, body } = req.body || {};
    res.json(store.addNotice(author, type, title, body));
  });

  app.get('/api/society/notices', (req, res) => {
    res.json({ notices: store.getNotices(parseInt(req.query.limit, 10) || 20) });
  });

  app.post('/api/society/conventions', (req, res) => {
    const { agentId, key, value } = req.body || {};
    res.json(store.proposeConvention(agentId, key, value));
  });

  app.get('/api/society/conventions', (req, res) => {
    res.json({ conventions: store.getConventions() });
  });

  app.post('/api/society/pledges', (req, res) => {
    const { agentId, description } = req.body || {};
    res.json(store.addPledge(agentId, description));
  });

  app.post('/api/society/pledges/:id/resolve', (req, res) => {
    const { status, resolvedBy } = req.body || {};
    res.json(store.resolvePledge(req.params.id, status, resolvedBy));
  });

  app.post('/api/society/property/claim', (req, res) => {
    const { agentId, x, y, z, label } = req.body || {};
    res.json(store.claimChest(agentId, x, y, z, label));
  });

  app.post('/api/society/property/share', (req, res) => {
    const { agentId, x, y, z, withAgent } = req.body || {};
    res.json(store.shareChest(agentId, x, y, z, withAgent));
  });

  app.post('/api/society/property/access', (req, res) => {
    const { agentId, x, y, z } = req.body || {};
    res.json(store.logChestAccess(agentId, x, y, z));
  });

  app.get('/api/society/property/access-log', (req, res) => {
    res.json({ entries: store.getAccessLog(req.query.chestKey || null) });
  });

  app.post('/api/society/accusations', (req, res) => {
    const { accuser, accused, chestKey, claimedItems } = req.body || {};
    res.json(store.fileAccusation(accuser, accused, chestKey, claimedItems));
  });

  app.post('/api/society/accusations/:id/resolve', (req, res) => {
    const { verdict, resolvedBy } = req.body || {};
    res.json(store.resolveAccusation(req.params.id, verdict, resolvedBy));
  });

  app.get('/api/society/accusations/open', (req, res) => {
    res.json({ accusations: store.getOpenAccusations() });
  });

  app.post('/api/society/debts', (req, res) => {
    const { creditor, debtor, item, amount, context } = req.body || {};
    res.json(store.addDebt(creditor, debtor, item, amount, context));
  });

  app.post('/api/society/debts/:id/pay', (req, res) => {
    res.json(store.payDebt(req.params.id, (req.body || {}).byDebtor));
  });

  app.post('/api/society/debts/:id/forgive', (req, res) => {
    res.json(store.forgiveDebt(req.params.id, (req.body || {}).byCreditor));
  });

  app.post('/api/society/debts/:id/default', (req, res) => {
    res.json(store.defaultDebt(req.params.id, (req.body || {}).byCreditor));
  });

  app.get('/api/society/debts/open', (req, res) => {
    res.json({ debts: store.getOpenDebts(req.query.agentId || null) });
  });

  app.post('/api/society/intel', (req, res) => {
    const { seller, title, fact, priceItem, priceAmount } = req.body || {};
    res.json(store.listIntel(seller, title, fact, priceItem, priceAmount));
  });

  app.get('/api/society/intel', (req, res) => {
    res.json({ listings: store.getIntelListings() });
  });

  app.post('/api/society/intel/:id/purchase', (req, res) => {
    res.json(store.purchaseIntel(req.params.id, (req.body || {}).buyer));
  });

  app.post('/api/society/grievances', (req, res) => {
    const { by, against, reason, weight } = req.body || {};
    res.json(store.addGrievance(by, against, reason, weight));
  });

  app.get('/api/society/grievances/top', (req, res) => {
    res.json({ grievances: store.getTopGrievances() });
  });

  app.get('/api/society/grievances/tension', (req, res) => {
    const { a, b } = req.query;
    if (!a || !b) return res.status(400).json({ error: 'a and b required' });
    res.json({ a, b, tension: store.tensionBetween(a, b) });
  });

  app.get('/api/society/context', (req, res) => {
    res.json(store.getContextSnapshot());
  });

  logger.info('SocietyStore', 'Society knowledge routes mounted (/api/society/*)');
}

// Shared singleton — ledger fairness reports (and any future service module)
// need the same store the routes use, so civilization data stays coherent.
const sharedStore = new SocietyStore();

module.exports = societyRoutes;
module.exports.SocietyStore = SocietyStore;
module.exports.sharedStore = sharedStore;
