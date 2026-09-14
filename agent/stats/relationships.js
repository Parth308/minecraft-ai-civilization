const logger = require('../../shared/logger');

const DECAY_STEP_PER_HOURS = 6;
const SAVE_INTERVAL_MS = 5 * 60 * 1000;

class RelationshipTracker {
  constructor(memoryClient) {
    this.relationships = new Map();
    this.memoryClient = memoryClient || null;
    this._saveTimer = null;
    this._dirty = false;
    this._loaded = false;
  }

  async loadFromMemory() {
    if (!this.memoryClient) return;
    try {
      const content = await this.memoryClient.loadSection('relationships');
      if (!content || !content.trim()) {
        this._loaded = true;
        return;
      }
      const lines = content.split('\n').filter(l => l.startsWith('|'));
      const dataLines = lines.filter(l => !l.startsWith('|---') && !l.startsWith('| name'));
      for (const line of dataLines) {
        const cols = line.split('|').map(c => c.trim()).filter(Boolean);
        if (cols.length < 4) continue;
        const [name, trustStr, affinityStr, lastStr] = cols;
        const trust = parseInt(trustStr, 10);
        const affinity = parseInt(affinityStr, 10);
        const lastInteraction = parseInt(lastStr, 10);
        if (isNaN(trust) || isNaN(affinity)) continue;
        this.relationships.set(name, {
          trust: Math.max(0, Math.min(100, trust)),
          affinity: Math.max(0, Math.min(100, affinity)),
          lastInteraction: isNaN(lastInteraction) ? Date.now() : lastInteraction
        });
      }
      this._loaded = true;
      logger.info('Relationship', `Loaded ${this.relationships.size} relationships from memory`);
    } catch (err) {
      logger.warn('Relationship', `Load from memory failed: ${err.message}`);
      this._loaded = true;
    }
  }

  startAutoSave() {
    if (this._saveTimer) return;
    this._saveTimer = setInterval(() => this.saveToMemory(), SAVE_INTERVAL_MS);
  }

  async saveToMemory() {
    if (!this.memoryClient || !this._dirty || !this._loaded) return;
    try {
      const lines = [
        '| name | trust | affinity | lastInteraction |',
        '|---|---|---|---|'
      ];
      for (const [name, rel] of this.relationships.entries()) {
        lines.push(`| ${name} | ${rel.trust} | ${rel.affinity} | ${rel.lastInteraction} |`);
      }
      const content = lines.join('\n') + '\n';
      await this.memoryClient.saveSection('relationships', content);
      this._dirty = false;
    } catch (err) {
      logger.warn('Relationship', `Save to memory failed: ${err.message}`);
    }
  }

  shutdown() {
    if (this._saveTimer) clearInterval(this._saveTimer);
    this.saveToMemory();
  }

  get(username) {
    if (!this.relationships.has(username)) {
      this.relationships.set(username, { trust: 50, affinity: 50, lastInteraction: Date.now() });
    }
    const rel = this.relationships.get(username);
    this._applyLazyDecay(rel);
    return rel;
  }

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
      this._dirty = true;
      logger.info('Relationship', `Feelings faded toward neutral over ${Math.floor(hoursIdle)}h idle`);
    }
  }

  updateTrust(username, delta) {
    const rel = this.get(username);
    rel.lastInteraction = Date.now();
    rel.trust = Math.max(0, Math.min(100, rel.trust + delta));
    this._dirty = true;
    logger.info('Relationship', `Updated trust for ${username}: ${rel.trust} (delta: ${delta})`);
  }

  updateAffinity(username, delta) {
    const rel = this.get(username);
    rel.lastInteraction = Date.now();
    rel.affinity = Math.max(0, Math.min(100, rel.affinity + delta));
    this._dirty = true;
    logger.info('Relationship', `Updated affinity for ${username}: ${rel.affinity} (delta: ${delta})`);
  }

  applyGossipPrior(username, sentiment) {
    const magnitude = sentiment >= 0 ? Math.round(sentiment * 5) : Math.round(sentiment * 8);
    if (magnitude === 0) return;
    const rel = this.get(username);
    rel.trust = Math.max(0, Math.min(100, rel.trust + magnitude));
    rel.affinity = Math.max(0, Math.min(100, rel.affinity + Math.round(magnitude * 0.7)));
    this._dirty = true;
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
