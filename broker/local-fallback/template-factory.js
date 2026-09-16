'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../../shared/logger');

const SMART_TEMPLATES_FILE = path.join(__dirname, 'smart-templates.json');
const BATCH_SIZE = 3;
const COOLDOWN_MS = 5 * 60 * 1000;
const MAX_SMART_TEMPLATES = 150;

const OLLAMA_URL = process.env.OLLAMA_SLM_URL || 'http://ollama-embeddings:11434';
const MODEL = process.env.OLLAMA_SLM_MODEL || 'qwen2.5:0.5b';
const TIMEOUT_MS = 20000;

let lastRun = 0;
let running = false;
let recentChatHistory = [];
const HISTORY_WINDOW = 20;

function _loadSmartTemplates() {
  try {
    if (fs.existsSync(SMART_TEMPLATES_FILE)) {
      const raw = JSON.parse(fs.readFileSync(SMART_TEMPLATES_FILE, 'utf8'));
      return Array.isArray(raw) ? raw : [];
    }
  } catch {}
  return [];
}

let smartTemplates = _loadSmartTemplates();

function _saveSmartTemplates() {
  try {
    if (smartTemplates.length > MAX_SMART_TEMPLATES) {
      smartTemplates = smartTemplates.slice(-MAX_SMART_TEMPLATES);
    }
    fs.writeFileSync(SMART_TEMPLATES_FILE, JSON.stringify(smartTemplates, null, 2));
  } catch (err) {
    logger.debug('TemplateFactory', `Save failed: ${err.message}`);
  }
}

function recordChat(message, speaker, intent) {
  recentChatHistory.push({ message, speaker, intent, ts: Date.now() });
  if (recentChatHistory.length > HISTORY_WINDOW) recentChatHistory.shift();
}

function _buildBatchPrompt() {
  const recent = recentChatHistory.slice(-10);
  const recentLines = recent.map(r => `${r.speaker}: ${r.message}`).join('\n');

  const intents = ['greeting', 'trade_offer', 'agreement', 'status', 'question', 'emote'];
  const intent = intents[Math.floor(Math.random() * intents.length)];

  const scenarios = {
    greeting: 'a player just logged in or approached',
    trade_offer: 'someone is offering to trade items',
    agreement: 'planning to do something together',
    status: 'checking in on how someone is doing',
    question: 'asking about location, inventory, or plans',
    emote: 'reacting to something funny or surprising',
  };

  const emotions = [
    'happy and excited', 'neutral and focused', 'cautious but willing',
    'tired but pushing through', 'eager to help', 'skeptical but curious',
  ];
  const emotion = emotions[Math.floor(Math.random() * emotions.length)];

  const inventories = [
    'has iron tools and some cobblestone',
    'just found diamonds deep underground',
    'has lots of wood and food',
    'low on supplies, needs help',
    'well-equipped with iron gear',
  ];
  const inventory = inventories[Math.floor(Math.random() * inventories.length)];

  return {
    intent,
    prompt: `Generate 3 casual Minecraft chat responses for when ${scenarios[intent]}. The speaker is ${emotion} and ${inventory}.

Recent chat context:
${recentLines || '(no recent chat)'}

Rules:
- Be casual, like real Minecraft players (use lol, tbh, np, rn, u, etc)
- Reference specific items when possible (cobblestone, iron, deepslate, bread, etc)
- Keep responses 5-15 words
- Each response must be different in tone/wording
- NO generic filler like "ok" or "hm"
- Return ONLY the 3 responses, one per line, no numbering`,
  };
}

async function _queryOllamaRaw(prompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const t0 = Date.now();
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        prompt,
        stream: false,
        options: { num_predict: 120, temperature: 0.8, top_p: 0.9 },
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      logger.warn('TemplateFactory', `Ollama HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    const text = (data.response || '').trim();
    logger.warn('TemplateFactory', `Ollama responded in ${Date.now() - t0}ms, length=${text.length}: ${text.slice(0, 150)}`);
    return text;
  } catch (err) {
    clearTimeout(timer);
    logger.warn('TemplateFactory', `Ollama error: ${err.name}: ${err.message}`);
    return null;
  }
}

async function generateBatch() {
  if (running) return;
  const now = Date.now();
  if (now - lastRun < COOLDOWN_MS) return;

  running = true;
  lastRun = now;
  let created = 0;

  try {
    for (let i = 0; i < BATCH_SIZE; i++) {
      const { intent, prompt } = _buildBatchPrompt();

      const t0 = Date.now();
      const raw = await _queryOllamaRaw(prompt);
      const elapsed = Date.now() - t0;

      if (raw) {
        const lines = raw.split('\n')
          .map(l => l.replace(/^\d+[\.\)]\s*/, '').trim())
          .filter(l => l.length > 3 && l.length < 100);

        for (const line of lines) {
          smartTemplates.push({ intent, response: line, created: Date.now(), hits: 0 });
          created++;
        }
        if (lines.length === 0) {
          logger.warn('TemplateFactory', `Batch ${i + 1}: raw response unparsable: ${raw.slice(0, 120)}`);
        }
      } else {
        logger.warn('TemplateFactory', `Batch ${i + 1}: Ollama returned null`);
      }

      if (i < BATCH_SIZE - 1) {
        const delay = Math.max(elapsed + 2000, 3000);
        await new Promise(r => setTimeout(r, delay));
      }
    }

    _saveSmartTemplates();
    logger.info('TemplateFactory', `Generated ${created} smart templates from ${BATCH_SIZE} batches, pool total: ${smartTemplates.length}`);
  } catch (err) {
    logger.warn('TemplateFactory', `Batch failed: ${err.message}`);
  } finally {
    running = false;
  }
}

function pickSmartTemplate(intent) {
  const candidates = smartTemplates.filter(t => t.intent === intent);
  if (candidates.length === 0) return null;

  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  pick.hits = (pick.hits || 0) + 1;
  return pick.response;
}

function getSmartTemplateStats() {
  return {
    count: smartTemplates.length,
    lastRun,
    running,
    byIntent: smartTemplates.reduce((acc, t) => {
      acc[t.intent] = (acc[t.intent] || 0) + 1;
      return acc;
    }, {}),
  };
}

function startFactory() {
  logger.info('TemplateFactory', `Starting background factory (interval: ${COOLDOWN_MS / 1000}s)`);
  setInterval(generateBatch, COOLDOWN_MS);
}

module.exports = {
  recordChat,
  generateBatch,
  pickSmartTemplate,
  getSmartTemplateStats,
  startFactory,
};
