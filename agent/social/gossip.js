class Gossip {
  constructor(agentId, bot, memoryClient) {
    this.agentId = agentId;
    this.bot = bot;
    this.memoryClient = memoryClient;
    this.buffer = [];
    this.lastSpreadTime = 0;
  }

  addRumor(rumor) {
    this.buffer.push({
      ...rumor,
      heardAt: Date.now(),
      spreadCount: 0
    });
    if (this.buffer.length > 20) this.buffer.shift();
  }

  async spread() {
    const now = Date.now();
    if (now - this.lastSpreadTime < 300000) return;
    if (this.buffer.length === 0) return;

    this.lastSpreadTime = now;
    const rumor = this.buffer[Math.floor(Math.random() * this.buffer.length)];
    if (!rumor) return;

    const nearbyPlayers = this.bot.players ? Object.values(this.bot.players) : [];
    const humanPlayers = nearbyPlayers.filter(p => p.username && !p.username.startsWith('Agent_'));
    if (humanPlayers.length === 0) return;

    const human = humanPlayers[0];
    if (human.entity) {
      try {
        await this.bot.lookAt(human.entity.position.offset(0, 1.6, 0), true);
      } catch (err) {}
    }

    const targetName = rumor.target || 'someone';
    const item = rumor.item || 'something';
    const messages = [
      `Hey, I heard ${targetName} stole ${item} from someone!`,
      `Did you know ${targetName} took ${item}? I saw it happen.`,
      `Watch out for ${targetName} - they stole ${item}!`,
      `I can't believe ${targetName} stole ${item} from someone nearby.`,
      `Just saw ${targetName} steal ${item}. Can you believe that?`
    ];

    const msg = messages[Math.floor(Math.random() * messages.length)];
    await this.bot.chat(msg);
    rumor.spreadCount++;
  }

  async reportToAuthorities(rumor) {
    const nearbyPlayers = this.bot.players ? Object.values(this.bot.players) : [];
    const lawEnforcers = nearbyPlayers.filter(p =>
      p.username && !p.username.startsWith('Agent_')
    );
    if (lawEnforcers.length === 0) return;

    const enforcer = lawEnforcers[0];
    if (enforcer.entity) {
      try {
        await this.bot.lookAt(enforcer.entity.position.offset(0, 1.6, 0), true);
      } catch (err) {}
    }

    const msg = `Officer! ${rumor.target || 'Someone'} stole ${rumor.item || 'something'}!`;
    await this.bot.chat(msg);
  }

  getBuffer() { return [...this.buffer]; }
  clearBuffer() { this.buffer = []; }
}

module.exports = Gossip;
