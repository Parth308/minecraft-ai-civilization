const logger = require('../../shared/logger');

class RelationshipTracker {
  constructor() {
    this.relationships = new Map(); // playerUsername -> { trust: 50, affinity: 50 }
  }

  get(username) {
    if (!this.relationships.has(username)) {
      this.relationships.set(username, { trust: 50, affinity: 50 });
    }
    return this.relationships.get(username);
  }

  updateTrust(username, delta) {
    const rel = this.get(username);
    rel.trust = Math.max(0, Math.min(100, rel.trust + delta));
    logger.info('Relationship', `Updated trust for ${username}: ${rel.trust} (delta: ${delta})`);
  }

  updateAffinity(username, delta) {
    const rel = this.get(username);
    rel.affinity = Math.max(0, Math.min(100, rel.affinity + delta));
    logger.info('Relationship', `Updated affinity for ${username}: ${rel.affinity} (delta: ${delta})`);
  }

  getAll() {
    const obj = {};
    for (const [user, data] of this.relationships.entries()) {
      obj[user] = data;
    }
    return obj;
  }
}

module.exports = RelationshipTracker;
