const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { initializeAgentMemoryFiles, getAgentDirectory, getSectionFilePath, parseSectionFile, writeSectionFile, updatePersonaProfile, SECTIONS } = require('./sections/schema');
const EventRouter = require('./router');
const MemoryCompactor = require('./sections/compactor');
const MemoryScheduler = require('./scheduler');
const VectorMemoryStore = require('./store/vectorStore');
const logger = require('../shared/logger');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const router = new EventRouter();
const compactor = new MemoryCompactor();
const vectorStore = new VectorMemoryStore();
const scheduler = new MemoryScheduler(compactor);
scheduler.start();

// Society knowledge layer (gossip/reputation, notices, conventions, pledges)
require('./society')(app);

// Traumatic amnesia — death randomly erases a fraction of learned memories.
// Knowledge becomes precious because surviving long enough to accumulate it is rare.
app.post('/api/memory/amnesia', async (req, res) => {
  const { agentId, fraction = 0.3 } = req.body || {};
  if (!agentId) return res.status(400).json({ error: 'agentId required' });
  const f = Math.min(0.6, Math.max(0, Number(fraction) || 0.3));
  let forgotten = 0;
  const droppedTexts = [];
  for (const section of ['skills', 'events', 'recent']) {
    try {
      const p = getSectionFilePath(agentId, section);
      if (!fs.existsSync(p)) continue;
      const parsed = parseSectionFile(p);
      const before = parsed.entries.length;
      const keepCount = Math.ceil(before * (1 - f));
      if (before <= keepCount) continue;
      const dropIdx = new Set();
      while (dropIdx.size < before - keepCount) dropIdx.add(Math.floor(Math.random() * before));
      parsed.entries.forEach((entry, i) => { if (dropIdx.has(i)) droppedTexts.push(entry); });
      parsed.entries = parsed.entries.filter((_, i) => !dropIdx.has(i));
      writeSectionFile(p, parsed.frontmatter, parsed.entries);
      forgotten += before - keepCount;
    } catch (err) {
      logger.debug('MemoryService', `Amnesia pass skipped ${section}: ${err.message}`);
    }
  }
  // Purge forgotten entries from the vector index as well, or "forgotten"
  // memories stay semantically searchable forever.
  const purgedVectors = vectorStore.removeEntries(agentId, new Set(droppedTexts));
  logger.warn('MemoryService', `[AMNESIA] ${agentId} lost ${forgotten} memory entries (${purgedVectors} vectors) after death`);
  res.json({ success: true, agentId, forgotten, purgedVectors });
});

// Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'memory-service', uptime: process.uptime() });
});

// Initialize Agent Storage & Indexing
app.post('/api/memory/init', async (req, res) => {
  const { agentId, personality, persona } = req.body;
  if (!agentId) return res.status(400).json({ error: 'agentId required' });
  initializeAgentMemoryFiles(agentId, personality);

  // Agent boot pushes its living persona; rewrite the generic template
  // profile so persisted identity matches the running DynamicPersona.
  if (persona && typeof persona === 'object') {
    updatePersonaProfile(agentId, persona);
  }

  // Index sections into vector store
  for (const s of ['profile', 'relationships', 'events', 'skills']) {
    const parsed = parseSectionFile(getSectionFilePath(agentId, s));
    await vectorStore.indexSectionEntries(agentId, s, parsed.entries);
  }

  return res.json({ status: 'initialized', agentId });
});

// Tier 1: Buffer -> Section Compaction
app.post('/api/memory/compact', async (req, res) => {
  const { agentId, events } = req.body;
  if (!agentId || !Array.isArray(events)) {
    return res.status(400).json({ error: 'agentId and events array required' });
  }

  initializeAgentMemoryFiles(agentId);
  const result = await compactor.compactBufferToSections(agentId, events, router);

  // Update vector store index
  for (const s of ['relationships', 'events', 'skills']) {
    const parsed = parseSectionFile(getSectionFilePath(agentId, s));
    await vectorStore.indexSectionEntries(agentId, s, parsed.entries);
  }

  res.json(result);
});

// Tier 2: Manual / Scheduled Section Consolidation
app.post('/api/memory/consolidate', async (req, res) => {
  const { agentId, section } = req.body;
  if (!agentId || !section) {
    return res.status(400).json({ error: 'agentId and section required' });
  }

  const result = await compactor.consolidateSectionFile(agentId, section);
  
  // Re-index section into vector store
  const parsed = parseSectionFile(getSectionFilePath(agentId, section));
  await vectorStore.indexSectionEntries(agentId, section, parsed.entries);

  res.json(result);
});

