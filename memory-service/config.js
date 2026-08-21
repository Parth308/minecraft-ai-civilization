const path = require('path');
const dotenv = require('dotenv');
dotenv.config();

module.exports = {
  port: parseInt(process.env.MEMORY_PORT, 10) || 3002,
  baseStorePath: path.resolve(__dirname, 'store', 'agents'),
  brokerUrl: process.env.BROKER_URL || 'http://localhost:3001',
  schedulerIntervalMs: parseInt(process.env.MEMORY_SCHEDULER_INTERVAL_MS, 10) || 300000, // 5 minutes
  caps: {
    relationships: { maxEntries: 30, maxBytes: 3072 },
    events: { maxEntries: 25, maxBytes: 3072 },
    skills: { maxEntries: 20, maxBytes: 2560 },
    recent: { maxEntries: 10, maxBytes: 1024 }
  }
};
