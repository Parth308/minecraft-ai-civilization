const logger = require('../../shared/logger');

// Fidelity decay: each retelling mutates names/items slightly → natural rumors form
const NAME_MUTATIONS = ['-', '~', '...someone', 'a guy', 'I forget who'];
const ITEM_MUTATIONS = ['something valuable', 'stuff', 'goods', 'treasure', 'items'];

class Gossip {
  constructor(agentId, bot, memoryClient) {
    this.agentId = agentId;
    this.bot = bot;
    this.memoryClient = memoryClient;
    this.buffer = [];
    this.lastSpreadTime = 0;
    this.lastDecayTime = 0;
    // Track what this agent has already relayed to avoid spam
    this._relayed = new Set(); // rumor hashes
  }

  // ── Feed events into gossip buffer ──────────────────────────────────────
  addRumor(rumor) {
    // Deduplicate: same target+type within 60s
    const key = `${rumor.type}:${rumor.target}:${rumor.item || ''}`;
    const recent = this.buffer.find(r =>
      `${r.type}:${r.target}:${r.item || ''}` === key &&
      Date.now() - r.heardAt < 60000
    );
    if (recent) return;

    this.buffer.push({
      ...rumor,
      heardAt: Date.now(),
      spreadCount: 0,
      fidelity: 1.0,        // starts perfect, decays with retelling
      source: rumor.source || 'observed'  // 'observed', 'relayed', 'heard'
    });
    if (this.buffer.length > 25) this.buffer.shift();

    logger.info('Gossip', `[NEW RUMOR] ${this.agentId} added: ${rumor.type} about ${rumor.target} (fidelity: 1.0)`);
  }

  // ── Receive gossip from another agent's chat message ────────────────────
  // Called when we detect an Agent_ saying something gossip-like
  receiveFromChat(sender, message) {
    const parsed = this._parseGossipMessage(message);
    if (!parsed) return false;

    // Fidelity drops when received through retelling
    const receivedFidelity = 0.7 + Math.random() * 0.2; // 0.7–0.9
    this.addRumor({
      ...parsed,
      source: 'relayed',
      sourceAgent: sender,
      fidelity: receivedFidelity
    });
    return true;
  }

  // ── Spread gossip to nearby players (human + agent) ─────────────────────
  async spread() {
    const now = Date.now();
    if (now - this.lastSpreadTime < 300000) return; // 5min cooldown
    if (this.buffer.length === 0) return;

    this.lastSpreadTime = now;

    // Pick a random rumor, weighted toward fresher ones
    const candidates = this.buffer.filter(r => r.fidelity > 0.3);
    if (candidates.length === 0) return;

    // Weight: newer + higher fidelity = more likely to spread
    const weights = candidates.map(r => {
      const age = (now - r.heardAt) / 300000; // age in 5min units
      return Math.max(0.1, r.fidelity * Math.exp(-age * 0.3));
    });
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let roll = Math.random() * totalWeight;
    let rumor = candidates[0];
    for (let i = 0; i < candidates.length; i++) {
      roll -= weights[i];
      if (roll <= 0) { rumor = candidates[i]; break; }
    }

    const nearbyPlayers = this.bot.players ? Object.values(this.bot.players) : [];
    const targets = nearbyPlayers.filter(p =>
      p.username && p.username !== this.agentId && p.entity
    );
    if (targets.length === 0) return;

    // Pick a random nearby target
    const target = targets[Math.floor(Math.random() * targets.length)];

    // Look at target before speaking
    try {
      await this.bot.lookAt(target.entity.position.offset(0, 1.6, 0), true);
    } catch (err) { /* ignore */ }

    // Build the message with fidelity-based mutations
    const msg = this._buildGossipMessage(rumor);
    await this.bot.chat(msg);

    rumor.spreadCount++;

    // Fidelity decays slightly each time we spread it
    rumor.fidelity = Math.max(0.3, rumor.fidelity - 0.08);

    logger.info('Gossip', `[SPREAD] ${this.agentId} told ${target.username}: "${msg}" (fidelity: ${rumor.fidelity.toFixed(2)})`);
  }

  // ── Build gossip message with fidelity-based mutations ──────────────────
  _buildGossipMessage(rumor) {
    let target = rumor.target || 'someone';
    let item = rumor.item || 'something';
    let fidelity = rumor.fidelity || 1.0;

    // Low fidelity → name/item get muddled
    if (fidelity < 0.6 && Math.random() < 0.4) {
      target = NAME_MUTATIONS[Math.floor(Math.random() * NAME_MUTATIONS.length)];
    }
    if (fidelity < 0.5 && Math.random() < 0.4) {
      item = ITEM_MUTATIONS[Math.floor(Math.random() * ITEM_MUTATIONS.length)];
    }

    const templates = this._getTemplates(rumor.type);
    const template = templates[Math.floor(Math.random() * templates.length)];

    return template
      .replace(/{target}/g, target)
      .replace(/{item}/g, item)
      .replace(/{killer}/g, rumor.killer || 'someone')
      .replace(/{victim}/g, rumor.victim || target)
      .replace(/{player}/g, rumor.player || target)
      .replace(/{amount}/g, rumor.amount || 'some')
      .replace(/{faction}/g, rumor.faction || 'a group');
  }

