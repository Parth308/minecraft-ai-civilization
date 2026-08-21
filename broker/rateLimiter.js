const logger = require('../shared/logger');

class RateLimiter {
  constructor() {
    this.providerCooldowns = new Map(); // providerName -> timestamp when unblocked
  }

  isBlocked(providerName) {
    const unblockTime = this.providerCooldowns.get(providerName) || 0;
    return Date.now() < unblockTime;
  }

  markRateLimited(providerName, cooldownMs = 60000) {
    const unblockTime = Date.now() + cooldownMs;
    this.providerCooldowns.set(providerName, unblockTime);
    logger.warn('RateLimiter', `Provider ${providerName} rate limited! Cooldown for ${cooldownMs / 1000}s`);
  }
}

module.exports = RateLimiter;
