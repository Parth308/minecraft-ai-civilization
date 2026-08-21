const fs = require('fs');
const path = require('path');
const logger = require('../../../shared/logger');
const detailedLogger = require('../../../shared/detailedLogger');

const LEDGER_PATH = path.join(__dirname, 'ledger.json');

class CivilizationLedger {
  constructor() {
    this.ensureFileExists();
  }

  ensureFileExists() {
    const dir = path.dirname(LEDGER_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(LEDGER_PATH)) {
      const initial = {
        currencies: [],
        settlements: [],
        factions: [],
        laws: [],
        updatedAt: new Date().toISOString()
      };
      fs.writeFileSync(LEDGER_PATH, JSON.stringify(initial, null, 2), 'utf-8');
    }
  }

  getLedger() {
    this.ensureFileExists();
    try {
      return JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf-8'));
    } catch (err) {
      logger.error('CivLedger', 'Failed to read ledger file', err);
      return { currencies: [], settlements: [], factions: [], laws: [] };
    }
  }

  saveLedger(data) {
    data.updatedAt = new Date().toISOString();
    fs.writeFileSync(LEDGER_PATH, JSON.stringify(data, null, 2), 'utf-8');
  }

  recordCurrency(name, establishedBy, description) {
    const data = this.getLedger();
    const existing = data.currencies.find(c => c.name.toLowerCase() === name.toLowerCase());
    if (!existing) {
      data.currencies.push({ name, establishedBy, description, date: new Date().toISOString() });
      this.saveLedger(data);
      logger.info('CivLedger', `[EMERGENT CURRENCY] '${name}' registered by ${establishedBy}`);
      detailedLogger.logCivilizationMilestone('currency', `Currency '${name}' established by ${establishedBy}`, { description });
    }
  }

  recordSettlement(name, claimedBy, center, radius = 50) {
    const data = this.getLedger();
    const existing = data.settlements.find(s => s.name.toLowerCase() === name.toLowerCase());
    if (!existing) {
      data.settlements.push({ name, claimedBy, center, radius, date: new Date().toISOString() });
      this.saveLedger(data);
      logger.info('CivLedger', `[EMERGENT SETTLEMENT] '${name}' claimed by ${claimedBy}`);
      detailedLogger.logCivilizationMilestone('settlement', `Settlement '${name}' claimed by ${claimedBy}`, { center, radius });
    }
  }

  recordFaction(name, founder) {
    const data = this.getLedger();
    const existing = data.factions.find(f => f.name.toLowerCase() === name.toLowerCase());
    if (!existing) {
      data.factions.push({ name, founder, members: [founder], date: new Date().toISOString() });
      this.saveLedger(data);
      logger.info('CivLedger', `[EMERGENT FACTION] '${name}' founded by ${founder}`);
      detailedLogger.logCivilizationMilestone('faction', `Faction '${name}' founded by ${founder}`);
    }
  }
}

module.exports = CivilizationLedger;
