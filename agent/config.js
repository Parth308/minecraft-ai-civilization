const dotenv = require('dotenv');
dotenv.config();

module.exports = {
  host: process.env.MC_HOST || 'localhost',
  port: parseInt(process.env.MC_PORT, 10) || 25565,
  username: process.env.MC_USERNAME || 'Agent_Alpha',
  version: process.env.MC_VERSION || '1.20.4',
  prefix: process.env.COMMAND_PREFIX || '!',
  personalitySeed: process.env.PERSONALITY_SEED || 'friendly-explorer',
  confidenceThreshold: parseFloat(process.env.CONFIDENCE_THRESHOLD) || 0.6,
  brokerUrl: process.env.BROKER_URL || 'http://brain-broker:3001',
  memoryServiceUrl: process.env.MEMORY_SERVICE_URL || 'http://memory-service:3002',
  statusPort: parseInt(process.env.STATUS_PORT, 10) || 3010
};

