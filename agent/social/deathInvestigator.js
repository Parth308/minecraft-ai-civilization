const logger = require('../../shared/logger');

class DeathInvestigator {
  constructor(agentId, { brainClient, relationships, dialogueEngine, eventBuffer, chat, movement, senses }) {
    this.agentId = agentId;
    this.brainClient = brainClient;
    this.relationships = relationships;
    this.dialogueEngine = dialogueEngine;
    this.eventBuffer = eventBuffer;
    this.chat = chat;
    this.movement = movement;
    this.senses = senses;
    this._pendingInvestigation = null;
  }

  onWitnessedDeath({ victim, raw }) {
    if (victim === this.agentId) return;

    const rel = this.relationships?.get?.(victim);
    const affinity = rel?.affinity ?? 30;

    const nearbyPlayers = (this.senses.getNearbyPlayers?.(16) || []).map(p => p.username);
    const possibleWitnesses = nearbyPlayers.filter(n => n !== victim && n !== this.agentId);

    this._pendingInvestigation = {
      victim,
      timestamp: Date.now(),
      affinity,
      rawDeathMsg: raw,
      possibleWitnesses,
      investigated: false
    };

    logger.warn('DeathInvestigator', `[DEATH SCENE] ${this.agentId} witnessed ${victim} dying — witnesses nearby: ${possibleWitnesses.join(', ') || 'none'}`);

    this.eventBuffer.addEvent('deathWitnessed', {
      victim, affinity, witnesses: possibleWitnesses, raw
    });
  }

  getPendingInvestigation() {
    const inv = this._pendingInvestigation;
    if (!inv || inv.investigated) return null;
    if (Date.now() - inv.timestamp > 60000) {
      this._pendingInvestigation = null;
      return null;
    }
    return {
      victim: inv.victim,
      possibleWitnesses: inv.possibleWitnesses,
      rawDeathMsg: inv.rawDeathMsg,
      affinity: inv.affinity,
      age: Date.now() - inv.timestamp
    };
  }

  investigate(senses) {
    const inv = this._pendingInvestigation;
    if (!inv || inv.investigated) return null;
    if (Date.now() - inv.timestamp > 60000) {
      this._pendingInvestigation = null;
      return null;
    }

    inv.investigated = true;

    const currentWitnesses = (senses.getNearbyPlayers?.(16) || []).map(p => p.username);
    const suspects = currentWitnesses.filter(n => n !== inv.victim && n !== this.agentId);

    const wasMurder = inv.rawDeathMsg && /slain|killed|shot/.test(inv.rawDeathMsg);
    const suspectedMurderer = suspects.length === 1 ? suspects[0] : null;

    const findings = {
      victim: inv.victim,
      agentId: this.agentId,
      causeGuess: inv.rawDeathMsg || 'unknown',
      witnessesPresent: suspects,
      suspectedMurderer,
      wasMurder,
      timestamp: Date.now()
    };

    logger.info('DeathInvestigator', `[INVESTIGATION] ${this.agentId} concluded: victim=${inv.victim}, cause=${findings.causeGuess}, suspect=${suspectedMurderer || 'none'}`);

    this.eventBuffer.addEvent('deathInvestigation', findings);

    this._pendingInvestigation = null;
    return findings;
  }
}

module.exports = DeathInvestigator;
