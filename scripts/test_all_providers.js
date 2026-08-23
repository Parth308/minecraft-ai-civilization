const fs = require('fs');
const dotenv = require('dotenv');

if (fs.existsSync('./.env')) {
  const envConfig = dotenv.parse(fs.readFileSync('./.env'));
  for (const k in envConfig) process.env[k] = envConfig[k];
}

const queryGemini = require('../broker/providers/gemini');
const queryGroq = require('../broker/providers/groq');
const queryNvidia = require('../broker/providers/nvidia');
const queryCerebras = require('../broker/providers/cerebras');
const queryOpenRouter = require('../broker/providers/openrouter');
const queryAgnes = require('../broker/providers/agnes');
const queryLLM7 = require('../broker/providers/llm7');

async function testAll() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('         TESTING ALL 7 LLM PROVIDERS (LIVE API CALLS)         ');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const prompt = 'Respond with JSON only: {"action":"EXPLORE","reason":"Autonomous scouting test"}';

  const tests = [
    { name: 'Gemini', fn: () => queryGemini(process.env.GEMINI_API_KEY, prompt) },
    { name: 'Groq', fn: () => queryGroq(process.env.GROQ_API_KEY, prompt) },
    { name: 'Nvidia', fn: () => queryNvidia(process.env.NVIDIA_API_KEY, prompt) },
    { name: 'Cerebras', fn: () => queryCerebras(process.env.CEREBRAS_API_KEY, prompt) },
    { name: 'OpenRouter', fn: () => queryOpenRouter(process.env.OPENROUTER_API_KEY, prompt) },
    { name: 'Agnes', fn: () => queryAgnes(process.env.AGNES_API_KEY, prompt) },
    { name: 'LLM7', fn: () => queryLLM7(process.env.LLM7_API_KEY, prompt) }
  ];

  for (const t of tests) {
    const t0 = Date.now();
    try {
      const res = await t.fn();
      const latency = Date.now() - t0;
      const model = (res && res.model) ? res.model : 'unknown';
      console.log(`✅ [${t.name.padEnd(11)}] SUCCESS in ${latency}ms | Model: ${model}`);
    } catch (err) {
      const latency = Date.now() - t0;
      console.log(`❌ [${t.name.padEnd(11)}] FAILED  in ${latency}ms | Error: ${err.message}`);
    }
  }
  console.log('\n═══════════════════════════════════════════════════════════════');
}

testAll();