  _getTemplates(type) {
    switch (type) {
      case 'theft':
        return [
          `I heard {target} stole {item} from someone!`,
          `Did you know {target} took {item}? Shady stuff.`,
          `Watch out for {target} — they've been stealing {item}.`,
          `{target} swiped {item}. Can you believe that?`,
          `Rumor is {target} grabbed {item} from a chest nearby.`
        ];
      case 'murder':
        return [
          `Did you hear? {killer} killed {victim}!`,
          `{victim} was taken out by {killer}. Rough.`,
          `I heard {killer} slew {victim}. That's brutal.`,
          `Word is {killer} finished off {victim}.`,
          `{victim} died and {killer} was involved. Just saying.`
        ];
      case 'trade':
        return [
          `{player} just made a deal — traded {item}.`,
          `I saw {player} trading {item}. Interesting.`,
          `{player} swapped goods with someone. {item} involved.`
        ];
      case 'alliance':
        return [
          `{player} joined up with {faction}. Things are shifting.`,
          `Heard {player} is rolling with {faction} now.`,
          `{player} and {faction} — that's a new alliance.`
        ];
      case 'discovery':
        return [
          `{player} found {item}! Keep it quiet.`,
          `Word is {player} discovered {item} nearby.`,
          `{player} struck {item}. Lucky find.`
        ];
      default:
        return [
          `I heard something about {target}...`,
          `Rumor has it {target} did something with {item}.`,
          `Not sure if it's true, but {target} and {item} — keep an eye out.`
        ];
    }
  }

  // ── Parse incoming agent chat into a gossip rumor ───────────────────────
  _parseGossipMessage(message) {
    if (!message || typeof message !== 'string') return null;

    // Theft patterns
    const theftMatch = message.match(/(?:stole|took|swiped|grabbed|snagged)\s+(?:my\s+)?(.+?)(?:\s+from\s+(.+))?[!.\s]*$/i);
    if (theftMatch) {
      // Try to find who they're talking about
      const targetMatch = message.match(/(\w+)\s+(?:stole|took|swiped)/i);
      return {
        type: 'theft',
        target: targetMatch ? targetMatch[1] : 'someone',
        item: theftMatch[1] || 'something'
      };
    }

    // Murder patterns
    const murderMatch = message.match(/(?:killed|slain|slew|finished off|murdered)\s+(?:by\s+)?(\w+)/i);
    if (murderMatch) {
      return {
        type: 'murder',
        victim: murderMatch[1],
        killer: 'someone'
      };
    }

    // Trade patterns
    const tradeMatch = message.match(/(?:traded|swapped|dealt)\s+(.+)/i);
    if (tradeMatch) {
      return {
        type: 'trade',
        item: tradeMatch[1]
      };
    }

    // Alliance patterns
    const allianceMatch = message.match(/(?:joined|allied|rolling with|teamed up)\s+(.+)/i);
    if (allianceMatch) {
      return {
        type: 'alliance',
        faction: allianceMatch[1]
      };
    }

    // Discovery patterns
    const discoveryMatch = message.match(/(?:found|discovered|struck|mined)\s+(.+)/i);
    if (discoveryMatch) {
      return {
        type: 'discovery',
        item: discoveryMatch[1]
      };
    }

    return null;
  }

  // ── Decay old rumors and remove stale ones ──────────────────────────────
  decay() {
    const now = Date.now();
    if (now - this.lastDecayTime < 120000) return; // every 2 min
    this.lastDecayTime = now;

    const before = this.buffer.length;

    this.buffer = this.buffer.filter(rumor => {
      const ageMs = now - rumor.heardAt;
      // After 15 min, fidelity decays faster
      if (ageMs > 900000) {
        rumor.fidelity *= 0.85;
      }
      // After 30 min, rumor is forgotten
      if (ageMs > 1800000) return false;
      // Also remove very low fidelity rumors
      if (rumor.fidelity < 0.2) return false;
      return true;
    });

    if (this.buffer.length !== before) {
      logger.info('Gossip', `[DECAY] ${this.agentId} buffer: ${before} → ${this.buffer.length}`);
    }
  }

  // ── Report to authorities (keep existing behavior) ──────────────────────
  async reportToAuthorities(rumor) {
    const nearbyPlayers = this.bot.players ? Object.values(this.bot.players) : [];
    const humans = nearbyPlayers.filter(p =>
      p.username && !p.username.startsWith('Agent_')
    );
    if (humans.length === 0) return;

    const enforcer = humans[0];
    if (enforcer.entity) {
      try {
        await this.bot.lookAt(enforcer.entity.position.offset(0, 1.6, 0), true);
      } catch (err) {}
    }

    const msg = `Officer! ${rumor.target || 'Someone'} stole ${rumor.item || 'something'}!`;
    await this.bot.chat(msg);
  }

  // ── Utility ─────────────────────────────────────────────────────────────
  getBuffer() { return [...this.buffer]; }
  clearBuffer() { this.buffer = []; }
  getRumorCount() { return this.buffer.length; }
  getAvgFidelity() {
    if (this.buffer.length === 0) return 0;
    return this.buffer.reduce((sum, r) => sum + r.fidelity, 0) / this.buffer.length;
  }
}

module.exports = Gossip;
