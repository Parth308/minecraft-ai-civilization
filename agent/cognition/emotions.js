const logger = require('../../shared/logger');

// Simplified OCC appraisal engine (Ortony/Clore/Collins). Emotions are
// INTERNAL WEATHER — they tint confidence and tone but never dictate action.
// Five pairs, directed feelings toward specific agents, slow mood underneath.
const HALF_LIFE_MS = 8 * 60 * 1000;
const MOOD_HALF_LIFE_MS = 45 * 60 * 1000;

const EMOTIONS = ['joy', 'distress', 'hope', 'fear', 'pride', 'shame', 'gratitude', 'anger', 'love', 'hate'];
const DIRECTED = new Set(['anger', 'gratitude', 'love', 'hate']);

class EmotionalState {
  constructor(agentId) {
    this.agentId = agentId;
    this.emotions = Object.fromEntries(EMOTIONS.map(e => [e, 0]));
    this.directed = {}; // targetAgent -> { anger, gratitude, love, hate }
    this.mood = 0;      // -1..1, slow aggregate
    this.lastDecay = Date.now();
    this.griefUntil = 0; // grief episode window after witnessing loss
  }

  static instances = new Map();
  static forAgent(agentId) {
    if (!EmotionalState.instances.has(agentId)) {
      EmotionalState.instances.set(agentId, new EmotionalState(agentId));
    }
    return EmotionalState.instances.get(agentId);
  }

  _clampAll() {
    for (const e of EMOTIONS) this.emotions[e] = Math.max(0, Math.min(1, this.emotions[e]));
  }

  feel(name, amount) {
    if (!(name in this.emotions)) return;
    const before = this.emotions[name];
    this.emotions[name] = Math.max(0, Math.min(1, before + Number(amount)));
    if (Math.abs(this.emotions[name] - before) > 0.15) {
      logger.info('Emotions', `${this.agentId} feels ${name} ${before.toFixed(2)} -> ${this.emotions[name].toFixed(2)}`);
    }
  }

  feelToward(target, name, amount) {
    if (!DIRECTED.has(name)) return this.feel(name, amount);
    if (!target || target === this.agentId) return;
    if (!this.directed[target]) this.directed[target] = { anger: 0, gratitude: 0, love: 0, hate: 0 };
    this.directed[target][name] = Math.max(0, Math.min(1, (this.directed[target][name] || 0) + Number(amount)));
  }

  // Appraisal rules over the agent's existing event vocabulary. Personality
  // scales sensitivity — same event, different hearts.
  appraise(eventType, ctx = {}, traits = {}) {
    const sens = k => (traits[k] ?? 0.5);
    switch (eventType) {
      case 'death_self':
        this.feel('distress', 0.55 + sens('caution') * 0.2);
        this.feel('fear', 0.5 + sens('caution') * 0.25);
        this.feel('hope', -0.3);
        break;
      case 'near_death':
        this.feel('fear', 0.45 + sens('caution') * 0.25);
        this.feel('distress', 0.25);
        break;
      case 'witnessed_death':
        this.feel('distress', 0.30 + sens('sociability') * 0.2); // empathy scales grief
        if (ctx.affinity && ctx.affinity > 60) this.feel('distress', 0.25);
        this.griefUntil = Date.now() + 20 * 60 * 1000;
        if (ctx.causeAgent) this.feelToward(ctx.causeAgent, 'anger', 0.4);
        break;
      case 'craft_success':
      case 'goal_progress':
        this.feel('joy', 0.12 + sens('ambition') * 0.08);
        this.feel('pride', 0.10 + sens('ambition') * 0.10);
        break;
      case 'craft_fail':
        this.feel('distress', 0.06);
        this.feel('pride', -0.05);
        break;
      case 'betrayal':
        this.feelToward(ctx.actor, 'anger', 0.35 + sens('loyalty') * 0.2);
        this.feelToward(ctx.actor, 'hate', 0.20);
        this.feel('distress', 0.20);
        break;
      case 'gift_received':
      case 'debt_repaid_to_me':
        this.feelToward(ctx.actor, 'gratitude', 0.30 + sens('loyalty') * 0.15);
        this.feelToward(ctx.actor, 'love', 0.12);
        this.feel('joy', 0.15);
        break;
      case 'i_helped_someone':
        this.feel('pride', 0.12);
        this.feel('joy', 0.10);
        break;
      case 'guilty_verdict':
        this.feel('shame', 0.45 + sens('openness') * 0.15);
        this.feel('distress', 0.25);
        break;
      case 'cleared_verdict':
        this.feel('fear', -0.3);
        this.feel('pride', 0.10);
        break;
      case 'accused':
        this.feel('fear', 0.20);
        this.feel('distress', 0.15);
        break;
      case 'good_gossip_heard':
        this.feelToward(ctx.about, 'love', 0.06);
        this.feel('joy', 0.05);
        break;
      case 'bad_gossip_heard':
        this.feelToward(ctx.about, 'hate', 0.10);
        break;
      case 'night_survived':
        this.feel('fear', -0.25);
        this.feel('joy', 0.08);
        break;
      case 'expedition_ahead':
        this.feel('hope', 0.15 + sens('curiosity') * 0.15);
        this.feel('fear', 0.08 + sens('caution') * 0.10);
        break;
    }
    this._clampAll();
    this._moodDrift();
  }

  _moodDrift() {
    const positive = this.emotions.joy + this.emotions.pride + this.emotions.gratitude + this.emotions.hope;
    const negative = this.emotions.distress + this.emotions.fear + this.emotions.shame + this.emotions.anger + this.emotions.hate;
    const target = Math.max(-1, Math.min(1, (positive - negative) / 3));
    this.mood = this.mood * 0.85 + target * 0.15;
  }

  decay() {
    const now = Date.now();
    const factor = Math.pow(0.5, (now - this.lastDecay) / HALF_LIFE_MS);
    for (const e of EMOTIONS) this.emotions[e] *= factor;
    this.mood *= Math.pow(0.5, (now - this.lastDecay) / MOOD_HALF_LIFE_MS);
    this.lastDecay = now;
    this._clampAll();
  }

  top(n = 3) {
    return EMOTIONS
      .map(e => ({ name: e, intensity: Number(this.emotions[e].toFixed(2)) }))
      .filter(e => e.intensity >= 0.15)
      .sort((a, b) => b.intensity - a.intensity)
      .slice(0, n);
  }

  directedContext() {
    const out = [];
    for (const [target, f] of Object.entries(this.directed)) {
      for (const name of DIRECTED) {
        if ((f[name] || 0) >= 0.25) out.push(`${name} toward ${target}: ${f[name].toFixed(2)}`);
      }
    }
    return out.slice(0, 6);
  }

  // Total undirected intensity of a directed emotion across all targets
  directedSum(name) {
    let sum = 0;
    for (const f of Object.values(this.directed)) sum += f[name] || 0;
    return Math.min(1, Number(sum.toFixed(2)));
  }

  inGrief() {
    return Date.now() < this.griefUntil;
  }

  toContext() {
    return {
      mood: Number(this.mood.toFixed(2)),
      emotions: this.top(),
      feelings: this.directedContext(),
      grieving: this.inGrief()
    };
  }
}

module.exports = EmotionalState;
