const logger = require('../../shared/logger');
const detailedLogger = require('../../shared/detailedLogger');

// Minecraft's server-side rate limit is roughly 1 chat message per second.
// Queuing ensures the bot won't get kicked for chat flooding.
const CHAT_INTERVAL_MS = 1200;

class ChatActuator {
  constructor(bot) {
    this.bot = bot;
    this._queue = [];
    this._sending = false;
  }

  get agentId() {
    return this.bot.username || 'UnknownAgent';
  }

  _enqueue(type, payload) {
    this._queue.push({ type, payload });
    if (!this._sending) this._drain();
  }

  _drain() {
    if (this._queue.length === 0) {
      this._sending = false;
      return;
    }
    this._sending = true;
    const { type, payload } = this._queue.shift();
    try {
      if (type === 'chat') {
        this.bot.chat(payload.message);
      } else if (type === 'whisper') {
        this.bot.whisper(payload.username, payload.message);
      }
    } catch (err) {
      logger.error('Actuation:Chat', `Chat send failed: ${err.message}`);
    }
    setTimeout(() => this._drain(), CHAT_INTERVAL_MS);
  }

  say(message) {
    if (!message) return;
    logger.info('Actuation:Chat', `[Public Chat] ${message}`);
    detailedLogger.logChat(this.agentId, `Public Chat: "${message}"`);
    this._enqueue('chat', { message: String(message).slice(0, 256) });
  }

  whisper(username, message) {
    if (!username || !message) return;
    logger.info('Actuation:Chat', `[Whisper to ${username}] ${message}`);
    detailedLogger.logChat(this.agentId, `Whisper to [${username}]: "${message}"`);
    this._enqueue('whisper', { username, message: String(message).slice(0, 256) });
  }
}

module.exports = ChatActuator;
