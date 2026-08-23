const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { initializeAgentMemoryFiles, getSectionFilePath, parseSectionFile, SECTIONS } = require('./sections/schema');
const EventRouter = require('./router');
const MemoryCompactor = require('./sections/compactor');
const MemoryScheduler = require('./scheduler');
const VectorMemoryStore = require('./store/vectorStore');
const logger = require('../shared/logger');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const router = new EventRouter();
const compactor = new MemoryCompactor();
const vectorStore = new VectorMemoryStore();
const scheduler = new MemoryScheduler(compactor);
scheduler.start();

// Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'memory-service', uptime: process.uptime() });
});

// Initialize Agent Storage & Indexing
app.post('/api/memory/init', async (req, res) => {
  const { agentId, personality } = req.body;
  if (!agentId) return res.status(400).json({ error: 'agentId required' });
  initializeAgentMemoryFiles(agentId, personality);

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

  const result = await compactor.consolidateSectionFile(agentId, section, process.env.GEMINI_API_KEY || '');
  
  // Re-index section into vector store
  const parsed = parseSectionFile(getSectionFilePath(agentId, section));
  await vectorStore.indexSectionEntries(agentId, section, parsed.entries);

  res.json(result);
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

const CivilizationLedger = require('./store/civilization/ledger');
const ledger = new CivilizationLedger();

// Civilization ledger (for dashboard ledger panel)
app.get('/api/ledger', (req, res) => {
  res.json(ledger.getLedger());
});

// Shared Lessons Endpoints
app.get('/api/ledger/lessons', (req, res) => {
  res.json({ count: ledger.getSharedLessons().length, sharedLessons: ledger.getSharedLessons() });
});

app.post('/api/ledger/lessons', (req, res) => {
  const { agentId, lesson, isPublic, context, confidence } = req.body;
  if (!agentId || !lesson) {
    return res.status(400).json({ error: 'agentId and lesson string required' });
  }
  const result = ledger.recordLesson(agentId, lesson, isPublic, context, confidence);
  res.json(result);
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
});
