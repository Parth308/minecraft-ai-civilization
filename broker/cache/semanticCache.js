const EmbeddingClient = require('../../memory-service/embeddings/client');
const logger = require('../../shared/logger');

function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

class SemanticCache {
  constructor(similarityThreshold = 0.88, ttlSeconds = 600) {
    this.similarityThreshold = similarityThreshold;
    this.ttlMs = ttlSeconds * 1000;
    this.entries = []; // Array of { text, embedding, decision, expiresAt }
    this.embeddingClient = new EmbeddingClient();
  }

  summarizeSituation(situationPayload) {
    const topCandidate = situationPayload.topCandidate || {};
    const stats = situationPayload.stats || {};
    return `Situation: ${topCandidate.name || 'UNKNOWN'} reason: ${topCandidate.reason || ''}. HP: ${stats.health || 20}, Hunger: ${stats.hunger || 100}, Anger: ${stats.anger || 0}, Fatigue: ${stats.fatigue || 0}`;
  }

  async findSimilar(situationPayload) {
    const text = this.summarizeSituation(situationPayload);
    const queryEmbedding = await this.embeddingClient.getEmbedding(text);
    const now = Date.now();

    let bestMatch = null;
    let highestSimilarity = -1;

    for (let i = this.entries.length - 1; i >= 0; i--) {
      const item = this.entries[i];
      if (now > item.expiresAt) {
        this.entries.splice(i, 1);
        continue;
      }

      const similarity = cosineSimilarity(queryEmbedding, item.embedding);
      if (similarity > highestSimilarity) {
        highestSimilarity = similarity;
        bestMatch = item;
      }
    }

    if (bestMatch && highestSimilarity >= this.similarityThreshold) {
      logger.info('SemanticCache', `SEMANTIC CACHE HIT! Similarity: ${(highestSimilarity * 100).toFixed(1)}% (Threshold: ${this.similarityThreshold * 100}%)`);
      return {
        ...bestMatch.decision,
        cached: true,
        semanticCache: true,
        similarity: parseFloat(highestSimilarity.toFixed(3))
      };
    }

    return null;
  }

  async store(situationPayload, decisionData) {
    const text = this.summarizeSituation(situationPayload);
    const embedding = await this.embeddingClient.getEmbedding(text);
    const expiresAt = Date.now() + this.ttlMs;

    this.entries.push({
      text,
      embedding,
      decision: decisionData,
      expiresAt
    });

    logger.info('SemanticCache', `Stored situation embedding in semantic cache (Total: ${this.entries.length} vectors, TTL: ${this.ttlMs / 1000}s)`);
  }
}

module.exports = {
  SemanticCache,
  cosineSimilarity
};
