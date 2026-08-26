const logger = require('../../shared/logger');

const CHUNK_SIZE = 16;

class ChunkMemory {
  constructor(agentId, { memoryServiceUrl }) {
    this.agentId = agentId;
    this.memoryServiceUrl = memoryServiceUrl || 'http://localhost:3002';
    this.explored = new Map();
    this.discoveries = [];
    this._loaded = false;
    this._loadPromise = this._load();
  }

  chunkKey(x, z) {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    return `${cx},${cz}`;
  }

  async _load() {
    try {
      const res = await fetch(`${this.memoryServiceUrl}/api/memory/section/${this.agentId}/chunks`);
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data.chunks === 'object') {
          for (const [k, v] of Object.entries(data.chunks)) {
            this.explored.set(k, v);
          }
          logger.info('ChunkMemory', `Loaded ${this.explored.size} explored chunks for ${this.agentId}`);
        }
      }
    } catch {
      logger.debug('ChunkMemory', `No existing chunk data for ${this.agentId}, starting fresh`);
    }
    this._loaded = true;
  }

  async recordPosition(x, y, z) {
    if (!this._loaded) await this._loadPromise;
    const key = this.chunkKey(x, z);
    const existing = this.explored.get(key);
    const now = Date.now();

    if (existing) {
      existing.visits = (existing.visits || 0) + 1;
      existing.lastVisit = now;
      if (y < (existing.minY ?? Infinity)) existing.minY = y;
      if (y > (existing.maxY ?? -Infinity)) existing.maxY = y;
    } else {
      this.explored.set(key, {
        x: Math.floor(x / CHUNK_SIZE) * CHUNK_SIZE,
        z: Math.floor(z / CHUNK_SIZE) * CHUNK_SIZE,
        visits: 1,
        firstVisit: now,
        lastVisit: now,
        minY: y,
        maxY: y,
        biome: null,
        resources: []
      });
    }
  }

  recordDiscovery(x, y, z, resourceType) {
    const key = this.chunkKey(x, z);
    const chunk = this.explored.get(key);
    if (chunk && !chunk.resources.includes(resourceType)) {
      chunk.resources.push(resourceType);
    }
    this.discoveries.push({ x, y, z, resource: resourceType, time: Date.now() });
    if (this.discoveries.length > 100) this.discoveries.splice(0, this.discoveries.length - 100);
  }

  findUnexploredDirection(currentX, currentZ, maxDist = 64) {
    if (!this._loaded) return null;

    const candidates = [];
    const step = 8;
    for (let dx = -maxDist; dx <= maxDist; dx += step) {
      for (let dz = -maxDist; dz <= maxDist; dz += step) {
        const tx = currentX + dx;
        const tz = currentZ + dz;
        const key = this.chunkKey(tx, tz);
        if (!this.explored.has(key)) {
          const dist = Math.sqrt(dx * dx + dz * dz);
          candidates.push({ x: tx, z: tz, dist });
        }
      }
    }

    if (candidates.length === 0) {
      return null;
    }

    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  getExploredCount() {
    return this.explored.size;
  }

  getRecentDiscoveries(limit = 10) {
    return this.discoveries.slice(-limit);
  }

  toContext() {
    return {
      exploredChunks: this.explored.size,
      recentDiscoveries: this.getRecentDiscoveries(5).map(d => `${d.resource} at ${d.x},${d.y},${d.z}`)
    };
  }

  async persist() {
    if (!this._loaded) await this._loadPromise;
    const obj = {};
    for (const [k, v] of this.explored) obj[k] = v;

    try {
      await fetch(`${this.memoryServiceUrl}/api/memory/section/${this.agentId}/chunks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chunks: obj })
      });
    } catch (err) {
      logger.debug('ChunkMemory', `Failed to persist chunk data: ${err.message}`);
    }
  }
}

module.exports = ChunkMemory;
