require('dotenv').config();

module.exports = {
  port: process.env.BROKER_PORT || 3001,
  keys: {
    gemini: process.env.GEMINI_API_KEY,
    groq: process.env.GROQ_API_KEY,
    nvidia: process.env.NVIDIA_API_KEY,
    cerebras: process.env.CEREBRAS_API_KEY,
    openrouter: process.env.OPENROUTER_API_KEY,
    siliconflow: process.env.SILICONFLOW_API_KEY,
    zhipu: process.env.ZHIPU_API_KEY,
    mistral: process.env.MISTRAL_API_KEY,
    githubModels: process.env.GITHUB_MODELS_TOKEN,
    literouter: process.env.LITEROUTER_API_KEY,
    tokenreply: process.env.TOKENREPLY_API_KEY,
    pollinations: process.env.POLLINATIONS_API_KEY || 'unused',
    agnes: process.env.AGNES_API_KEY,
    llm7: process.env.LLM7_API_KEY || 'unused'
  },
  cacheTTLSeconds: parseInt(process.env.CACHE_TTL_SECONDS, 10) || 300
};
