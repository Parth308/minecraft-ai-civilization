const logger = require('../../shared/logger');
const detailedLogger = require('../../shared/detailedLogger');

class ChatActuator {
  constructor(bot) {
    this.bot = bot;
  }

  get agentId() {
    return this.bot.username || 'UnknownAgent';
  }

  say(message) {
    if (!message) return;
    logger.info('Actuation:Chat', `[Public Chat] ${message}`);
    detailedLogger.logChat(this.agentId, `Public Chat: "${message}"`);
    this.bot.chat(message);
  }

  whisper(username, message) {
    if (!username || !message) return;
    logger.info('Actuation:Chat', `[Whisper to ${username}] ${message}`);
    detailedLogger.logChat(this.agentId, `Whisper to [${username}]: "${message}"`);
    this.bot.whisper(username, message);
  }
}

module.exports = ChatActuator;
