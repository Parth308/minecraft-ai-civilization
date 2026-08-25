const crypto = require('crypto');
const logger = require('../../shared/logger');

class EmbeddingClient {
  constructor(
    provider = process.env.EMBEDDING_PROVIDER || 'auto',
    apiKey = process.env.GEMINI_API_KEY || '',
    ollamaHost = process.env.OLLAMA_HOST || 'http://ollama:11434',
    ollamaModel = process.env.OLLAMA_MODEL || 'nomic-embed-text'
  ) {
    this.provider = provider;
    this.apiKey = apiKey;
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

  getEffectiveProvider() {
    if (this.provider === 'ollama') return 'ollama';
    if (this.provider === 'gemini' && this.apiKey) return 'gemini';
    if (this.provider === 'local') return 'local';
    
    // In 'auto' mode: check Ollama first if configured, else Gemini, else Local
    if (this.ollamaHost) return 'ollama';
    if (this.apiKey) return 'gemini';
    return 'local';
  }

  async getEmbedding(text) {
    if (!text || typeof text !== 'string') text = JSON.stringify(text || '');

    const key = this._cacheKey(text);
    if (this._cache.has(key)) return this._cache.get(key);

    const effective = this.getEffectiveProvider();
    let vector;

    // 1. Try Ollama nomic-embed-text
    if (effective === 'ollama') {
      try {
        vector = await this.getOllamaEmbedding(text);
      } catch (err) {
        logger.warn('EmbeddingClient', `Ollama (${this.ollamaModel}) failed (${err.message}). Trying secondary provider.`);
        if (this.apiKey) {
          try {
            vector = await this.getGeminiEmbedding(text);
          } catch (gErr) {
            logger.warn('EmbeddingClient', `Gemini embedding fallback failed (${gErr.message}). Using local deterministic engine.`);
            vector = this.getLocalEmbedding(text);
          }
        } else {
          vector = this.getLocalEmbedding(text);
        }
      }
    }

    // 2. Try Gemini
    if (vector === undefined && effective === 'gemini') {
      try {
        vector = await this.getGeminiEmbedding(text);
      } catch (err) {
        logger.warn('EmbeddingClient', `Gemini embedding failed (${err.message}). Falling back to local embedding engine.`);
        vector = this.getLocalEmbedding(text);
      }
    }

    if (vector === undefined) {
      // 3. Deterministic Local N-gram Fallback
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
    const values = data.embedding?.values;
    if (!values || !Array.isArray(values)) {
      throw new Error('Malformed Gemini embedding response');
    }

    return this.normalizeVector(values);
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
