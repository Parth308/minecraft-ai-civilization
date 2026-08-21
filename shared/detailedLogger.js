const fs = require('fs');
const path = require('path');

const LOGS_BASE_DIR = path.resolve(__dirname, '..', 'logs');
const AGENTS_LOGS_DIR = path.join(LOGS_BASE_DIR, 'agents');
const WORLD_LOGS_DIR = path.join(LOGS_BASE_DIR, 'world');

class DetailedAuditLogger {
  constructor() {
    this.ensureDirectory(AGENTS_LOGS_DIR);
    this.ensureDirectory(WORLD_LOGS_DIR);
  }

  ensureDirectory(dirPath) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  getAgentDir(agentId) {
    const dir = path.join(AGENTS_LOGS_DIR, agentId || 'UnknownAgent');
    this.ensureDirectory(dir);
    return dir;
  }

  formatTimestamp() {
    return new Date().toISOString().replace('T', ' ').replace('Z', '');
  }

  formatEntry(category, action, details) {
    const ts = this.formatTimestamp();
    const payloadStr = details ? ` | ${typeof details === 'object' ? JSON.stringify(details) : details}` : '';
    return `[${ts}] [${category.toUpperCase()}] ${action}${payloadStr}\n`;
  }

  appendToFile(filePath, content) {
    try {
      fs.appendFileSync(filePath, content, 'utf-8');
    } catch (err) {
      console.error(`[DetailedLogger Error] Could not write to ${filePath}:`, err.message);
    }
  }

  // --- Per-Agent Specific Activity Logs ---

  logMovement(agentId, action, details = null) {
    const filePath = path.join(this.getAgentDir(agentId), 'movement.log');
    const entry = this.formatEntry('movement', action, details);
    this.appendToFile(filePath, entry);
    this.logUniversalWorldEvent(agentId, 'movement', action, details);
  }

  logCombat(agentId, action, details = null) {
    const filePath = path.join(this.getAgentDir(agentId), 'combat.log');
    const entry = this.formatEntry('combat', action, details);
    this.appendToFile(filePath, entry);
    this.logUniversalWorldEvent(agentId, 'combat', action, details);
  }

  logInventory(agentId, action, details = null) {
    const filePath = path.join(this.getAgentDir(agentId), 'inventory.log');
    const entry = this.formatEntry('inventory', action, details);
    this.appendToFile(filePath, entry);
    this.logUniversalWorldEvent(agentId, 'inventory', action, details);
  }

  logChat(agentId, action, details = null) {
    const filePath = path.join(this.getAgentDir(agentId), 'chat_and_social.log');
    const entry = this.formatEntry('chat', action, details);
    this.appendToFile(filePath, entry);
    this.logUniversalWorldEvent(agentId, 'social', action, details);
  }

  logCognition(agentId, action, details = null) {
    const filePath = path.join(this.getAgentDir(agentId), 'cognition_and_decisions.log');
    const entry = this.formatEntry('cognition', action, details);
    this.appendToFile(filePath, entry);
  }

  logSenses(agentId, action, details = null) {
    const filePath = path.join(this.getAgentDir(agentId), 'senses_and_environment.log');
    const entry = this.formatEntry('senses', action, details);
    this.appendToFile(filePath, entry);
  }

  // --- Universal World Logs ---

  logUniversalWorldEvent(agentId, category, action, details = null) {
    const filePath = path.join(WORLD_LOGS_DIR, 'global_timeline.log');
    const ts = this.formatTimestamp();
    const payloadStr = details ? ` | ${typeof details === 'object' ? JSON.stringify(details) : details}` : '';
    const entry = `[${ts}] [${category.toUpperCase()}] [${agentId}] ${action}${payloadStr}\n`;
    this.appendToFile(filePath, entry);
  }

  logCivilizationMilestone(category, title, details = null) {
    const filePath = path.join(WORLD_LOGS_DIR, 'civilization_events.log');
    const ts = this.formatTimestamp();
    const payloadStr = details ? ` | ${typeof details === 'object' ? JSON.stringify(details) : details}` : '';
    const entry = `[${ts}] [${category.toUpperCase()}] ${title}${payloadStr}\n`;
    this.appendToFile(filePath, entry);

    // Also copy to global timeline
    const globalPath = path.join(WORLD_LOGS_DIR, 'global_timeline.log');
    this.appendToFile(globalPath, `[${ts}] [CIVILIZATION] ${title}${payloadStr}\n`);
  }
}

const detailedLogger = new DetailedAuditLogger();
module.exports = detailedLogger;
