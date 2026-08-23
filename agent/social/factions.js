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
}

module.exports = FactionAffiliationManager;
