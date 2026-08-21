const fs = require('fs');
const path = require('path');
const config = require('./config');
const { parseSectionFile, getSectionFilePath } = require('./sections/schema');
const logger = require('../shared/logger');

class MemoryScheduler {
  constructor(compactor, apiKey = '') {
    this.compactor = compactor;
    this.apiKey = apiKey || process.env.GEMINI_API_KEY || '';
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
    logger.info('MemoryScheduler', 'Running scheduled Tier 2 memory consolidation sweep across agents...');
    const agentsDir = config.baseStorePath;
    if (!fs.existsSync(agentsDir)) return;

    const agentFolders = fs.readdirSync(agentsDir).filter(f => fs.statSync(path.join(agentsDir, f)).isDirectory());

    for (const agentId of agentFolders) {
      for (const [sectionName, cap] of Object.entries(config.caps)) {
        if (sectionName === 'profile') continue; // Profile never compacts

        const filePath = getSectionFilePath(agentId, sectionName);
        if (!fs.existsSync(filePath)) continue;

        const stats = fs.statSync(filePath);
        const parsed = parseSectionFile(filePath);

        const exceedsEntries = parsed.entries.length >= cap.maxEntries;
        const exceedsBytes = stats.size >= cap.maxBytes;

        if (exceedsEntries || exceedsBytes) {
          logger.warn('MemoryScheduler', `Soft cap exceeded for ${agentId}/${sectionName}.md (${parsed.entries.length} entries, ${stats.size} bytes). Triggering Tier 2 consolidation.`);
          await this.compactor.consolidateSectionFile(agentId, sectionName, this.apiKey);
        }
      }
    }
  }
}

module.exports = MemoryScheduler;
