const logger = require('../../shared/logger');

class MemoryClient {
  constructor(agentId, memoryServiceUrl = process.env.MEMORY_SERVICE_URL || 'http://localhost:3002') {
    this.agentId = agentId;
    this.baseUrl = memoryServiceUrl;
    this.pendingQueue = [];
    this.isDraining = false;

    // Background auto-drain timer for queued memory events
    setInterval(() => this.drainQueue(), 15000);
  }

  async flushBuffer(eventsList) {
    if (!eventsList || eventsList.length === 0) return false;

    // Append to local pending queue
    this.pendingQueue.push(...eventsList);
    return this.drainQueue();
  }

  async drainQueue() {
    if (this.pendingQueue.length === 0 || this.isDraining) return true;
    this.isDraining = true;

    try {
      while (this.pendingQueue.length > 0) {
        const batch = this.pendingQueue.splice(0, 50);
        logger.debug('MemoryClient', `Attempting to flush batch of ${batch.length} queued events to Memory Service for ${this.agentId}... (Remaining: ${this.pendingQueue.length})`);

        try {
          const response = await fetch(`${this.baseUrl}/api/memory/compact`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              agentId: this.agentId,
              events: batch
            })
          });

          if (!response.ok) {
            throw new Error(`Memory Service HTTP ${response.status}: ${response.statusText}`);
          }

          logger.info('MemoryClient', `Successfully flushed ${batch.length} memory events. Pending queue: ${this.pendingQueue.length}`);
        } catch (err) {
          // Re-insert failed batch to front of queue
          this.pendingQueue.unshift(...batch);
          logger.warn('MemoryClient', `Memory Service unavailable (${err.message}). Kept ${this.pendingQueue.length} events in local retry queue.`);
          break; // Stop draining this cycle, retry next interval
        }
      }
    } finally {
      this.isDraining = false;
    }

    return this.pendingQueue.length === 0;
  }

  async queryMemories(query = '', section = '', limit = 5) {
    try {
      const url = new URL(`${this.baseUrl}/api/memory/query`);
      url.searchParams.append('agentId', this.agentId);
      if (query) url.searchParams.append('query', query);
      if (section) url.searchParams.append('section', section);
      if (limit) url.searchParams.append('limit', limit);

      const response = await fetch(url.toString());
      if (!response.ok) return [];

      const data = await response.json();
      return data.memories || [];
    } catch (err) {
      logger.debug('MemoryClient', `Memory query failed (Service offline): ${err.message}`);
      return [];
    }
  }
}

module.exports = MemoryClient;
