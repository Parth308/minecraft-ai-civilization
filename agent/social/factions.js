const logger = require('../../shared/logger');

class FactionAffiliationManager {
  constructor(agentId, persona) {
    this.agentId = agentId;
    this.persona = persona;
    this.joinedFactions = []; // Emergent factions the agent considers itself part of
    this.pacts = []; // Pacts and treaties (the agent chooses whether to honor, fake, or betray)
    this.secretBases = []; // Private hidden coordinate locations
    this.recognizedCurrencies = []; // Currencies the bot personally chooses to accept
    this.enemiesAndTargets = []; // Factions or agents marked for war/raids
    this.permittedTerritories = new Set(); // Agent IDs who granted building permission
    this.pendingTerritoryRequest = null;
  }

  requestTerritoryPermission(targetAgentId, purpose = 'structure', chatActuator = null) {
    this.pendingTerritoryRequest = { targetAgentId, purpose, timestamp: Date.now() };
    const msg = `Hey ${targetAgentId}, may I have permission to build a ${purpose} near your territory?`;
    if (chatActuator && typeof chatActuator.say === 'function') {
      chatActuator.say(msg);
    }
    logger.info('Factions', `[TERRITORY REQUEST] ${this.agentId} requested permission from ${targetAgentId} for '${purpose}'`);
    return msg;
  }

  handleTerritoryPermissionResponse(sender, isApproved) {
    if (this.pendingTerritoryRequest && this.pendingTerritoryRequest.targetAgentId.toLowerCase() === sender.toLowerCase()) {
      if (isApproved) {
        this.permittedTerritories.add(sender);
        logger.info('Factions', `[TERRITORY GRANTED] ${sender} granted building permission to ${this.agentId}`);
      } else {
        logger.info('Factions', `[TERRITORY DENIED] ${sender} denied building permission to ${this.agentId}`);
      }
      this.pendingTerritoryRequest = null;
      return isApproved;
    }
    return false;
  }

  hasPermissionFor(ownerAgentId) {
    return this.permittedTerritories.has(ownerAgentId);
  }

  recordSecretBase(name, coords, notes = '') {
    this.secretBases.push({ name, coords, notes, createdAt: new Date().toISOString() });
    logger.info('Factions', `[SECRET BASE] ${this.agentId} recorded private hidden base '${name}' at X:${coords.x} Y:${coords.y} Z:${coords.z}`);
  }

  declareWar(targetName, reason = '') {
    if (!this.enemiesAndTargets.includes(targetName)) {
      this.enemiesAndTargets.push(targetName);
      logger.warn('Factions', `[WAR DECLARATION] ${this.agentId} declared hostility/war against '${targetName}' (Reason: ${reason})`);
    }
  }

  declarePeace(targetName) {
    this.enemiesAndTargets = this.enemiesAndTargets.filter(t => t !== targetName);
    logger.info('Factions', `[PEACE] ${this.agentId} revoked war status with '${targetName}'`);
  }

  recordTreaty(proposer, treatyType, honorsStatus = true) {
    this.pacts.push({ with: proposer, type: treatyType, honors: honorsStatus, date: new Date().toISOString() });
    logger.info('Factions', `[TREATY LOGGED] ${this.agentId} logged treaty with ${proposer} (Honors: ${honorsStatus})`);
  }

  recognizeCurrency(currencyName) {
    if (!this.recognizedCurrencies.includes(currencyName)) {
      this.recognizedCurrencies.push(currencyName);
      logger.info('Factions', `[CURRENCY ADOPTED] ${this.agentId} now accepts currency '${currencyName}'`);
    }
  }

  getDiplomaticContext() {
    return {
      joinedFactions: this.joinedFactions,
      pacts: this.pacts,
      enemiesAndTargets: this.enemiesAndTargets,
      secretBaseCount: this.secretBases.length,
      recognizedCurrencies: this.recognizedCurrencies
    };
  }

  async restoreFromLedger(memoryServiceUrl = 'http://localhost:3002') {
    try {
      const res = await fetch(`${memoryServiceUrl}/api/ledger/factions?member=${encodeURIComponent(this.agentId)}`, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) return;
      const data = await res.json();
      this.joinedFactions = (data.factions || []).map(f => ({ id: f.id, name: f.name, members: f.members }));
      if (this.joinedFactions.length > 0) {
        logger.info('Factions', `[FACTION RESTORED] ${this.agentId} belongs to: ${this.joinedFactions.map(f => f.name).join(', ')}`);
      }
    } catch (err) {
      logger.debug('Factions', `Faction restore skipped: ${err.message}`);
    }
  }

  /**
   * Trade partners with proven cooperation graduate into a persisted faction:
   * both unaligned → found one together; I have room in mine → recruit them.
   * Returns a chat line announcing the outcome, or null when nothing changed.
   */
  async considerAllianceWith(peerAgentId, memoryServiceUrl = 'http://localhost:3002') {
    try {
      const short = id => id.replace(/^Agent_/, '');
      if (this.joinedFactions.length >= 2) return null;

      const res = await fetch(`${memoryServiceUrl}/api/ledger/factions`, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) return null;
      const data = await res.json();
      const factions = data.factions || [];
      const mine = this.joinedFactions.length > 0
        ? factions.find(f => f.id === this.joinedFactions[0].id || f.members.includes(this.agentId))
        : null;
      const peerFaction = factions.find(f => f.members.includes(peerAgentId));
      if (peerFaction && (!mine || mine.id === peerFaction.id)) return null;

      if (mine && !peerFaction && mine.members.length < 4) {
        const joinRes = await fetch(`${memoryServiceUrl}/api/ledger/factions/join`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ factionId: mine.id, agentId: peerAgentId })
        });
        const joinData = await joinRes.json();
        if (joinData.saved) {
          mine.members = joinData.faction.members;
          return `${peerAgentId} has proven themselves — they ride under our banner now!`;
        }
        return null;
      }

      if (!mine && !peerFaction) {
        const createRes = await fetch(`${memoryServiceUrl}/api/ledger/factions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: `Alliance of ${short(this.agentId)} & ${short(peerAgentId)}`,
            founderId: this.agentId,
            charter: 'Forged through fair trade and mutual survival.'
          })
        });
        const createData = await createRes.json();
        if (createData.saved) {
          this.joinedFactions.push({ id: createData.faction.id, name: createData.faction.name, members: createData.faction.members });
          await fetch(`${memoryServiceUrl}/api/ledger/factions/join`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ factionId: createData.faction.id, agentId: peerAgentId })
          });
          return `${short(peerAgentId)}, we've traded fair and fought for scraps side by side. I'm founding the "${createData.faction.name}" — you're in!`;
        }
      }
    } catch (err) {
      logger.debug('Factions', `Alliance consideration failed: ${err.message}`);
    }
    return null;
  }
}

module.exports = FactionAffiliationManager;
