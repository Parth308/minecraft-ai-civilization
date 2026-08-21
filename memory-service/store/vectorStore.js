const EmbeddingClient = require('../embeddings/client');
const { cosineSimilarity } = require('../../broker/cache/semanticCache');
const logger = require('../../shared/logger');

class VectorMemoryStore {
  constructor() {
    this.embeddingClient = new EmbeddingClient();
    this.agentVectors = new Map(); // agentId -> Array of { text, section, embedding }
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
