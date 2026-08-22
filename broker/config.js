require('dotenv').config();

module.exports = {
  port: process.env.BROKER_PORT || 3001,
  keys: {
    gemini: process.env.GEMINI_API_KEY,
    groq: process.env.GROQ_API_KEY,
    nvidia: process.env.NVIDIA_API_KEY,
    cerebras: process.env.CEREBRAS_API_KEY,
    openrouter: process.env.OPENROUTER_API_KEY,
    agnes: process.env.AGNES_API_KEY,
    llm7: process.env.LLM7_API_KEY || 'unused'
  },
  cacheTTLSeconds: parseInt(process.env.CACHE_TTL_SECONDS, 10) || 300
};
