const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const EmbeddingClient = require('../../shared/embeddingClient');
const { cosineSimilarity } = require('../../shared/math');
const logger = require('../../shared/logger');

const SNAPSHOT_PATH = path.join(__dirname, 'vectorIndex.snapshot.json');
const SAVE_INTERVAL_MS = 60000;

// Tag-driven severity prior: entries tagged by EventRouter carry implicit
// importance that raw cosine ignores. A "[death] Incident" must outrank a
// berry discovery even at equal similarity.
const SEVERITY_BY_TAG = [
  ['[death]', 0.9],
  ['[raid]', 0.8],
  ['[damage]', 0.6],
  ['[conflict]', 0.5]
];

function inferSeverity(text) {
  const lower = text.toLowerCase();
  for (const [tag, sev] of SEVERITY_BY_TAG) {
    if (lower.includes(tag)) return sev;
  }
  return null;
}

class VectorMemoryStore {
  constructor() {
    this.embeddingClient = new EmbeddingClient();
    this.agentVectors = new Map(); // agentId -> Array of { text, section, embedding, severity?, ts }
    this._dirty = false;
    this._loadSnapshot();
    this._saveTimer = setInterval(() => {
      if (this._dirty) this.saveSnapshot().catch(err => logger.warn('VectorStore', `Snapshot save failed: ${err.message}`));
    }, SAVE_INTERVAL_MS);
    this._saveTimer.unref?.();
  }

  _loadSnapshot() {
    try {
      if (!fs.existsSync(SNAPSHOT_PATH)) return;
      const raw = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
      let primed = 0;
      for (const [agentId, entries] of Object.entries(raw)) {
        if (Array.isArray(entries)) this.agentVectors.set(agentId, entries);
        // Warm the embedding LRU from restored vectors — without this the
        // first post-boot re-index re-embeds thousands of unchanged texts
        // and pins ollama at 100% CPU for minutes.
        for (const item of entries) {
          if (this.embeddingClient.primeCache(item.text, item.embedding)) primed++;
        }
      }
      const total = [...this.agentVectors.values()].reduce((n, v) => n + v.length, 0);
      logger.info('VectorStore', `Restored vector index from snapshot: ${this.agentVectors.size} agents, ${total} vectors (${primed} embeddings pre-warmed)`);
    } catch (err) {
      logger.warn('VectorStore', `Snapshot restore failed (starting empty): ${err.message}`);
    }
  }

  async saveSnapshot() {
    const serializable = Object.fromEntries(this.agentVectors);
    // Embeddings dominate snapshot size; 1e-5 precision keeps cosine rankings
    // intact while cutting ~40% of the payload. Async write keeps the event
    // loop free during indexing churn.
    const json = JSON.stringify(serializable, (key, value) =>
      Array.isArray(value) && typeof value[0] === 'number'
        ? value.map(n => Math.round(n * 100000) / 100000)
        : value
    );
    const tmpPath = `${SNAPSHOT_PATH}.tmp`;
    await fsp.writeFile(tmpPath, json);
    await fsp.rename(tmpPath, SNAPSHOT_PATH);
    this._dirty = false;
  }

  async indexSectionEntries(agentId, sectionName, entries) {
    if (!this.agentVectors.has(agentId)) {
      this.agentVectors.set(agentId, []);
    }

    const store = this.agentVectors.get(agentId);
    // Remove existing entries for this section to avoid duplicates
    const filtered = store.filter(item => item.section !== sectionName);
    const now = Date.now();

    for (const entry of entries) {
      const embedding = await this.embeddingClient.getEmbedding(entry);
      filtered.push({
        text: entry,
        section: sectionName,
        embedding,
        severity: inferSeverity(entry),
        ts: now
      });
    }

    this.agentVectors.set(agentId, filtered);
    this._dirty = true;
    logger.debug('VectorStore', `Indexed ${entries.length} vectors for ${agentId}/${sectionName}`);
  }

  // Traumatic amnesia must reach the vector index too, or forgotten memories
  // remain semantically searchable — death would cost nothing.
  removeEntries(agentId, textsToRemove) {
    const store = this.agentVectors.get(agentId);
    if (!store || !textsToRemove || textsToRemove.size === 0) return 0;
    const before = store.length;
    this.agentVectors.set(
      agentId,
      store.filter(item => !textsToRemove.has(item.text))
    );
    const removed = before - this.agentVectors.get(agentId).length;
    if (removed > 0) this._dirty = true;
    return removed;
  }

  async searchSimilar(agentId, queryText, limit = 5, sectionFilter = null) {
    if (!this.agentVectors.has(agentId)) return [];

    const queryEmbedding = await this.embeddingClient.getEmbedding(queryText);
    const store = this.agentVectors.get(agentId);

    const scored = [];
    for (const item of store) {
      if (sectionFilter && item.section !== sectionFilter) continue;
      const sim = cosineSimilarity(queryEmbedding, item.embedding);

      // Weighted ranking: severity boost × recency decay (3-day half-life,
      // floored so old-but-relevant knowledge is demoted, never erased).
      let score = sim;
      if (item.severity != null) score *= 0.6 + 0.4 * item.severity;
      if (item.ts) {
        const ageDays = Math.max(0, (Date.now() - item.ts) / 86400000);
        score *= Math.max(0.25, Math.pow(0.5, ageDays / 3));
      }
      scored.push({ text: item.text, section: item.section, score });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(s => s.text);
  }
}

module.exports = VectorMemoryStore;
