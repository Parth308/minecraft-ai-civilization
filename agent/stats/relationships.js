const logger = require('../../shared/logger');

// Decay tuning: relationship scores drift toward neutral (50) at ~1 point per
// 6 hours since last direct interaction. Grudges and warm feelings both fade —
// slowly enough to matter, fast enough that old feuds don't fossilize.
const DECAY_STEP_PER_HOURS = 6;

class RelationshipTracker {
  constructor() {
    this.relationships = new Map(); // playerUsername -> { trust, affinity, lastInteraction }
  }

  get(username) {
    if (!this.relationships.has(username)) {
      this.relationships.set(username, { trust: 50, affinity: 50, lastInteraction: Date.now() });
    }
    const rel = this.relationships.get(username);
    this._applyLazyDecay(rel);
    return rel;
  }

  // Time-based drift toward emotional neutrality. Lazy — no timers needed.
  _applyLazyDecay(rel) {
    const hoursIdle = (Date.now() - (rel.lastInteraction || Date.now())) / 3600000;
    const steps = Math.floor(hoursIdle / DECAY_STEP_PER_HOURS);
    if (steps <= 0) return;
    rel.lastInteraction = Date.now();
    const drift = (v) => v + Math.sign(50 - v) * Math.min(steps, Math.abs(50 - v));
    const before = { trust: rel.trust, affinity: rel.affinity };
    rel.trust = Math.round(drift(Math.max(0, Math.min(100, rel.trust))));
    rel.affinity = Math.round(drift(Math.max(0, Math.min(100, rel.affinity))));
    if (before.trust !== rel.trust || before.affinity !== rel.affinity) {
      logger.info('Relationship', `Feelings faded toward neutral over ${Math.floor(hoursIdle)}h idle`);
    }
  }

  updateTrust(username, delta) {
    const rel = this.get(username);
    rel.lastInteraction = Date.now();
    rel.trust = Math.max(0, Math.min(100, rel.trust + delta));
    logger.info('Relationship', `Updated trust for ${username}: ${rel.trust} (delta: ${delta})`);
  }

  updateAffinity(username, delta) {
    const rel = this.get(username);
    rel.lastInteraction = Date.now();
    rel.affinity = Math.max(0, Math.min(100, rel.affinity + delta));
    logger.info('Relationship', `Updated affinity for ${username}: ${rel.affinity} (delta: ${delta})`);
  }

  // Hearsay from third parties shifts opinion as a soft PRIOR — small weight,
  // never overrides direct experience. Negative word travels slightly farther
  // than positive (loss aversion).
  applyGossipPrior(username, sentiment) {
    const magnitude = sentiment >= 0 ? Math.round(sentiment * 5) : Math.round(sentiment * 8);
    if (magnitude === 0) return;
    const rel = this.get(username);
    rel.trust = Math.max(0, Math.min(100, rel.trust + magnitude));
    rel.affinity = Math.max(0, Math.min(100, rel.affinity + Math.round(magnitude * 0.7)));
    logger.info('Relationship', `[HEARSAY] ${username} reputation shifted by ${magnitude} via gossip (trust now ${rel.trust})`);
  }

  getAll() {
    for (const name of this.relationships.keys()) this.get(name);
    const obj = {};
    for (const [user, data] of this.relationships.entries()) obj[user] = data;
    return obj;
  }
}

module.exports = RelationshipTracker;
