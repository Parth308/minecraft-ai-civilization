const logger = require('../../shared/logger');

class ChatActuator {
  constructor(bot) {
    this.bot = bot;
  }

  say(message) {
    logger.info('Actuation:Chat', `Saying: ${message}`);
    this.bot.chat(message);
  }

  whisper(username, message) {
    logger.info('Actuation:Chat', `Whispering to ${username}: ${message}`);
    this.bot.whisper(username, message);
  }
}

module.exports = ChatActuator;
