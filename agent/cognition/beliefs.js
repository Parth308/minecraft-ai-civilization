const fs = require('fs');
const os = require('os');
const path = require('path');
const logger = require('../../shared/logger');

// Evidence-weighted belief network — the agent's MINDSET. Strength follows
// evidence via logistic curve; beliefs color how the world is interpreted but
// never command behavior. Persisted locally per agent (private inner life).
class BeliefNetwork {
  constructor(agentId) {
    this.agentId = agentId;
    this.file = path.join(process.env.AGENT_STATE_DIR || os.tmpdir(), `beliefs_${agentId}.json`);
    this.beliefs = new Map();
    this._load();
  }

  static instances = new Map();
  static forAgent(agentId) {
    if (!BeliefNetwork.instances.has(agentId)) {
      BeliefNetwork.instances.set(agentId, new BeliefNetwork(agentId));
    }
    return BeliefNetwork.instances.get(agentId);
  }

  _load() {
    try {
      if (fs.existsSync(this.file)) {
        const raw = JSON.parse(fs.readFileSync(this.file, 'utf-8'));
        for (const [k, v] of Object.entries(raw)) this.beliefs.set(k, v);
      }
    } catch { /* fresh start */ }
    // Universal human priors on first boot — every mind starts somewhere.
    const seeds = [
      ['world_danger', 'The world is dangerous', 1],
      ['people_vary', 'Some people are kind, some are cruel', 2],
      ['effort_pays', 'Hard work pays off', 1]
    ];
    let seeded = false;
    for (const [k, stmt, ev] of seeds) {
      if (!this.beliefs.has(k)) { this.beliefs.set(k, { statement: stmt, evidence: ev }); seeded = true; }
    }
    if (seeded) this._save();
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(Object.fromEntries(this.beliefs), null, 2), 'utf-8');
    } catch (err) {
      logger.debug('Beliefs', `Persist failed: ${err.message}`);
    }
  }

  // strength = logistic(evidence) in 0..1; evidence ± capped ±12 per belief
  update(key, statement, deltaEvidence) {
    const b = this.beliefs.get(key) || { statement, evidence: 0 };
    b.statement = statement || b.statement;
    b.evidence = Math.max(-12, Math.min(12, (b.evidence || 0) + deltaEvidence));
    b.strength = Number((1 / (1 + Math.exp(-b.evidence / 3))).toFixed(2));
    b.lastUpdated = new Date().toISOString();
    this.beliefs.set(key, b);
    logger.info('Beliefs', `${this.agentId} belief "${b.statement}" strength ${b.strength} (evidence ${b.evidence >= 0 ? '+' : ''}${b.evidence})`);
    this._save();
    return b;
  }

  get(key) {
    return this.beliefs.get(key);
  }

  // Grudges against creature types: repeated harm hardens into targeted aggression
  noteMobGrudge(mobType, delta = 0.25) {
    if (!mobType) return;
    return this.update('mob_grudge.' + mobType, `Bears a grudge against ${mobType}s`, delta);
  }

  grudgeAgainst(mobType) {
    const b = this.beliefs.get('mob_grudge.' + mobType);
    return b ? b.strength : 0;
  }

  // Life-event wiring — same triggers the emotion engine eats
  learnFrom(eventType, ctx = {}) {
    switch (eventType) {
      case 'death_self': this.update('world_danger', 'The world is dangerous', +2); break;
      case 'near_death': this.update('world_danger', 'The world is dangerous', +1); break;
      case 'betrayal': this.update('people_cruel', 'People can be cruel when it profits them', +2); break;
      case 'gift_received':
      case 'debt_repaid_to_me': this.update('people_kind', 'Some people can be trusted', +1); break;
      case 'craft_success':
      case 'goal_progress': this.update('effort_pays', 'Hard work pays off', +1); break;
      case 'craft_fail': this.update('effort_pays', 'Hard work pays off', -0.5); break;
      case 'good_gossip_heard': this.update('people_kind', 'Some people can be trusted', +0.5); break;
      case 'bad_gossip_heard': this.update('people_cruel', 'People can be cruel when it profits them', +0.5); break;
      case 'witnessed_death': this.update('world_danger', 'The world is dangerous', +1); break;
    }
  }

  toContext(n = 5) {
    return [...this.beliefs.values()]
      .filter(b => Math.abs(b.evidence) >= 1)
      .sort((a, b) => Math.abs(b.evidence) - Math.abs(a.evidence))
      .slice(0, n)
      .map(b => `"${b.statement}" (${b.strength})`);
  }
}

module.exports = BeliefNetwork;