// Shared World Knowledge — settlers' field observations, queryable by area.
// Pure information service: contributing records facts; nobody is obliged to
// read or act on them.
const WORLD_DISCOVERIES_PATH = path.join(config.baseStorePath, '..', 'world_discoveries.json');
const LEGACY_DISCOVERIES_PATH = path.join(config.baseStorePath, '..', 'store', 'world_discoveries.json');

function readDiscoveries() {
  try {
    // One-time migration from the old double-store/ typo path.
    if (!fs.existsSync(WORLD_DISCOVERIES_PATH) && fs.existsSync(LEGACY_DISCOVERIES_PATH)) {
      fs.renameSync(LEGACY_DISCOVERIES_PATH, WORLD_DISCOVERIES_PATH);
    }
    if (!fs.existsSync(WORLD_DISCOVERIES_PATH)) return [];
    return JSON.parse(fs.readFileSync(WORLD_DISCOVERIES_PATH, 'utf8'));
  } catch { return []; }
}

app.post('/api/world/discoveries', (req, res) => {
  const { agentId, kind, item, x, y, z, note } = req.body || {};
  if (!agentId || !item || x === undefined || z === undefined) {
    return res.status(400).json({ error: 'agentId, item, x, z required' });
  }
  const discoveries = readDiscoveries();
  const entry = {
    agentId,
    kind: kind || 'ore',
    item: String(item).slice(0, 60),
    x: Math.round(Number(x)), y: Math.round(Number(y) || 0), z: Math.round(Number(z)),
    note: String(note || '').slice(0, 120),
    timestamp: Date.now()
  };
  discoveries.push(entry);
  fs.writeFileSync(WORLD_DISCOVERIES_PATH, JSON.stringify(discoveries.slice(-500)));
  res.json({ saved: true });
});

app.get('/api/world/discoveries', (req, res) => {
  const { x, z, radius = '64', item, limit = '5' } = req.query;
  let list = readDiscoveries();
  if (x !== undefined && z !== undefined) {
    const cx = Number(x), cz = Number(z), r2 = Number(radius) * Number(radius);
    list = list.filter(d => (d.x - cx) ** 2 + (d.z - cz) ** 2 <= r2);
  }
  if (item) list = list.filter(d => d.item.includes(String(item)));
  res.json({ count: list.length, discoveries: list.slice(-parseInt(limit, 10) || 5) });
});

