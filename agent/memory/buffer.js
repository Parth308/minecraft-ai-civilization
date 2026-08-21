const logger = require('../../shared/logger');

class EventBuffer {
  constructor(maxCapacity = 20, onBufferFull = null) {
    this.maxCapacity = maxCapacity;
    this.onBufferFull = onBufferFull;
    this.buffer = [];
  }

  addEvent(type, payload = {}) {
    const event = {
      type,
      payload,
      timestamp: new Date().toISOString()
    };

    this.buffer.push(event);
    logger.debug('EventBuffer', `Added event '${type}' (Buffer: ${this.buffer.length}/${this.maxCapacity})`);

    if (this.buffer.length >= this.maxCapacity) {
      logger.info('EventBuffer', `Buffer capacity (${this.maxCapacity}) reached. Triggering flush/compaction.`);
      const snapshot = [...this.buffer];
      this.buffer = [];
      if (this.onBufferFull) {
        this.onBufferFull(snapshot);
      }
    }
  }

  getSnapshot() {
    return [...this.buffer];
  }

  clear() {
    this.buffer = [];
  }
}

module.exports = EventBuffer;
