const crypto = require('crypto');
const logger = require('../../shared/logger');

class ExactCache {
  constructor(ttlSeconds = 300) {
    this.ttlMs = ttlSeconds * 1000;
    this.memoryCache = new Map(); // key -> { data, expiresAt }
  }

  hashSituation(situation) {
    // Standardize representation for exact matching
    const str = JSON.stringify(situation);
    return crypto.createHash('sha256').update(str).digest('hex');
  }

  get(situation) {
    const key = this.hashSituation(situation);
    const entry = this.memoryCache.get(key);

    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      logger.info('ExactCache', `Cache expired for key ${key.substring(0, 8)}`);
      this.memoryCache.delete(key);
      return null;
    }

    logger.info('ExactCache', `EXACT CACHE HIT for key ${key.substring(0, 8)}`);
    return entry.data;
  }

  set(situation, resultData) {
    const key = this.hashSituation(situation);
    const expiresAt = Date.now() + this.ttlMs;
    this.memoryCache.set(key, { data: resultData, expiresAt });
    // Amortized sweep: clearExpired() has no caller, so purge here —
    // otherwise unique payload hashes accumulate forever (0 exact hits ever).
    if (this.memoryCache.size > 1000) this.clearExpired();
    logger.info('ExactCache', `Cached decision for key ${key.substring(0, 8)} (TTL: ${this.ttlMs / 1000}s)`);
  }

  clearExpired() {
    const now = Date.now();
    for (const [key, entry] of this.memoryCache.entries()) {
      if (now > entry.expiresAt) {
        this.memoryCache.delete(key);
      }
    }
  }
}

module.exports = ExactCache;
