const logger = require('../../shared/logger');

class DeathInvestigator {
  constructor(agentId, { brainClient, relationships, dialogueEngine, eventBuffer, chat, movement, senses, gossip }) {
    this.agentId = agentId;
    this.brainClient = brainClient;
    this.relationships = relationships;
    this.dialogueEngine = dialogueEngine;
    this.eventBuffer = eventBuffer;
    this.chat = chat;
    this.movement = movement;
    this.senses = senses;
    this.gossip = gossip;
    this._pendingInvestigation = null;
    this._griefEntries = [];
  }

  onWitnessedDeath({ victim, raw }) {
    if (victim === this.agentId) return;

    const rel = this.relationships?.get?.(victim);
    const affinity = rel?.affinity ?? 30;

    const nearbyPlayers = (this.senses.getNearbyPlayers?.(16) || []).map(p => p.username);
    const possibleWitnesses = nearbyPlayers.filter(n => n !== victim && n !== this.agentId);

    // Detect PvP killer from death message
    let killerName = null;
    if (raw) {
      const killerMatch = raw.match(/(?:slain|shot|killed|blown up|finished off) by (\w+)/i);
      if (killerMatch) killerName = killerMatch[1];
    }

    this._pendingInvestigation = {
      victim,
      timestamp: Date.now(),
      affinity,
      rawDeathMsg: raw,
      possibleWitnesses,
      investigated: false,
      killerName
    };

    logger.warn('DeathInvestigator', `[DEATH SCENE] ${this.agentId} witnessed ${victim} dying — witnesses nearby: ${possibleWitnesses.join(', ') || 'none'}`);

    this.eventBuffer.addEvent('deathWitnessed', {
      victim, affinity, witnesses: possibleWitnesses, raw, killerName
    });

    // ── Vengeance Tracking ─────────────────────────────────────────────────
    // Close bonds forge grudges. The closer the victim, the deeper the wound.
    if (killerName && killerName !== this.agentId) {
      const emotionalWeight = affinity > 60 ? 1.0 : affinity > 40 ? 0.6 : 0.3;
      this._griefEntries.push({
        victim,
        killer: killerName,
        timestamp: Date.now(),
        emotionalWeight,
        affinity
      });

      // Cap grief memory at 10 entries — too many and the agent becomes paralyzed
      if (this._griefEntries.length > 10) this._griefEntries.shift();

      // Shift relationship with the killer based on bond to victim
      this.relationships.updateTrust(killerName, -Math.round(10 + emotionalWeight * 20));
      this.relationships.updateAffinity(killerName, -Math.round(5 + emotionalWeight * 15));

      logger.warn('DeathInvestigator', `[GRIEF] ${this.agentId} recorded grief entry: ${killerName} killed ${victim} (emotionalWeight: ${emotionalWeight.toFixed(2)})`);
      this.eventBuffer.addEvent('griefRecorded', {
        victim, killer: killerName, emotionalWeight, affinity
      });

      if (this.gossip) {
        this.gossip.addRumor({
          type: 'murder',
          target: killerName,
          victim,
          killer: killerName,
          source: 'observed'
        });
      }

      if (affinity > 60) {
        this.chat.say(`You'll pay for this, ${killerName}!`);
      } else if (affinity > 40) {
        this.chat.say(`That was ${victim}... ${killerName} will answer for this.`);
      }
    }
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
      killerName: inv.killerName,
      age: Date.now() - inv.timestamp
    };
  }

  getGriefEntries() {
    return [...this._griefEntries];
  }

  hasGriefAgainst(agentName) {
    return this._griefEntries.some(g => g.killer === agentName);
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
      killerName: inv.killerName,
      wasMurder,
      timestamp: Date.now()
    };

    logger.info('DeathInvestigator', `[INVESTIGATION] ${this.agentId} concluded: victim=${inv.victim}, cause=${findings.causeGuess}, suspect=${suspectedMurderer || 'none'}, killer=${inv.killerName || 'unknown'}`);

    this.eventBuffer.addEvent('deathInvestigation', findings);

    this._pendingInvestigation = null;
    return findings;
  }
}

module.exports = DeathInvestigator;
