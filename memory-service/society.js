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
      return data;
    } catch (err) {
      logger.error('SocietyStore', 'Failed to read society file', err);
      return { reputation: {}, gossip: [], notices: [], conventions: {}, pledges: [], updatedAt: new Date().toISOString() };
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

  // ── Bundled context snapshot (one call for agents) ───────────────────────────

  getContextSnapshot() {
    const data = this.load();
    return {
      notices: data.notices.slice(-8).reverse(),
      conventions: data.conventions,
      openPledges: data.pledges.filter(p => p.status === 'open').slice(-15),
      recentGossip: data.gossip.slice(-12),
      reputationHighlights: Object.entries(data.reputation)
        .map(([agentId, r]) => ({ agentId, score: r.score }))
        .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
        .slice(0, 10)
    };
  }
}

function societyRoutes(app) {
  const store = new SocietyStore();

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

  app.get('/api/society/context', (req, res) => {
    res.json(store.getContextSnapshot());
  });

  logger.info('SocietyStore', 'Society knowledge routes mounted (/api/society/*)');
}

module.exports = societyRoutes;
module.exports.SocietyStore = SocietyStore;
