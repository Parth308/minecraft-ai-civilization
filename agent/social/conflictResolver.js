const logger = require('../../shared/logger');

const VERDICT = { PENDING: 'pending', GUILTY: 'guilty', INNOCENT: 'innocent', EXILED: 'exiled' };

class ConflictResolver {
  constructor(agentId, societyClient, relationships, dialogueEngine, chat, gossip) {
    this.agentId = agentId;
    this.society = societyClient;
    this.relationships = relationships;
    this.dialogueEngine = dialogueEngine;
    this.chat = chat;
    this.gossip = gossip;
    this._activeTrial = null;
    this._accusationsAgainst = [];
  }

  get hasActiveTrial() {
    return this._activeTrial && this._activeTrial.verdict === VERDICT.PENDING;
  }

  accuse(target, reason, evidence = '') {
    if (this.hasActiveTrial) return null;
    if (target.toLowerCase() === this.agentId.toLowerCase()) return null;

    const accusation = {
      accuser: this.agentId,
      target,
      reason: String(reason).slice(0, 200),
      evidence: String(evidence).slice(0, 300),
      timestamp: Date.now(),
      supporters: [this.agentId],
      verdict: VERDICT.PENDING
    };

    this._activeTrial = accusation;
    this.chat.say(`${target}, I accuse you of ${reason}. Others, speak now if you have evidence.`);

    if (this.gossip) {
      this.gossip.addRumor({
        type: 'accusation',
        target,
        item: reason,
        source: 'observed'
      });
    }

    logger.warn('ConflictResolver', `[ACCUSATION] ${this.agentId} accused ${target}: ${reason}`);
    return accusation;
  }

  supportAccusation(accuserId, target) {
    if (!this._activeTrial) return false;
    if (this._activeTrial.target !== target) return false;
    if (this._activeTrial.accuser === this.agentId) return false;
    if (this._activeTrial.supporters.includes(this.agentId)) return false;

    this._activeTrial.supporters.push(this.agentId);
    this.chat.say(`I witnessed it too. ${target} did ${this._activeTrial.reason}.`);
    logger.info('ConflictResolver', `[SUPPORT] ${this.agentId} backs ${accuserId}'s accusation against ${target}`);
    return true;
  }

  defend(target, reason) {
    if (!this._activeTrial || this._activeTrial.target !== target) return null;

    const defense = {
      defender: this.agentId,
      target,
      reason: String(reason).slice(0, 200),
      timestamp: Date.now()
    };

    this.chat.say(`${target} is being framed. ${reason}`);
    logger.info('ConflictResolver', `[DEFENSE] ${this.agentId} defends ${target}: ${reason}`);
    return defense;
  }

  declareVerdict(target, verdict) {
    if (!this._activeTrial || this._activeTrial.target !== target) return null;

    const supporters = this._activeTrial.supporters.length;
    const accuserTrust = this.relationships?.get?.(this._activeTrial.accuser)?.trust || 50;
    const score = supporters * 15 + (accuserTrust - 50) * 0.3;

    if (score > 30) {
      this._activeTrial.verdict = VERDICT.GUILTY;
      this.chat.say(`${target} is found guilty. ${supporters} witnesses confirmed. Exile follows.`);

      if (this.gossip) {
        this.gossip.addRumor({
          type: 'conviction',
          target,
          item: this._activeTrial.reason,
          source: 'observed'
        });
      }

      logger.warn('ConflictResolver', `[VERDICT] ${target} GUILTY — ${supporters} supporters, trust score ${score.toFixed(1)}`);
      return { verdict: VERDICT.GUILTY, supporters: supporters, target };
    }

    this._activeTrial.verdict = VERDICT.INNOCENT;
    this.chat.say(`${target} is found innocent. Not enough evidence.`);
    logger.info('ConflictResolver', `[VERDICT] ${target} INNOCENT — ${supporters} supporters, trust score ${score.toFixed(1)}`);
    return { verdict: VERDICT.INNOCENT, supporters: supporters, target };
  }

  getPendingAccusation() {
    if (this.hasActiveTrial) return this._activeTrial;
    return null;
  }

  getVerdictHistory() {
    return this._activeTrial ? [this._activeTrial] : [];
  }
}

module.exports = ConflictResolver;
module.exports.VERDICT = VERDICT;
