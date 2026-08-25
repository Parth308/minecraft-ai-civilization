const fs = require('fs');
const path = require('path');
const EmbeddingClient = require('../embeddings/client');
const { cosineSimilarity } = require('../../broker/cache/semanticCache');
const logger = require('../../shared/logger');

const SNAPSHOT_PATH = path.join(__dirname, 'vectorIndex.snapshot.json');
const SAVE_INTERVAL_MS = 60000;

class VectorMemoryStore {
  constructor() {
    this.embeddingClient = new EmbeddingClient();
    this.agentVectors = new Map(); // agentId -> Array of { text, section, embedding }
    this._dirty = false;
    this._loadSnapshot();
    this._saveTimer = setInterval(() => {
      if (this._dirty) this.saveSnapshot().catch(() => {});
    }, SAVE_INTERVAL_MS);
    this._saveTimer.unref?.();
  }

  _loadSnapshot() {
    try {
      if (!fs.existsSync(SNAPSHOT_PATH)) return;
      const raw = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
      for (const [agentId, entries] of Object.entries(raw)) {
        if (Array.isArray(entries)) this.agentVectors.set(agentId, entries);
      }
      const total = [...this.agentVectors.values()].reduce((n, v) => n + v.length, 0);
      logger.info('VectorStore', `Restored vector index from snapshot: ${this.agentVectors.size} agents, ${total} vectors`);
    } catch (err) {
      logger.warn('VectorStore', `Snapshot restore failed (starting empty): ${err.message}`);
    }
  }

  async saveSnapshot() {
    const serializable = Object.fromEntries(this.agentVectors);
    const tmpPath = `${SNAPSHOT_PATH}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(serializable));
    fs.renameSync(tmpPath, SNAPSHOT_PATH);
    this._dirty = false;
  }

  async indexSectionEntries(agentId, sectionName, entries) {
    if (!this.agentVectors.has(agentId)) {
      this.agentVectors.set(agentId, []);
    }

    const store = this.agentVectors.get(agentId);
    // Remove existing entries for this section to avoid duplicates
    const filtered = store.filter(item => item.section !== sectionName);

    for (const entry of entries) {
      const embedding = await this.embeddingClient.getEmbedding(entry);
      filtered.push({
        text: entry,
        section: sectionName,
        embedding
      });
    }

    this.agentVectors.set(agentId, filtered);
    this._dirty = true;
    logger.debug('VectorStore', `Indexed ${entries.length} vectors for ${agentId}/${sectionName}`);
  }

  async searchSimilar(agentId, queryText, limit = 5, sectionFilter = null) {
    if (!this.agentVectors.has(agentId)) return [];

    const queryEmbedding = await this.embeddingClient.getEmbedding(queryText);
    const store = this.agentVectors.get(agentId);

    const scored = [];
    for (const item of store) {
      if (sectionFilter && item.section !== sectionFilter) continue;
      const score = cosineSimilarity(queryEmbedding, item.embedding);
      scored.push({ text: item.text, section: item.section, score });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(s => s.text);
  }
}

module.exports = VectorMemoryStore;
