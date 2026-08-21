const dotenv = require('dotenv');
dotenv.config();

module.exports = {
  port: parseInt(process.env.BROKER_PORT, 10) || 3001,
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  cacheTTLSeconds: parseInt(process.env.CACHE_TTL_SECONDS, 10) || 300,
  keys: {
    gemini: process.env.GEMINI_API_KEY || '',
    groq: process.env.GROQ_API_KEY || '',
    cerebras: process.env.CEREBRAS_API_KEY || '',
    openrouter: process.env.OPENROUTER_API_KEY || ''
  }
};
