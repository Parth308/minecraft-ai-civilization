const express = require('express');
const config = require('./config');
const { initializeAgentMemoryFiles, getSectionFilePath, parseSectionFile } = require('./sections/schema');
const EventRouter = require('./router');
const MemoryCompactor = require('./sections/compactor');
const MemoryScheduler = require('./scheduler');
const logger = require('../shared/logger');

const app = express();
app.use(express.json());

const router = new EventRouter();
const compactor = new MemoryCompactor();
const scheduler = new MemoryScheduler(compactor);
scheduler.start();

// Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'memory-service', uptime: process.uptime() });
});

// Initialize Agent Storage
app.post('/api/memory/init', (req, res) => {
  const { agentId, personality } = req.body;
  if (!agentId) return res.status(400).json({ error: 'agentId required' });
  initializeAgentMemoryFiles(agentId, personality);
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
  res.json(result);
});

// Tier 2: Manual / Scheduled Section Consolidation
app.post('/api/memory/consolidate', async (req, res) => {
  const { agentId, section } = req.body;
  if (!agentId || !section) {
    return res.status(400).json({ error: 'agentId and section required' });
  }

  const result = await compactor.consolidateSectionFile(agentId, section, process.env.GEMINI_API_KEY || '');
  res.json(result);
});

// Query Memory (Section-scoped retrieval)
app.get('/api/memory/query', (req, res) => {
  const { agentId, query, section, limit } = req.query;
  if (!agentId) return res.status(400).json({ error: 'agentId required' });

  initializeAgentMemoryFiles(agentId);

  let targetSections = [];
  if (section) {
    targetSections = [section];
  } else if (query) {
    // Route query keyword to likely section
    const q = query.toLowerCase();
    if (q.includes('player') || q.includes('who') || q.includes('trust')) targetSections.push('relationships');
    if (q.includes('danger') || q.includes('death') || q.includes('hurt') || q.includes('combat')) targetSections.push('events');
    if (q.includes('mine') || q.includes('build') || q.includes('wood') || q.includes('iron') || q.includes('where')) targetSections.push('skills');
    if (targetSections.length === 0) targetSections = ['relationships', 'events', 'skills'];
  } else {
    targetSections = ['profile', 'relationships', 'events', 'skills'];
  }

  const results = [];
  const maxLines = parseInt(limit, 10) || 5;

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
    sectionsQueried: targetSections,
    count: results.length,
    memories: results.slice(-maxLines)
  });
});

app.listen(config.port, () => {
  logger.info('MemoryService', `Central Memory Service running on http://localhost:${config.port}`);
});
