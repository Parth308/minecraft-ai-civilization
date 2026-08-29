const crypto = require('crypto');
const logger = require('./logger');

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

    this._cache = new Map();
    this._cacheMax = 2000;

    // Queue-based enrichment: local fallback now, Ollama in background
    this._queue = [];
    this._processing = false;
    this._inflight = new Set();
    this._stats = { served: 0, queued: 0, enriched: 0, failed: 0 };
  }

  _cacheKey(text) {
    return crypto.createHash('sha1').update(text).digest('hex');
  }

  primeCache(text, vector) {
    if (!text || !Array.isArray(vector) || vector.length !== this.dimension) return false;
    const key = this._cacheKey(text);
    if (this._cache.has(key)) return false;
    if (this._cache.size >= this._cacheMax) return false;
    this._cache.set(key, vector);
    return true;
  }

  getEffectiveProvider() {
    if (this.provider === 'local') return 'local';
    if (this.ollamaHost) return 'ollama';
    return 'local';
  }

  async getEmbedding(text) {
    if (!text || typeof text !== 'string') text = JSON.stringify(text || '');

    const key = this._cacheKey(text);

    const cached = this._cache.get(key);
    if (cached) {
      this._stats.served++;
      return cached;
    }

    // Cache miss — return local immediately, queue Ollama enrichment
    const local = this.getLocalEmbedding(text);
    this._setCache(key, local);
    this._stats.served++;

    if (this.getEffectiveProvider() === 'ollama') {
      this._enqueue(text, key);
    }

    return local;
  }

  _setCache(key, vector) {
    if (this._cache.size >= this._cacheMax) {
      const oldest = this._cache.keys().next().value;
      this._cache.delete(oldest);
    }
    this._cache.set(key, vector);
  }

  _enqueue(text, key) {
    if (this._inflight.has(key)) return;
    if (this._queue.length >= 50) return;
    this._inflight.add(key);
    this._queue.push({ text, key });
    this._stats.queued++;
    this._drain();
  }

  async _drain() {
    if (this._processing) return;
    this._processing = true;

    while (this._queue.length > 0) {
      const { text, key } = this._queue.shift();
      try {
        const vector = await this.getOllamaEmbedding(text);
        this._setCache(key, vector);
        this._stats.enriched++;
      } catch (err) {
        this._stats.failed++;
        logger.debug('EmbeddingClient', `Background Ollama enrichment failed: ${err.message}`);
      } finally {
        this._inflight.delete(key);
      }
    }

    this._processing = false;
  }

  getStats() {
    return { ...this._stats, queueLen: this._queue.length };
  }

  async getOllamaEmbedding(text) {
    const url = `${this.ollamaHost.replace(/\/$/, '')}/api/embeddings`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.ollamaModel,
        prompt: text
      }),
      signal: AbortSignal.timeout(30000)
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