// Goal Persistence (restart-safe objectives per agent)
app.get('/api/memory/goal', (req, res) => {
  const { agentId } = req.query;
  if (!agentId) return res.status(400).json({ error: 'agentId required' });
  const goalPath = path.join(getAgentDirectory(agentId), 'goal.json');
  try {
    if (!fs.existsSync(goalPath)) return res.json({ snapshot: null });
    res.json({ snapshot: JSON.parse(fs.readFileSync(goalPath, 'utf8')) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/memory/goal', (req, res) => {
  const { agentId, snapshot } = req.body;
  if (!agentId || !snapshot) return res.status(400).json({ error: 'agentId and snapshot required' });
  try {
    const goalPath = path.join(getAgentDirectory(agentId), 'goal.json');
    fs.writeFileSync(goalPath, JSON.stringify(snapshot, null, 2));
    res.json({ saved: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Query Memory (Semantic Vector Search with Fallback)
app.get('/api/memory/query', async (req, res) => {
  const { agentId, query, section, limit } = req.query;
  if (!agentId) return res.status(400).json({ error: 'agentId required' });

  initializeAgentMemoryFiles(agentId);
  const maxLines = parseInt(limit, 10) || 5;

  // 1. If query text is provided, perform semantic vector similarity search
  if (query) {
    const vectorResults = await vectorStore.searchSimilar(agentId, query, maxLines, section || null);
    if (vectorResults.length > 0) {
      return res.json({
        agentId,
        searchType: 'semantic_vector',
        count: vectorResults.length,
        memories: vectorResults
      });
    }
  }

  // 2. Keyword/fallback retrieval
  let targetSections = section ? [section] : ['profile', 'relationships', 'events', 'skills'];
  const results = [];

  for (const s of targetSections) {
    const filePath = getSectionFilePath(agentId, s);
    const parsed = parseSectionFile(filePath);

    let matching = parsed.entries;
    if (query) {
      const qLower = query.toLowerCase();
      matching = parsed.entries.filter(e => e.toLowerCase().includes(qLower));
    }
    results.push(...matching.slice(-maxLines));
  }

  res.json({
    agentId,
    searchType: 'keyword_fallback',
    count: results.length,
    memories: results.slice(-maxLines)
  });
});

// Raw section markdown content (for dashboard memory viewer)
app.get('/api/memory/sections/:agentId/:section', (req, res) => {
  const { agentId, section } = req.params;
  if (!SECTIONS.includes(section)) {
    return res.status(400).json({ error: `Invalid section. Valid: ${SECTIONS.join(', ')}` });
  }
  initializeAgentMemoryFiles(agentId);
  const filePath = getSectionFilePath(agentId, section);
  if (!fs.existsSync(filePath)) {
    return res.json({ agentId, section, content: '' });
  }
  const content = fs.readFileSync(filePath, 'utf8');
  res.json({ agentId, section, content });
});

const { getInstance } = require('./store/civilization/ledger');
const ledger = getInstance();

// Civilization ledger (for dashboard ledger panel)
app.get('/api/ledger', (req, res) => {
  res.json(ledger.getLedger());
});

// Shared Lessons Endpoints
app.get('/api/ledger/lessons', (req, res) => {
  const since = req.query.since;
  const limit = req.query.limit ? parseInt(req.query.limit, 10) : null;
  let shared = ledger.getSharedLessons();
  let unshared = ledger.getUnsharedLessons();
  if (since) {
    const sinceTs = new Date(since).getTime();
    if (!isNaN(sinceTs)) {
      shared = shared.filter(l => new Date(l.timestamp).getTime() > sinceTs);
      unshared = unshared.filter(l => new Date(l.timestamp).getTime() > sinceTs);
    }
  }
  if (limit && !isNaN(limit) && limit > 0) {
    shared = shared.slice(-limit);
    unshared = unshared.slice(-limit);
  }
  res.json({
    count: shared.length,
    sharedLessons: shared,
    unsharedCount: unshared.length,
    unsharedLessons: unshared
  });
});

app.get('/api/ledger/lessons/unshared', (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit, 10) : null;
  let unshared = ledger.getUnsharedLessons();
  if (limit && !isNaN(limit) && limit > 0) {
    unshared = unshared.slice(-limit);
  }
  res.json({ count: unshared.length, unsharedLessons: unshared });
});

app.post('/api/ledger/lessons', (req, res) => {
  const { agentId, lesson, isPublic, context, confidence, severity, status } = req.body;
  if (!agentId || !lesson) {
    return res.status(400).json({ error: 'agentId and lesson string required' });
  }
  const result = ledger.recordLesson(agentId, lesson, isPublic, context, confidence, severity, status);
  res.json(result);
});

// Deaths / Hazard Casualties Endpoints
app.get('/api/ledger/deaths', (req, res) => {
  res.json({ count: ledger.getDeaths().length, deaths: ledger.getDeaths() });
});

app.post('/api/ledger/deaths', (req, res) => {
  const { agentId, deathCause, position, penalizedRules, scarSummary } = req.body;
  if (!agentId) {
    return res.status(400).json({ error: 'agentId required' });
  }
  const result = ledger.recordDeath(agentId, deathCause, position, penalizedRules, scarSummary);
  res.json(result);
});

// Trade Recording Endpoints
app.get('/api/ledger/trades', (req, res) => {
  res.json({ count: ledger.getTrades().length, trades: ledger.getTrades() });
});

app.post('/api/ledger/trades', (req, res) => {
  const { agentA, agentB, itemsGiven, itemsReceived, fairnessScore } = req.body;
  if (!agentA || !agentB || !itemsGiven || !itemsReceived) {
    return res.status(400).json({ error: 'agentA, agentB, itemsGiven, and itemsReceived required' });
  }
  const result = ledger.recordTrade(agentA, agentB, itemsGiven, itemsReceived, fairnessScore);
  res.json(result);
});

// Debt / IOU Endpoints
app.get('/api/ledger/debts', (req, res) => {
  const { agentId } = req.query;
  if (agentId) {
    return res.json({ count: ledger.getOpenDebts(agentId).length, debts: ledger.getOpenDebts(agentId) });
  }
  res.json({ debts: ledger.getLedger().debts || [] });
});

app.post('/api/ledger/debts', (req, res) => {
  const { creditorId, debtorId, item, count, reason } = req.body;
  if (!creditorId || !debtorId || !item || !count) {
    return res.status(400).json({ error: 'creditorId, debtorId, item, and count required' });
  }
  const result = ledger.addDebt(creditorId, debtorId, item, count, reason);
  res.json(result);
});

app.post('/api/ledger/debts/settle', (req, res) => {
  const { debtId, settledBy } = req.body;
  if (!debtId) {
    return res.status(400).json({ error: 'debtId required' });
  }
  const result = ledger.settleDebt(debtId, settledBy);
  res.json(result);
});

// Faction Endpoints
app.get('/api/ledger/factions', (req, res) => {
  const { member } = req.query;
  const factions = ledger.getFactions(member || null);
  res.json({ count: factions.length, factions });
});

app.post('/api/ledger/factions', (req, res) => {
  const { name, founderId, charter } = req.body;
  if (!name || !founderId) {
    return res.status(400).json({ error: 'name and founderId required' });
  }
  const result = ledger.createFaction(name, founderId, charter);
  res.json(result);
});

app.post('/api/ledger/factions/join', (req, res) => {
  const { factionId, agentId } = req.body;
  if (!factionId || !agentId) {
    return res.status(400).json({ error: 'factionId and agentId required' });
  }
  const result = ledger.joinFaction(factionId, agentId);
  res.json(result);
});

// Treaty / Currency / Settlement / Shared-goal Endpoints — persisted when
// agents declare them via dialogue; the LLM initiates, the ledger remembers.
app.post('/api/ledger/treaty', (req, res) => {
  const { proposer, target, treatyType, honorsStatus = true } = req.body;
  if (!proposer || !target || !treatyType) {
    return res.status(400).json({ error: 'proposer, target, and treatyType required' });
  }
  res.json(ledger.recordTreaty(proposer, target, treatyType, honorsStatus));
});

app.post('/api/ledger/currency', (req, res) => {
  const { name, establishedBy, description } = req.body;
  if (!name || !establishedBy) {
    return res.status(400).json({ error: 'name and establishedBy required' });
  }
  ledger.recordCurrency(name, establishedBy, description);
  res.json({ saved: true });
});

app.post('/api/ledger/settlement', (req, res) => {
  const { name, claimedBy, center, radius } = req.body;
  if (!name || !claimedBy) {
    return res.status(400).json({ error: 'name and claimedBy required' });
  }
  ledger.recordSettlement(name, claimedBy, center, radius);
  res.json({ saved: true });
});

app.post('/api/ledger/shared-goals/propose', (req, res) => {
  const { creatorAgentId, description, requiredAgents, requiredContributions, location } = req.body;
  if (!creatorAgentId || !description) {
    return res.status(400).json({ error: 'creatorAgentId and description required' });
  }
  res.json(ledger.createSharedGoal(creatorAgentId, description, requiredAgents, requiredContributions, location));
});

app.post('/api/ledger/shared-goals/join', (req, res) => {
  const { goalId, agentId } = req.body;
  if (!goalId || !agentId) {
    return res.status(400).json({ error: 'goalId and agentId required' });
  }
  res.json(ledger.joinSharedGoal(goalId, agentId));
});

app.post('/api/ledger/shared-goals/contribute', (req, res) => {
  const { goalId, agentId, itemName, count } = req.body;
  if (!goalId || !agentId || !itemName) {
    return res.status(400).json({ error: 'goalId, agentId, and itemName required' });
  }
  res.json(ledger.contributeToSharedGoal(goalId, agentId, itemName, count));
});

// Territory Claims Endpoints
app.get('/api/ledger/territory/all', (req, res) => {
  res.json({ count: ledger.getTerritoryClaims().length, claims: ledger.getTerritoryClaims() });
});

app.get('/api/ledger/territory', (req, res) => {
  const { x, y, z } = req.query;
  if (x === undefined || z === undefined) {
    return res.status(400).json({ error: 'x and z coordinates required' });
  }
  const claim = ledger.getTerritoryAt(parseFloat(x), parseFloat(y || 64), parseFloat(z));
  res.json({ claimed: !!claim, claim });
});

app.post('/api/ledger/territory/claim', (req, res) => {
  const { agentId, origin, radius, structureType } = req.body;
  if (!agentId || !origin) {
    return res.status(400).json({ error: 'agentId and origin object required' });
  }
  const result = ledger.claimTerritory(agentId, origin, radius, structureType);
  res.json(result);
});

// Shared / Collaborative Goals Endpoints
app.get('/api/ledger/shared-goals', (req, res) => {
  res.json({ count: ledger.getSharedGoals().length, sharedGoals: ledger.getSharedGoals() });
});

app.post('/api/ledger/shared-goals/propose', (req, res) => {
  const { creatorAgentId, description, requiredAgents, requiredContributions, location } = req.body;
  if (!creatorAgentId || !description) {
    return res.status(400).json({ error: 'creatorAgentId and description required' });
  }
  const result = ledger.createSharedGoal(creatorAgentId, description, requiredAgents, requiredContributions, location);
  res.json(result);
});

app.post('/api/ledger/shared-goals/join', (req, res) => {
  const { goalId, agentId } = req.body;
  if (!goalId || !agentId) {
    return res.status(400).json({ error: 'goalId and agentId required' });
  }
  const result = ledger.joinSharedGoal(goalId, agentId);
  res.json(result);
});

app.post('/api/ledger/shared-goals/contribute', (req, res) => {
  const { goalId, agentId, itemName, count } = req.body;
  if (!goalId || !agentId || !itemName) {
    return res.status(400).json({ error: 'goalId, agentId, and itemName required' });
  }
  const result = ledger.contributeToSharedGoal(goalId, agentId, itemName, count || 1);
  res.json(result);
});

// Civilization Chronicle Endpoints
app.get('/api/ledger/chronicle', (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 50;
  const entries = ledger.getChronicle(limit);
  res.json({ count: entries.length, chronicle: entries });
});

app.post('/api/ledger/chronicle', (req, res) => {
  const { headline, detail, relatedAgents, eventType } = req.body;
  if (!headline || !detail) {
    return res.status(400).json({ error: 'headline and detail strings required' });
  }
  const entry = ledger.addChronicleEntry(headline, detail, relatedAgents, eventType);
  res.json({ success: true, entry });
});

// Tax Ledger Endpoints
const taxRecords = [];

app.get('/api/ledger/taxes', (req, res) => {
  const agent = req.query.agent;
  const records = agent ? taxRecords.filter(r => r.payer === agent) : taxRecords;
  const totalPaid = records.reduce((sum, r) => sum + (r.taxAmount || 0), 0);
  res.json({ count: records.length, totalPaid, taxes: records });
});

app.post('/api/ledger/taxes', (req, res) => {
  const { payer, partner, tradeValue, taxAmount, taxRate, items, fairnessScore, timestamp } = req.body;
  if (!payer || typeof taxAmount !== 'number') {
    return res.status(400).json({ error: 'payer and taxAmount required' });
  }
  const record = { id: `tax_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`, payer, partner, tradeValue, taxAmount, taxRate, items, fairnessScore, timestamp: timestamp || Date.now() };
  taxRecords.push(record);
  if (taxRecords.length > 2000) taxRecords.splice(0, taxRecords.length - 2000);
  res.json({ success: true, record });
});

// Rule adjustments queue per agent (Feedback loop from macro reflection prose -> numeric weights)
const pendingRuleAdjustments = new Map(); // agentId -> Array of adjustments

app.post('/api/rules/adjust', (req, res) => {
  const { agentId, ruleType, situationPattern, recommendedConfidenceDelta, reason } = req.body;
  if (!agentId || !ruleType || typeof recommendedConfidenceDelta !== 'number') {
    return res.status(400).json({ error: 'agentId, ruleType, and numeric recommendedConfidenceDelta required' });
  }
  if (!pendingRuleAdjustments.has(agentId)) {
    pendingRuleAdjustments.set(agentId, []);
  }
  const adj = {
    id: `adj_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
    agentId,
    ruleType,
    situationPattern: situationPattern || 'general',
    recommendedConfidenceDelta: Math.max(-0.3, Math.min(0.3, recommendedConfidenceDelta)),
    reason: reason || 'Macro reflection rule weight adjustment',
    createdAt: new Date().toISOString()
  };
  pendingRuleAdjustments.get(agentId).push(adj);
  logger.info('MemoryService', `[RULE ADJUST QUEUE] Stored adjustment for ${agentId}: ${ruleType} (${adj.recommendedConfidenceDelta})`);
  res.json({ success: true, adjustment: adj });
});

app.get('/api/rules/adjust/:agentId', (req, res) => {
  const { agentId } = req.params;
  const list = pendingRuleAdjustments.get(agentId) || [];
  // Clear returned adjustments to prevent double-application
  pendingRuleAdjustments.set(agentId, []);
  res.json({ agentId, count: list.length, adjustments: list });
});

app.listen(config.port, () => {
  logger.info('MemoryService', `Central Memory Service running on http://localhost:${config.port}`);

  // Seed survival skill templates into the ledger on first boot.
  // These teach agents human-like escape strategies (torch navigation,
  // water bucket, underground shelter, strategic death, etc.).
  const { seedSurvivalSkills } = require('../scripts/seed-survival-skills');
  seedSurvivalSkills().then(result => {
    logger.info('MemoryService', `Survival skills seeded: ${result.seeded} OK, ${result.errors} errors`);
  }).catch(err => {
    logger.debug('MemoryService', `Survival skill seeding skipped: ${err.message}`);
  });
});

const shutdown = () => {
  logger.info('MemoryService', 'Flushing ledger before shutdown...');
  ledger.flush();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
