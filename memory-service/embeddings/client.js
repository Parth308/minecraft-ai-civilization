const crypto = require('crypto');
const logger = require('../../shared/logger');

class EmbeddingClient {
  constructor(provider = process.env.EMBEDDING_PROVIDER || 'auto', apiKey = process.env.GEMINI_API_KEY || '') {
    this.provider = provider;
    this.apiKey = apiKey;
    this.dimension = 768;
  }

  getEffectiveProvider() {
    if (this.provider === 'gemini' && this.apiKey) return 'gemini';
    if (this.provider === 'local') return 'local';
    return this.apiKey ? 'gemini' : 'local';
  }

  async getEmbedding(text) {
    if (!text || typeof text !== 'string') text = JSON.stringify(text || '');

    const effective = this.getEffectiveProvider();
    if (effective === 'gemini') {
      try {
        return await this.getGeminiEmbedding(text);
      } catch (err) {
        logger.warn('EmbeddingClient', `Gemini embedding failed (${err.message}). Falling back to local embedding engine.`);
        return this.getLocalEmbedding(text);
      }
    }

    return this.getLocalEmbedding(text);
  }

  // Gemini Hosted Embedding API
  async getGeminiEmbedding(text) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${this.apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'models/text-embedding-004',
        content: { parts: [{ text }] }
      })
    });

    if (!response.ok) {
      throw new Error(`Gemini Embedding API error HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    return data.embedding?.values || this.getLocalEmbedding(text);
  }

  // Fast, deterministic, zero-overhead Local Semantic Feature Embedding
  getLocalEmbedding(text) {
    const vector = new Array(this.dimension).fill(0);
    const tokens = text.toLowerCase().replace(/[^a-z0-9_\s]/g, ' ').split(/\s+/).filter(Boolean);

    if (tokens.length === 0) return vector;

    // Token frequency & N-gram hashing into unit hypersphere
    tokens.forEach((token, index) => {
      const hash = crypto.createHash('md5').update(token).digest();
      const pos1 = hash.readUInt16BE(0) % this.dimension;
      const pos2 = hash.readUInt16BE(2) % this.dimension;
      const weight = 1.0 / Math.sqrt(index + 1);

      vector[pos1] += weight;
      vector[pos2] += weight * 0.5;

      // Bigram token hashing for semantic sequence awareness
      if (index > 0) {
        const bigram = `${tokens[index - 1]}_${token}`;
        const biHash = crypto.createHash('md5').update(bigram).digest();
        const biPos = biHash.readUInt16BE(0) % this.dimension;
        vector[biPos] += weight * 1.5;
      }
    });

    // L2 Normalize
    let norm = 0;
    for (let i = 0; i < this.dimension; i++) norm += vector[i] * vector[i];
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < this.dimension; i++) vector[i] /= norm;
    }

    return vector;
  }
}

module.exports = EmbeddingClient;
