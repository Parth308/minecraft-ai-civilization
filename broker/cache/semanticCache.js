const EmbeddingClient = require('../../shared/embeddingClient');
const { cosineSimilarity } = require('../../shared/math');
const logger = require('../../shared/logger');

class SemanticCache {
  constructor(similarityThreshold = 0.88, ttlSeconds = 600) {
    this.similarityThreshold = similarityThreshold;
    this.ttlMs = ttlSeconds * 1000;
    this.entries = []; // Array of { text, embedding, decision, expiresAt }
    this.maxEntries = 2000; // 7 agents × repeating situations — dedup keeps it far below this
    this.embeddingClient = new EmbeddingClient();
  }

  summarizeSituation(situationPayload) {
    const topCandidate = situationPayload.topCandidate || {};
    const stats = situationPayload.stats || {};
    const offer = topCandidate.tradeOffer ?? topCandidate.dealAccepted ?? topCandidate.targetResource ?? '';
    const offerStr = typeof offer === 'object' ? JSON.stringify(offer) : String(offer || '');
    const pos = situationPayload.position || {};
    const posStr = (typeof pos.x === 'number' && typeof pos.z === 'number') ? ` pos:${Math.round(pos.x)},${Math.round(pos.z)}` : '';
    const goal = situationPayload.activeGoal ? ` goal:${String(situationPayload.activeGoal).slice(0, 60)}` : '';
    return `Situation: ${topCandidate.name || 'UNKNOWN'} reason: ${topCandidate.reason || ''}. HP: ${stats.health || 20}, Hunger: ${stats.hunger || 100}, Anger: ${stats.anger || 0}, Fatigue: ${stats.fatigue || 0}${offerStr ? ` offer:${offerStr.slice(0, 80)}` : ''}${posStr}${goal}`.slice(0, 400);
  }

  async findSimilar(situationPayload, minSimilarity = null) {
    const threshold = minSimilarity ?? this.similarityThreshold;
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

    if (bestMatch && highestSimilarity >= threshold) {
      logger.info('SemanticCache', `SEMANTIC CACHE HIT! Similarity: ${(highestSimilarity * 100).toFixed(1)}% (Threshold: ${(threshold * 100)}%)`);
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
    const now = Date.now();

    // Dedup: same situation repeats constantly across 7 agents — refresh
    // expiry instead of stacking identical vectors (scan stays cheap).
    const existing = this.entries.find(e => e.text === text);
    if (existing) {
      existing.decision = decisionData;
      existing.expiresAt = now + this.ttlMs;
      return;
    }

    const embedding = await this.embeddingClient.getEmbedding(text);
    const expiresAt = now + this.ttlMs;

    this.entries.push({
      text,
      embedding,
      decision: decisionData,
      expiresAt
    });

    // Cap: purge expired first, then oldest — bounds memory and scan cost.
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.filter(e => e.expiresAt > now);
      while (this.entries.length > this.maxEntries) this.entries.shift();
    }

    logger.info('SemanticCache', `Stored situation embedding in semantic cache (Total: ${this.entries.length} vectors, TTL: ${this.ttlMs / 1000}s)`);
  }
}

module.exports = {
  SemanticCache,
  cosineSimilarity
};
