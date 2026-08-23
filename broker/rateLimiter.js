const logger = require('../shared/logger');

/**
 * RateLimiter — tracks per-provider 429 cooldowns and cumulative hit counts.
 * Exposes getState() so the broker /api/stats endpoint can report
 * rate-limit health to the dashboard.
 */
class RateLimiter {
  constructor() {
    this.providerCooldowns = new Map(); // providerName -> timestamp when unblocked
    this.agentTaskCooldowns = new Map(); // `${agentId}:${taskType}` -> timestamp when unblocked

    // Observability counters (cumulative since process start)
    this.stats = {}; // providerName -> { hits, lastHitAt }
  }

  isBlocked(providerName) {
    const unblockTime = this.providerCooldowns.get(providerName) || 0;
    return Date.now() < unblockTime;
  }

  isAgentTaskBlocked(agentId, taskType) {
    const key = `${agentId}:${taskType}`;
    const unblockTime = this.agentTaskCooldowns.get(key) || 0;
    return Date.now() < unblockTime;
  }

  markAgentTaskCooldown(agentId, taskType, cooldownMs = 300000) {
    const key = `${agentId}:${taskType}`;
    this.agentTaskCooldowns.set(key, Date.now() + cooldownMs);
    logger.info('RateLimiter', `Agent ${agentId} task '${taskType}' set on cooldown for ${cooldownMs / 1000}s`);
  }

  markRateLimited(providerName, cooldownMs = 60000) {
    const unblockTime = Date.now() + cooldownMs;
    this.providerCooldowns.set(providerName, unblockTime);

    if (!this.stats[providerName]) {
      this.stats[providerName] = { hits: 0, lastHitAt: null };
    }
    this.stats[providerName].hits += 1;
    this.stats[providerName].lastHitAt = new Date().toISOString();

    logger.warn('RateLimiter', `Provider ${providerName} rate limited! Cooldown for ${cooldownMs / 1000}s`);
  }

  /**
   * Snapshot of limiter state for observability endpoints.
   */
  getState() {
    const providers = {};
    for (const [name, unblockTime] of this.providerCooldowns.entries()) {
      const s = this.stats[name] || { hits: 0, lastHitAt: null };
      providers[name] = {
        blocked: Date.now() < unblockTime,
        blockedUntil: unblockTime > Date.now() ? new Date(unblockTime).toISOString() : null,
        cooldownRemainingMs: Math.max(0, unblockTime - Date.now()),
        totalHits: s.hits,
        lastHitAt: s.lastHitAt
      };
    }
    return { providers };
  }
}

module.exports = RateLimiter;
