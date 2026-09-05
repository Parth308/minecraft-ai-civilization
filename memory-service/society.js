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
        worldStartAt: new Date().toISOString(),
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
        wallets: {},
        priceMemory: {},
        placeMemories: [],
        faith: {},
        clans: {},
        recentRites: [],
        jobs: [],
        shops: {},
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
      if (!data.wallets || typeof data.wallets !== 'object') data.wallets = {};
      if (!data.priceMemory || typeof data.priceMemory !== 'object') data.priceMemory = {};
      if (!Array.isArray(data.placeMemories)) data.placeMemories = [];
      if (!data.worldStartAt) data.worldStartAt = new Date().toISOString();
      if (!data.faith || typeof data.faith !== 'object') data.faith = {};
      if (!data.clans || typeof data.clans !== 'object') data.clans = {};
      if (!Array.isArray(data.recentRites)) data.recentRites = [];
      if (!Array.isArray(data.jobs)) data.jobs = [];
      if (!data.shops || typeof data.shops !== 'object') data.shops = {};
      return data;
    } catch (err) {
      logger.error('SocietyStore', 'Failed to read society file', err);
      return { reputation: {}, gossip: [], notices: [], conventions: {}, pledges: [], property: {}, accessLog: [], accusations: [], debts: [], intel: [], grievances: [], wallets: {}, priceMemory: {}, placeMemories: [], faith: {}, clans: {}, recentRites: [], updatedAt: new Date().toISOString() };
    }
  }

  save(data) {
    data.updatedAt = new Date().toISOString();
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  // ── Gossip & Reputation ──────────────────────────────────────────────────────

  // fidelity < 1 marks hearsay — retold rumors degrade and eventually read as vague "(hearsay)"
  addGossip(fromAgent, aboutAgent, sentiment, fact, fidelity = 1) {
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
      fidelity: Math.max(0.2, Math.min(1, Number(fidelity) || 1)),
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

  // ── Job Board with Wallet Escrow ─────────────────────────────────────────────

  postJob(poster, title, description, currency, amount) {
    const amt = Math.floor(Number(amount));
    if (!poster || !title || !currency || !Number.isFinite(amt) || amt <= 0) return { success: false, reason: 'poster, title, currency and positive amount required' };
    const data = this.load();

    // Escrow: payment leaves the poster's wallet immediately — trust by design
    const wallet = this._wallet(data, poster);
    if ((wallet[currency] || 0) < amt) return { success: false, reason: `Insufficient escrow funds (needs ${amt} ${currency})` };

    const job = {
      id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      poster,
      title: String(title).slice(0, 100),
      description: String(description || '').slice(0, 200),
      payment: { currency, amount: amt },
      status: 'open',
      worker: null,
      createdAt: new Date().toISOString()
    };
    wallet[currency] -= amt;
    const escrow = this._wallet(data, `escrow:${job.id}`);
    escrow[currency] = (escrow[currency] || 0) + amt;
    data.jobs.push(job);
    if (data.jobs.length > 80) data.jobs.splice(0, data.jobs.length - 80);
    this.save(data);
    logger.info('SocietyStore', `[JOB POSTED] ${poster}: "${job.title}" for ${amt} ${currency} (escrowed)`);
    return { success: true, job };
  }

  claimJob(jobId, worker) {
    const data = this.load();
    const job = data.jobs.find(j => j.id === jobId && j.status === 'open');
    if (!job) return { success: false, reason: 'Open job not found' };
    if (job.poster === worker) return { success: false, reason: 'Cannot claim your own job' };
    job.status = 'claimed';
    job.worker = worker;
    job.claimedAt = new Date().toISOString();
    this.save(data);
    logger.info('SocietyStore', `[JOB CLAIMED] ${worker} took "${job.title}"`);
    return { success: true, job };
  }

  completeJob(jobId, byWorker) {
    const data = this.load();
    const job = data.jobs.find(j => j.id === jobId && j.status === 'claimed');
    if (!job) return { success: false, reason: 'Claimed job not found' };
    if (job.worker !== byWorker) return { success: false, reason: 'Only the claiming worker can complete' };

    // Release escrow to worker + poster reputation for honest dealing
    const escrow = data.wallets[`escrow:${job.id}`] || {};
    const workerWallet = this._wallet(data, byWorker);
    for (const [cur, amt] of Object.entries(escrow)) {
      workerWallet[cur] = (workerWallet[cur] || 0) + amt;
    }
    delete data.wallets[`escrow:${job.id}`];
    job.status = 'done';
    job.completedAt = new Date().toISOString();

    const rep = data.reputation[job.poster] || { score: 0, positives: 0, negatives: 0 };
    rep.score = Math.min(100, rep.score + 4);
    rep.positives++;
    data.reputation[job.poster] = rep;
    this.save(data);
    logger.warn('SocietyStore', `[JOB DONE] ${byWorker} completed "${job.title}" — paid ${job.payment.amount} ${job.payment.currency}`);
    return { success: true, job, paid: job.payment };
  }

  failJob(jobId, byPoster) {
    const data = this.load();
    const idx = data.jobs.findIndex(j => j.id === jobId && j.status === 'claimed');
    if (idx === -1) return { success: false, reason: 'Claimed job not found' };
    const job = data.jobs[idx];

    // Refund escrow to poster
    const escrowKey = `escrow:${idx.toString(36)}`;
    const escrow = data.wallets[escrowKey] || {};
    const posterWallet = this._wallet(data, job.poster);
    for (const [cur, amt] of Object.entries(escrow)) {
      posterWallet[cur] = (posterWallet[cur] || 0) + amt;
    }
    delete data.wallets[escrowKey];
    job.status = 'failed';

    // Worker earns a grievance from the poster — social consequence
    if (byPoster === job.poster) {
      data.grievances.push({
        id: `grv_${Date.now()}_j`, by: job.poster, against: job.worker,
        reason: `Abandoned paid job: "${job.title}"`, weight: 2,
        timestamp: new Date().toISOString()
      });
    }
    this.save(data);
    logger.warn('SocietyStore', `[JOB FAILED] "${job.title}" refunded to ${job.poster}; grievance filed vs ${job.worker}`);
    return { success: true, job };
  }

  getOpenJobs() {
    return this.load().jobs.filter(j => j.status === 'open').slice(-12);
  }

  // ── Chest Shops (physical commerce locations) ────────────────────────────────

  createShop(agentId, x, y, z, item, unitPrice, unitCurrency) {
    const key = `${Math.round(x)},${Math.round(y)},${Math.round(z)}`;
    const data = this.load();
    const prop = data.property[key];
    if (!prop || prop.owner !== agentId) return { success: false, reason: 'You must own the chest to open a shop on it' };
    data.shops[key] = {
      owner: agentId,
      item: String(item).slice(0, 60),
      unitPrice: Math.max(1, parseInt(unitPrice, 10) || 1),
      unitCurrency,
      openedAt: new Date().toISOString()
    };
    this.save(data);
    logger.info('SocietyStore', `[SHOP OPENED] ${agentId}: ${key} sells ${item} @ ${unitPrice} ${unitCurrency}`);
    return { success: true, shop: data.shops[key] };
  }

  getShops() {
    return Object.entries(this.load().shops)
      .map(([chestKey, s]) => ({ chestKey, ...s }))
      .slice(-15);
  }

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

  // ── Currency Wallets & Market Price Memory ───────────────────────────────────

  _wallet(data, agentId) {
    if (!data.wallets[agentId]) data.wallets[agentId] = {};
    return data.wallets[agentId];
  }

  walletBalance(agentId, currency = null) {
    const w = this.load().wallets[agentId] || {};
    return currency ? { agentId, currency, balance: w[currency] || 0 } : { agentId, balances: w };
  }

  // Zero-sum movement — wealth is created only via mint() below
  transfer(fromAgent, toAgent, currency, amount, reason = '') {
    const amt = Math.floor(Number(amount));
    if (!fromAgent || !toAgent || fromAgent === toAgent) return { success: false, reason: 'Distinct parties required' };
    if (!currency || !Number.isFinite(amt) || amt <= 0) return { success: false, reason: 'Valid currency and positive amount required' };

    const data = this.load();
    const from = this._wallet(data, fromAgent);
    if ((from[currency] || 0) < amt) {
      return { success: false, reason: `Insufficient funds: has ${from[currency] || 0} ${currency}, needs ${amt}` };
    }
    from[currency] -= amt;
    const to = this._wallet(data, toAgent);
    to[currency] = (to[currency] || 0) + amt;
    this.save(data);
    logger.info('SocietyStore', `[TRANSFER] ${fromAgent} -> ${toAgent}: ${amt} ${currency} (${reason})`);
    return { success: true, fromBalance: from[currency], toBalance: to[currency] };
  }

  // Bootstrap issuance for a young economy. Loudly logged; gate with env if abused.
  mint(agentId, currency, amount, reason = 'economy bootstrap') {
    const amt = Math.floor(Number(amount));
    if (!agentId || !currency || !Number.isFinite(amt) || amt <= 0) return { success: false, reason: 'Invalid mint' };
    if (process.env.SOCIETY_MINT_DISABLED === 'true') return { success: false, reason: 'Minting disabled' };
    const data = this.load();
    const w = this._wallet(data, agentId);
    w[currency] = (w[currency] || 0) + amt;
    this.save(data);
    logger.warn('SocietyStore', `[MINT] ${agentId} +${amt} ${currency} (${reason})`);
    return { success: true, balance: w[currency] };
  }

  // Every observed trade feeds the market memory. unitPrice expressed in units of
  // unitCurrency per ONE of `item`.
  recordPrice(item, unitAmount, unitCurrency, source = 'trade') {
    const data = this.load();
    if (!data.priceMemory[item]) data.priceMemory[item] = [];
    data.priceMemory[item].push({ unitPrice: Number(unitAmount), unitCurrency, source, ts: new Date().toISOString() });
    if (data.priceMemory[item].length > 20) data.priceMemory[item].splice(0, data.priceMemory[item].length - 20);
    this.save(data);
  }

  getMarketPrice(item) {
    const samples = (this.load().priceMemory[item] || []).slice(-10);
    if (samples.length === 0) return { item, samples: 0, average: null, lastUnit: null, unitCurrency: null };
    const avg = samples.reduce((sum, s) => sum + s.unitPrice, 0) / samples.length;
    const last = samples[samples.length - 1];
    return { item, samples: samples.length, average: Number(avg.toFixed(2)), lastUnit: last.unitPrice, unitCurrency: last.unitCurrency };
  }

  // ── Place-Memory (geography that remembers what happened there) ─────────────

  rememberPlace(agentId, x, z, sentiment, label, radius = 16, y = null) {
    const s = Math.max(-1, Math.min(1, Number(sentiment)));
    if (!agentId || !Number.isFinite(s)) return { success: false, reason: 'agentId and numeric sentiment required' };
    const data = this.load();
    const entry = {
      id: `plc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      agentId,
      x: Math.round(x), y: y == null ? null : Math.round(y), z: Math.round(z),
      sentiment: Number(s.toFixed(2)),
      label: String(label).slice(0, 100),
      radius,
      timestamp: new Date().toISOString()
    };
    data.placeMemories.push(entry);
    if (data.placeMemories.length > 150) data.placeMemories.splice(0, data.placeMemories.length - 150);
    this.save(data);
    logger.info('SocietyStore', `[PLACE MEMORY] ${agentId} @ (${entry.x},${entry.z}): "${label}" (${entry.sentiment})`);
    return { success: true, place: entry };
  }

  getPlacesNear(agentId, x, z, radius = 24) {
    const data = this.load().placeMemories.filter(p =>
      p.agentId === agentId &&
      Math.hypot(p.x - x, p.z - z) <= Math.max(radius, p.radius || 16)
    );
    return data.slice(-6);
  }

  // ── Clans (identity blocs with pooled economies) ─────────────────────────────

  foundClan(agentId, name, motto = '') {
    if (!agentId || !name) return { success: false, reason: 'agentId and name required' };
    const data = this.load();
    const key = String(name).slice(0, 40);
    if (data.clans[key]) return { success: false, reason: 'Clan name taken' };

    // Founding cost: 25 of any single currency — founding something should hurt
    const wallet = data.wallets[agentId] || {};
    const purse = Object.entries(wallet).find(([, v]) => v >= 25);
    if (purse) {
      wallet[purse[0]] -= 25;
      const treasury = this._wallet(data, `clan:${key}`);
      treasury[purse[0]] = (treasury[purse[0]] || 0) + 25;
    }

    data.clans[key] = {
      founder: agentId,
      members: [agentId],
      motto: String(motto).slice(0, 120),
      foundedAt: new Date().toISOString(),
      tradition: null
    };
    this.save(data);
    logger.warn('SocietyStore', `[CLAN FOUNDED] ${agentId} founded clan "${key}"${purse ? ` (treasury seeded with 25 ${purse[0]})` : ''}`);
    this.addNotice(agentId, 'lore', `The founding of ${key}`, motto || `${agentId} raised a banner.`);
    return { success: true, clan: data.clans[key] };
  }

  joinClan(agentId, name) {
    const data = this.load();
    const clan = data.clans[name];
    if (!clan) return { success: false, reason: 'No such clan' };
    if (clan.members.includes(agentId)) return { success: true, clan };
    clan.members.push(agentId);
    this.save(data);
    logger.info('SocietyStore', `[CLAN JOINED] ${agentId} joined "${name}" (${clan.members.length} members)`);
    return { success: true, clan };
  }

  getClan(name) {
    const data = this.load();
    const clan = data.clans[name];
    if (!clan) return null;
    return { name, ...clan, treasury: data.wallets[`clan:${name}`] || {} };
  }

  getClanOf(agentId) {
    const data = this.load();
    for (const [name, c] of Object.entries(data.clans)) {
      if (c.members.includes(agentId)) return { name, ...c, treasury: data.wallets[`clan:${name}`] || {} };
    }
    return null;
  }

  // Bloc-level tension: sum of member-pair grievances between two clans.
  // This is how individual feuds escalate into collective conflict.
  clanTension(nameA, nameB) {
    const data = this.load();
    const A = data.clans[nameA]?.members || [];
    const B = data.clans[nameB]?.members || [];
    let total = 0;
    for (const g of data.grievances) {
      const byInA = A.includes(g.by), againstInB = B.includes(g.against);
      const byInB = B.includes(g.by), againstInA = A.includes(g.against);
      if ((byInA && againstInB) || (byInB && againstInA)) total += g.weight;
    }
    return total;
  }

  // ── Group Rites (Durkheim engine: shared ritual = social glue) ───────────────

  attendRite(agentId, riteType = 'reflection', coords = null) {
    if (!agentId) return { success: false, reason: 'agentId required' };
    const now = Date.now();
    const data = this.load();

    const f = data.faith[agentId] || { state: 'none', tradition: null, piety: 0 };
    f.piety = Math.min(100, f.piety + 5);
    f.lastRiteAt = new Date().toISOString();
    if (f.state === 'none' && f.piety >= 20) f.state = 'exposed';

    let bondedWith = [];
    if (coords && typeof coords.x === 'number') {
      // Record this rite, then find co-present recent rites — shared sacred
      // moments bond participants (mutual piety + spoken goodwill).
      data.recentRites.push({ agentId, riteType, x: Math.round(coords.x), z: Math.round(coords.z), ts: now });
      data.recentRites = data.recentRites.filter(r => now - r.ts < 10 * 60 * 1000).slice(-80);

      for (const other of data.recentRites) {
        if (other.agentId === agentId) continue;
        if (now - other.ts > 8 * 60 * 1000) continue;
        if (Math.hypot(other.x - coords.x, other.z - coords.z) > 24) continue;
        bondedWith.push(other.agentId);

        const of = data.faith[other.agentId] || { state: 'none', tradition: null, piety: 0 };
        of.piety = Math.min(100, of.piety + 3);
        of.lastRiteAt = new Date().toISOString();
        if (of.state === 'none' && of.piety >= 20) of.state = 'exposed';
        data.faith[other.agentId] = of;
      }
      for (const b of bondedWith) {
        data.gossip.push({
          id: `gsp_${Date.now()}_r_${b}`, from: agentId, about: b,
          sentiment: 0.4, fact: `Shared a solemn moment at the ${riteType}`,
          timestamp: new Date().toISOString()
        });
      }
      if (data.gossip.length > 400) data.gossip.splice(data.gossip.length - 400);
    }

    data.faith[agentId] = f;
    this.save(data);
    logger.info('SocietyStore', `[RITE ATTENDED] ${agentId} (${riteType}) — piety ${f.piety}${bondedWith.length ? `, bonded with ${bondedWith.join(', ')}` : ''}`);
    return { success: true, faith: f, bondedWith };
  }

  // ── Faith Vessel ─────────────────────────────────────────────────────────────
  // NO forced belief, NO scripted doctrine. This tracks what agents THEMSELVES
  // declare and do. Doctrines live in conventions (keys starting 'faith.'),
  // scripture lives in notices (type 'scripture'). The store only remembers.

  setFaith(agentId, { state, tradition } = {}) {
    if (!agentId) return { success: false, reason: 'agentId required' };
    const validStates = ['none', 'exposed', 'believer', 'devout'];
    const data = this.load();
    const f = data.faith[agentId] || { state: 'none', tradition: null, piety: 0 };
    if (state && validStates.includes(state)) f.state = state;
    if (tradition !== undefined) f.tradition = tradition === null ? null : String(tradition).slice(0, 60);
    f.updatedAt = new Date().toISOString();
    data.faith[agentId] = f;
    this.save(data);
    logger.info('SocietyStore', `[FAITH] ${agentId}: state=${f.state} tradition=${f.tradition || '—'} piety=${f.piety}`);
    return { success: true, faith: f };
  }

  mortalitySalience() {
    let deaths = [];
    try {
      const { getInstance } = require('./store/civilization/ledger');
      deaths = getInstance().getLedger().deaths || [];
    } catch { /* no ledger yet */ }
    const cutoff = Date.now() - 2 * 60 * 60 * 1000;
    const recent = deaths.filter(d => new Date(d.timestamp).getTime() > cutoff);
    return {
      deathsLastTwoHours: recent.length,
      level: recent.length >= 8 ? 'extreme' : recent.length >= 4 ? 'high' : recent.length >= 1 ? 'present' : 'calm'
    };
  }

  getFaith(agentId) {
    const data = this.load();
    return {
      agentId,
      ...(data.faith[agentId] || { state: 'none', tradition: null, piety: 0 }),
      mortalitySalience: this.mortalitySalience(),
      doctrines: Object.entries(data.conventions)
        .filter(([k]) => k.startsWith('faith.'))
        .map(([k, v]) => ({ tenet: k.replace('faith.', ''), value: v.value, adherents: v.adopters.length })),
      scriptures: data.notices.filter(n => n.type === 'scripture').slice(-5)
    };
  }

  // Minecraft calendar: 20 real minutes = one in-world day
  calendar() {
    const data = this.load();
    const elapsedMs = Date.now() - new Date(data.worldStartAt).getTime();
    const totalDays = Math.floor(elapsedMs / (20 * 60 * 1000));
    const minuteOfDay = Math.floor(((elapsedMs % (20 * 60 * 1000)) / (20 * 60 * 1000)) * 24 * 60);
    return {
      day: totalDays + 1,
      timeOfDay: `${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}`,
      isNightish: minuteOfDay < 5 * 60 || minuteOfDay > 19 * 60
    };
  }

  // ── Elections (authority emerges from votes, not code) ──────────────────────

  declareCandidacy(agentId) {
    return this.proposeConvention(agentId, 'chief.candidate.' + agentId, 'candidate');
  }

  voteFor(voterId, candidate) {
    return this.proposeConvention(voterId, 'chief.vote.' + candidate, 'vote');
  }

  getChief() {
    const conventions = this.load().conventions;
    let best = null;
    for (const [k, v] of Object.entries(conventions)) {
      if (!k.startsWith('chief.vote.')) continue;
      const candidate = k.replace('chief.vote.', '');
      if (!best || v.adopters.length > best.votes) best = { candidate, votes: v.adopters.length };
    }
    if (!best || best.votes < 2) return { chief: null, reason: 'No candidate holds at least 2 votes yet' };
    return { chief: best.candidate, votes: best.votes };
  }

  getContextSnapshot() {
    const data = this.load();
    return {
      calendar: this.calendar(),
      chief: this.getChief(),
      openJobs: data.jobs.filter(j => j.status === 'open').slice(-8).map(j => ({ id: j.id, poster: j.poster, title: j.title, payment: `${j.payment.amount}x ${j.payment.currency}` })),
      shops: this.getShops(),
      notices: data.notices.slice(-8).reverse(),
      conventions: data.conventions,
      openPledges: data.pledges.filter(p => p.status === 'open').slice(-15),
      openAccusations: data.accusations.filter(a => a.status === 'open').slice(-6),
      openDebts: data.debts.filter(d => d.status === 'open').slice(-10),
      intelListings: data.intel.filter(i => i.status === 'listed').slice(-8),
      topGrievances: data.grievances.slice(-8).reverse(),
      marketHighlights: Object.keys(data.priceMemory)
        .map(item => ({ item, ...this.getMarketPrice(item) }))
        .filter(m => m.samples > 0)
        .slice(0, 10),
      recentGossip: data.gossip.slice(-12).map(g => {
        const fid = g.fidelity ?? 1;
        const fact = String(g.fact || '');
        const kept = fid >= 0.95 ? fact : fact.slice(0, Math.max(18, Math.round(fact.length * fid))) + (fid < 0.65 ? ' (hearsay)' : '...');
        return { ...g, fact: kept };
      }),
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

  app.get('/api/society/wallets/:agentId', (req, res) => {
    res.json(store.walletBalance(req.params.agentId, req.query.currency || null));
  });

  app.post('/api/society/wallets/transfer', (req, res) => {
    const { fromAgent, toAgent, currency, amount, reason } = req.body || {};
    res.json(store.transfer(fromAgent, toAgent, currency, amount, reason));
  });

  app.post('/api/society/wallets/mint', (req, res) => {
    const { agentId, currency, amount, reason } = req.body || {};
    res.json(store.mint(agentId, currency, amount, reason));
  });

  app.get('/api/society/market/price/:item', (req, res) => {
    res.json(store.getMarketPrice(decodeURIComponent(req.params.item)));
  });

  app.post('/api/society/market/price', (req, res) => {
    const { item, unitAmount, unitCurrency, source } = req.body || {};
    store.recordPrice(item, unitAmount, unitCurrency, source);
    res.json({ success: true });
  });

  app.post('/api/society/places', (req, res) => {
    const { agentId, x, z, sentiment, label, radius, y } = req.body || {};
    res.json(store.rememberPlace(agentId, x, z, sentiment, label, radius, y));
  });

  app.get('/api/society/places/near', (req, res) => {
    const { agentId, x, z, radius } = req.query;
    if (!agentId || x == null || z == null) return res.status(400).json({ error: 'agentId, x, z required' });
    res.json({ places: store.getPlacesNear(agentId, Number(x), Number(z), Number(radius) || 24) });
  });

  app.post('/api/society/faith', (req, res) => {
    const { agentId, state, tradition } = req.body || {};
    res.json(store.setFaith(agentId, { state, tradition }));
  });

  app.post('/api/society/faith/rite', (req, res) => {
    const { agentId, riteType } = req.body || {};
    res.json(store.attendRite(agentId, riteType));
  });

  app.get('/api/society/faith/:agentId', (req, res) => {
    res.json(store.getFaith(req.params.agentId));
  });

  app.post('/api/society/clans', (req, res) => {
    const { agentId, name, motto } = req.body || {};
    res.json(store.foundClan(agentId, name, motto));
  });

  app.post('/api/society/clans/join', (req, res) => {
    const { agentId, name } = req.body || {};
    res.json(store.joinClan(agentId, name));
  });

  app.get('/api/society/clans/:name', (req, res) => {
    res.json(store.getClan(decodeURIComponent(req.params.name)) || { error: 'not found' });
  });

  app.get('/api/society/clans', (req, res) => {
    const data = store.load();
    res.json({ clans: Object.keys(data.clans).map(n => ({ name: n, members: data.clans[n].members.length, motto: data.clans[n].motto })) });
  });

  app.get('/api/society/clans/tension', (req, res) => {
    const { a, b } = req.query;
    if (!a || !b) return res.status(400).json({ error: 'clan names a and b required' });
    res.json({ a, b, tension: store.clanTension(a, b) });
  });

  app.post('/api/society/jobs', (req, res) => {
    const { poster, title, description, currency, amount } = req.body || {};
    res.json(store.postJob(poster, title, description, currency, amount));
  });

  app.post('/api/society/jobs/:id/claim', (req, res) => {
    res.json(store.claimJob(req.params.id, (req.body || {}).worker));
  });

  app.post('/api/society/jobs/:id/complete', (req, res) => {
    res.json(store.completeJob(req.params.id, (req.body || {}).byWorker));
  });

  app.post('/api/society/jobs/:id/fail', (req, res) => {
    res.json(store.failJob(req.params.id, (req.body || {}).byPoster));
  });

  app.get('/api/society/jobs/open', (req, res) => {
    res.json({ jobs: store.getOpenJobs() });
  });

  app.post('/api/society/shops', (req, res) => {
    const { agentId, x, y, z, item, unitPrice, unitCurrency } = req.body || {};
    res.json(store.createShop(agentId, x, y, z, item, unitPrice, unitCurrency));
  });

  app.get('/api/society/shops', (req, res) => {
    res.json({ shops: store.getShops() });
  });

  app.post('/api/society/chief/candidacy', (req, res) => {
    res.json(store.declareCandidacy((req.body || {}).agentId));
  });

  app.post('/api/society/chief/vote', (req, res) => {
    const { voterId, candidate } = req.body || {};
    res.json(store.voteFor(voterId, candidate));
  });

  app.get('/api/society/chief', (req, res) => {
    res.json(store.getChief());
  });

  // History Book — compiled origin stories and milestones for meaning-making
  app.get('/api/society/history', (req, res) => {
    let chronicle = [], deaths = [];
    try {
      const { getInstance } = require('./store/civilization/ledger');
      const data = getInstance().getLedger();
      chronicle = data.chronicleEntries || [];
      deaths = data.deaths || [];
    } catch { /* fresh world */ }
    const data = store.load();
    res.json({
      eras: {
        totalDeaths: deaths.length,
        clansFounded: Object.entries(data.clans).map(([n, c]) => ({ name: n, founder: c.founder, foundedAt: c.foundedAt })),
        currenciesAdopted: (data.conventions['currency'] ? [data.conventions['currency'].value] : [])
      },
      milestones: chronicle.slice(-30).reverse(),
      scriptures: data.notices.filter(n => n.type === 'scripture').slice(-10).reverse(),
      doctrines: Object.entries(data.conventions).filter(([k]) => k.startsWith('faith.')).map(([k, v]) => ({ tenet: k.replace('faith.', ''), value: v.value }))
    });
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
