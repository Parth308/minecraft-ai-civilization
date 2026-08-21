const logger = require('../../shared/logger');

class MemoryClient {
  constructor(agentId, memoryServiceUrl = 'http://localhost:3002') {
    this.agentId = agentId;
    this.url = memoryServiceUrl;
  }

  async flushBuffer(events) {
    try {
      logger.info('MemoryClient', `Flushing ${events.length} events to memory-service (${this.url}/api/memory/compact)...`);
      const response = await fetch(`${this.url}/api/memory/compact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: this.agentId, events })
      });

      if (!response.ok) {
        throw new Error(`Memory service error HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      logger.info('MemoryClient', `Flushed ${events.length} events successfully.`);
      return data;
    } catch (err) {
      logger.error('MemoryClient', `Failed to flush event buffer: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  async queryMemories(query = '', section = '', limit = 5) {
    try {
      const params = new URLSearchParams({ agentId: this.agentId });
      if (query) params.append('query', query);
      if (section) params.append('section', section);
      if (limit) params.append('limit', limit.toString());

      const response = await fetch(`${this.url}/api/memory/query?${params.toString()}`);
      if (!response.ok) return [];

      const data = await response.json();
      return data.memories || [];
    } catch (err) {
      logger.error('MemoryClient', `Failed to query memory: ${err.message}`);
      return [];
    }
  }
}

module.exports = MemoryClient;
