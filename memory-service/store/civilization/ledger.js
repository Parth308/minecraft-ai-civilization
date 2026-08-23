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
        sharedLessons: [],
        updatedAt: new Date().toISOString()
      };
      fs.writeFileSync(LEDGER_PATH, JSON.stringify(initial, null, 2), 'utf-8');
    }
  }

  getLedger() {
    this.ensureFileExists();
    try {
      const data = JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf-8'));
      if (!Array.isArray(data.sharedLessons)) data.sharedLessons = [];
      return data;
    } catch (err) {
      logger.error('CivLedger', 'Failed to read ledger file', err);
      return { currencies: [], settlements: [], factions: [], laws: [], sharedLessons: [] };
    }
  }

  saveLedger(data) {
    data.updatedAt = new Date().toISOString();
    fs.writeFileSync(LEDGER_PATH, JSON.stringify(data, null, 2), 'utf-8');
  }

  recordLesson(agentId, lesson, isPublic = true, context = {}, confidence = 0.8) {
    if (!lesson) return { saved: false, reason: 'Empty lesson' };
    const data = this.getLedger();
    if (!Array.isArray(data.sharedLessons)) data.sharedLessons = [];

    if (isPublic === true) {
      const entry = {
        agentId,
        lesson,
        context,
        confidence: typeof confidence === 'number' ? confidence : 0.8,
        sharedAt: new Date().toISOString()
      };
      data.sharedLessons.push(entry);
      this.saveLedger(data);
      logger.info('CivLedger', `[SHARED LESSON] ${agentId} publicly shared hard-won lesson: "${lesson}"`);
      detailedLogger.logCivilizationMilestone('lesson_shared', `Lesson shared publicly by ${agentId}`, { lesson, confidence });
      return { saved: true, sharedPublicly: true, lesson: entry };
    } else {
      logger.info('CivLedger', `[PRIVATE LESSON] ${agentId} opted to keep lesson private. Not saved to public ledger.`);
      return { saved: true, sharedPublicly: false, reason: 'Stored in private agent memory only' };
    }
  }

  getSharedLessons() {
    const data = this.getLedger();
    return data.sharedLessons || [];
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
