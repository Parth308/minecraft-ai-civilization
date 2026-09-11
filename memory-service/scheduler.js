const fs = require('fs');
const path = require('path');
const v8 = require('v8');
const config = require('./config');
const { parseSectionFile, getSectionFilePath } = require('./sections/schema');
const logger = require('../shared/logger');

// Tier2 sweep builds full-section LLM prompts per agent; defer the whole
// sweep when the heap is already hot so consolidation never triggers OOM.
const SWEEP_HEAP_GUARD_RATIO = 0.8;

class MemoryScheduler {
  constructor(compactor) {
    this.compactor = compactor;
    this.interval = null;
  }

  start() {
    logger.info('MemoryScheduler', `Starting Tier 2 compaction scheduler (interval: ${config.schedulerIntervalMs / 1000}s)`);
    this.interval = setInterval(() => this.runSweep(), config.schedulerIntervalMs);
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
  }

  async runSweep() {
    try {
      const stats = v8.getHeapStatistics();
      if (stats.used_heap_size / stats.heap_size_limit > SWEEP_HEAP_GUARD_RATIO) {
        logger.warn('MemoryScheduler', 'Sweep deferred: heap over guard ratio');
        return;
      }
    } catch { /* fall through to sweep */ }
    logger.info('MemoryScheduler', 'Running scheduled Tier 2 memory consolidation sweep across agents...');
    const agentsDir = config.baseStorePath;
    if (!fs.existsSync(agentsDir)) return;

    const agentFolders = fs.readdirSync(agentsDir).filter(f => fs.statSync(path.join(agentsDir, f)).isDirectory());

    for (const agentId of agentFolders) {
      for (const [sectionName, cap] of Object.entries(config.caps)) {
        if (sectionName === 'profile') continue;

        const filePath = getSectionFilePath(agentId, sectionName);
        if (!fs.existsSync(filePath)) continue;

        const stats = fs.statSync(filePath);
        const parsed = parseSectionFile(filePath);

        const exceedsEntries = parsed.entries.length >= cap.maxEntries;
        const exceedsBytes = stats.size >= cap.maxBytes;

        if (exceedsEntries || exceedsBytes) {
          logger.warn('MemoryScheduler', `Soft cap exceeded for ${agentId}/${sectionName}.md (${parsed.entries.length} entries, ${stats.size} bytes). Triggering Tier 2 consolidation.`);
          await this.compactor.consolidateSectionFile(agentId, sectionName);
        }
      }
      await new Promise(r => setTimeout(r, 2000));
      if (global.gc) global.gc();
    }
  }
}

module.exports = MemoryScheduler;
