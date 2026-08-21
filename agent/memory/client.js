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

    const batch = [...this.pendingQueue];
    logger.debug('MemoryClient', `Attempting to flush ${batch.length} queued events to Memory Service for ${this.agentId}...`);

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

      const data = await response.json();
      // Successfully flushed -> remove flushed batch from pending queue
      this.pendingQueue.splice(0, batch.length);
      logger.info('MemoryClient', `Successfully flushed ${batch.length} memory events. Pending queue: ${this.pendingQueue.length}`);
      this.isDraining = false;
      return true;
    } catch (err) {
      logger.warn('MemoryClient', `Memory Service unavailable (${err.message}). Kept ${this.pendingQueue.length} events in local retry queue.`);
      this.isDraining = false;
      return false;
    }
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
