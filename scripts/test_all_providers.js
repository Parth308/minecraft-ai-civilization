const fs = require('fs');
const dotenv = require('dotenv');

if (fs.existsSync('./.env')) {
  const envConfig = dotenv.parse(fs.readFileSync('./.env'));
  for (const k in envConfig) process.env[k] = envConfig[k];
}

const queryGemini = require('../broker/providers/gemini');
const queryGroq = require('../broker/providers/groq');
const queryNvidia = require('../broker/providers/nvidia');
const queryOpenRouter = require('../broker/providers/openrouter');
const querySiliconFlow = require('../broker/providers/siliconflow');
const queryZhipu = require('../broker/providers/zhipu');
const queryMistral = require('../broker/providers/mistral');
const queryTokenReply = require('../broker/providers/tokenreply');
const queryAgnes = require('../broker/providers/agnes');
const queryLLM7 = require('../broker/providers/llm7');
const queryCloudflare = require('../broker/providers/cloudflare');
const queryHuggingFace = require('../broker/providers/huggingface');
const queryCohere = require('../broker/providers/cohere');
const queryQwen = require('../broker/providers/qwen');

async function testAll() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('         TESTING ALL LLM PROVIDERS (LIVE API CALLS)           ');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const prompt = 'Respond with JSON only: {"action":"EXPLORE","reason":"Autonomous scouting test"}';

  const tests = [
    { name: 'Cloudflare', key: process.env.CLOUDFLARE_API_TOKEN, fn: () => queryCloudflare(process.env.CLOUDFLARE_API_TOKEN, prompt) },
    { name: 'Mistral',    key: process.env.MISTRAL_API_KEY,      fn: () => queryMistral(process.env.MISTRAL_API_KEY, prompt) },
    { name: 'Nvidia',     key: process.env.NVIDIA_API_KEY,       fn: () => queryNvidia(process.env.NVIDIA_API_KEY, prompt) },
    { name: 'Cohere',     key: process.env.COHERE_API_KEY,       fn: () => queryCohere(process.env.COHERE_API_KEY, prompt) },
    { name: 'Qwen',       key: process.env.DASHSCOPE_API_KEY,    fn: () => queryQwen(process.env.DASHSCOPE_API_KEY, prompt) },
    { name: 'Agnes',      key: process.env.AGNES_API_KEY,        fn: () => queryAgnes(process.env.AGNES_API_KEY, prompt) },
    { name: 'HuggingFace',key: process.env.HF_TOKEN,             fn: () => queryHuggingFace(process.env.HF_TOKEN, prompt) },
    { name: 'Gemini',     key: process.env.GEMINI_API_KEY,       fn: () => queryGemini(process.env.GEMINI_API_KEY, prompt) },
    { name: 'Groq',       key: process.env.GROQ_API_KEY,         fn: () => queryGroq(process.env.GROQ_API_KEY, prompt) },
    { name: 'OpenRouter', key: process.env.OPENROUTER_API_KEY,   fn: () => queryOpenRouter(process.env.OPENROUTER_API_KEY, prompt) },
    { name: 'TokenReply', key: process.env.TOKENREPLY_API_KEY,   fn: () => queryTokenReply(process.env.TOKENREPLY_API_KEY, prompt) },
    { name: 'SiliconFlow',key: process.env.SILICONFLOW_API_KEY,  fn: () => querySiliconFlow(process.env.SILICONFLOW_API_KEY, prompt) },
    { name: 'Zhipu',      key: process.env.ZHIPU_API_KEY,        fn: () => queryZhipu(process.env.ZHIPU_API_KEY, prompt) },
    { name: 'LLM7',       key: process.env.LLM7_API_KEY || 'ok', fn: () => queryLLM7(process.env.LLM7_API_KEY, prompt) }
  ];

  for (const t of tests) {
    if (!t.key) {
      console.log(`⚠️  [${t.name.padEnd(12)}] SKIPPED (No API key in .env)`);
      continue;
    }
    const t0 = Date.now();
    try {
      const res = await t.fn();
      const latency = Date.now() - t0;
      const model = (res && res.model) ? res.model : 'unknown';
      console.log(`✅ [${t.name.padEnd(12)}] SUCCESS in ${latency}ms | Model: ${model}`);
    } catch (err) {
      const latency = Date.now() - t0;
      console.log(`❌ [${t.name.padEnd(12)}] FAILED  in ${latency}ms | Error: ${err.message}`);
    }
  }
  console.log('\n═══════════════════════════════════════════════════════════════');
}

testAll();
