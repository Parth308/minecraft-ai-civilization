require('dotenv').config();

module.exports = {
  port: process.env.BROKER_PORT || 3001,
  keys: {
    gemini: process.env.GEMINI_API_KEY,
    groq: process.env.GROQ_API_KEY,
    nvidia: process.env.NVIDIA_API_KEY,
    openrouter: process.env.OPENROUTER_API_KEY,
    siliconflow: process.env.SILICONFLOW_API_KEY,
    zhipu: process.env.ZHIPU_API_KEY,
    mistral: process.env.MISTRAL_API_KEY,
    tokenreply: process.env.TOKENREPLY_API_KEY,
    agnes: process.env.AGNES_API_KEY,
    llm7: process.env.LLM7_API_KEY || 'unused',
    cloudflare: process.env.CLOUDFLARE_API_TOKEN,
    huggingface: process.env.HF_TOKEN,
    cohere: process.env.COHERE_API_KEY,
    qwen: process.env.DASHSCOPE_API_KEY
  },
  cacheTTLSeconds: parseInt(process.env.CACHE_TTL_SECONDS, 10) || 300
};
