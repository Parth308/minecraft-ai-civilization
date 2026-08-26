const crypto = require('crypto');
const logger = require('./logger');

// Shared embedding engine — consumed by BOTH broker (semantic cache) and
// memory-service (vector store). Lives in shared/ so neither service image
// needs to copy the other's source tree.
class EmbeddingClient {
  constructor(
    provider = process.env.EMBEDDING_PROVIDER || 'auto',
    ollamaHost = process.env.OLLAMA_HOST || 'http://ollama:11434',
    ollamaModel = process.env.OLLAMA_MODEL || 'nomic-embed-text'
  ) {
    this.provider = provider;
    this.ollamaHost = ollamaHost;
    this.ollamaModel = ollamaModel;
    this.dimension = 768;
    // Identical texts recur constantly (cached broker decisions replay the
    // same situation strings). One LRU-ish cache entry saves an ollama round
    // trip — and ollama CPU was the box's top bottleneck.
    this._cache = new Map();
    this._cacheMax = 2000;
  }

  _cacheKey(text) {
    return crypto.createHash('sha1').update(text).digest('hex');
  }

  // Gemini embeddings removed entirely (text-embedding-004 endpoint 404'd 3.6K×
  // per log window before removal). Chain is now strictly local-only:
  // self-hosted Ollama nomic-embed-text → deterministic local engine fallback.
  getEffectiveProvider() {
    if (this.provider === 'local') return 'local';
    if (this.ollamaHost) return 'ollama';
    return 'local';
  }

  async getEmbedding(text) {
    if (!text || typeof text !== 'string') text = JSON.stringify(text || '');

    const key = this._cacheKey(text);
    if (this._cache.has(key)) return this._cache.get(key);

    let vector;

    if (this.getEffectiveProvider() === 'ollama') {
      try {
        vector = await this.getOllamaEmbedding(text);
      } catch (err) {
        logger.warn('EmbeddingClient', `Ollama (${this.ollamaModel}) failed (${err.message}). Using local deterministic engine.`);
        vector = this.getLocalEmbedding(text);
      }
    }

    if (vector === undefined) {
      vector = this.getLocalEmbedding(text);
    }

    if (this._cache.size >= this._cacheMax) {
      const oldest = this._cache.keys().next().value;
      this._cache.delete(oldest);
    }
    this._cache.set(key, vector);
    return vector;
  }

  // Ollama Embeddings API (nomic-embed-text: 768 dimensions)
  async getOllamaEmbedding(text) {
    const url = `${this.ollamaHost.replace(/\/$/, '')}/api/embeddings`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.ollamaModel,
        prompt: text
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    if (!data.embedding || !Array.isArray(data.embedding)) {
      throw new Error('Malformed Ollama embedding response');
    }

    return this.normalizeVector(data.embedding);
  }

  // Fast, deterministic, zero-overhead Local Semantic Feature Embedding
  getLocalEmbedding(text) {
    const vector = new Array(this.dimension).fill(0);
    const tokens = text.toLowerCase().replace(/[^a-z0-9_\s]/g, ' ').split(/\s+/).filter(Boolean);

    if (tokens.length === 0) return vector;

    tokens.forEach((token, index) => {
      const hash = crypto.createHash('md5').update(token).digest();
      const pos1 = hash.readUInt16BE(0) % this.dimension;
      const pos2 = hash.readUInt16BE(2) % this.dimension;
      const weight = 1.0 / Math.sqrt(index + 1);

      vector[pos1] += weight;
      vector[pos2] += weight * 0.5;

      if (index > 0) {
        const bigram = `${tokens[index - 1]}_${token}`;
        const biHash = crypto.createHash('md5').update(bigram).digest();
        const biPos = biHash.readUInt16BE(0) % this.dimension;
        vector[biPos] += weight * 1.5;
      }
    });

    return this.normalizeVector(vector);
  }

  normalizeVector(vec) {
    let norm = 0;
    for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < vec.length; i++) vec[i] /= norm;
    }
    return vec;
  }
}

module.exports = EmbeddingClient;
