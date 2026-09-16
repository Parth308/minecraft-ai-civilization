'use strict';

const { tryTemplate, classifyIntent, tryLearnedTemplate, learnTemplate, getLearnedStats, validateSLMResponse, recordHeard } = require('./templates');
const { querySLM } = require('./ollamaClient');
const logger = require('../../shared/logger');

const SIMPLE_INTENTS = new Set([
  'greeting', 'farewell', 'yes', 'no', 'thanks', 'emote',
  'compliment', 'agreement', 'refusal', 'status',
]);

const SLM_TIMEOUT_MS = 3000;

const stats = {
  attempts: 0,
  templateHits: 0,
  learnedHits: 0,
  slmHits: 0,
  slmErrors: 0,
  slmTimeouts: 0,
  totalSlmLatencyMs: 0,
};

let slmFatigue = 0;
const SLM_FATIGUE_CEIL = 3;
let slmFatigueRecoveryAt = 0;

function _getFatigueCooldownMs() {
  if (slmFatigue < SLM_FATIGUE_CEIL) return 0;
  const rounds = Math.floor(slmFatigue / SLM_FATIGUE_CEIL);
  const base = 3 * 60 * 1000;
  return Math.min(base * Math.pow(2, rounds - 1), 60 * 60 * 1000);
}

function _deriveEmotionDelta(intent, trust, mood) {
  const delta = { anger: 0, happiness: 0, fatigue: 0 };

  switch (intent) {
    case 'greeting':
      delta.happiness = trust >= 60 ? 2 : trust >= 30 ? 0 : -1;
      break;
    case 'farewell':
      delta.happiness = trust >= 60 ? 0 : -1;
      break;
    case 'compliment':
      delta.happiness = 3;
      break;
    case 'taunt':
      delta.anger = 3;
      delta.happiness = -2;
      break;
    case 'threat':
      delta.anger = 5;
      delta.happiness = -3;
      break;
    case 'accusation':
      delta.anger = 4;
      delta.happiness = -3;
      break;
    case 'thanks':
      delta.happiness = 2;
      break;
    case 'trade_offer':
      delta.happiness = trust >= 40 ? 1 : 0;
      break;
    case 'help':
      delta.happiness = trust >= 50 ? 1 : 0;
      break;
    case 'gossip':
      delta.happiness = 1;
      break;
    case 'agreement':
      delta.happiness = 2;
      break;
    case 'emote':
      delta.happiness = mood > 0 ? 1 : 0;
      break;
    default:
      break;
  }

  return delta;
}

function _deriveRelationshipDelta(intent, trust, mood) {
  const delta = { trust: 0, affinity: 0 };

  switch (intent) {
    case 'greeting':
      delta.trust = trust >= 60 ? 1 : 0;
      delta.affinity = trust >= 60 ? 1 : 0;
      break;
    case 'farewell':
      delta.affinity = trust >= 50 ? 1 : 0;
      break;
    case 'compliment':
      delta.trust = 2;
      delta.affinity = 3;
      break;
    case 'taunt':
      delta.trust = -3;
      delta.affinity = -2;
      break;
    case 'threat':
      delta.trust = -5;
      delta.affinity = -4;
      break;
    case 'accusation':
      delta.trust = -5;
      delta.affinity = -3;
      break;
    case 'thanks':
      delta.trust = 1;
      delta.affinity = 2;
      break;
    case 'trade_offer':
      delta.trust = trust >= 40 ? 1 : -1;
      break;
    case 'help':
      delta.trust = 1;
      delta.affinity = 2;
      break;
    case 'gossip':
      delta.trust = 1;
      break;
    case 'agreement':
      delta.trust = 1;
      delta.affinity = 2;
      break;
    case 'refusal':
      delta.affinity = -1;
      break;
    default:
      break;
  }

  return delta;
}

async function generateLocalChatResponse(payload) {
  const t0 = Date.now();
  const message = payload.message || '';
  const intent = classifyIntent(message);
  const trust = payload.relationship?.trust ?? 50;
  const mood = payload.emotions?.mood ?? 0;

  if (payload.agentId && payload.speaker) {
    recordHeard(payload.agentId, message);
  }

  stats.attempts += 1;

  const learned = tryLearnedTemplate(intent, payload);
  if (learned) {
    stats.learnedHits += 1;
    return {
      chatMessage: learned,
      source: 'learned',
      latencyMs: Date.now() - t0,
      intent,
      relationshipDelta: _deriveRelationshipDelta(intent, trust, mood),
      emotionDelta: _deriveEmotionDelta(intent, trust, mood),
    };
  }

  const tmpl = tryTemplate(payload);

  const now = Date.now();
  const cooldownMs = _getFatigueCooldownMs();
  const slmAvailable = slmFatigue < SLM_FATIGUE_CEIL || now > slmFatigueRecoveryAt;

  if (slmAvailable) {
    querySLM(payload).then(result => {
      if (result && result.chatMessage) {
        const validated = validateSLMResponse(result.chatMessage);
        if (validated) {
          slmFatigue = Math.max(0, slmFatigue - 1);
          stats.slmHits += 1;
          stats.totalSlmLatencyMs += result.latencyMs;
          learnTemplate(intent, payload, validated);
          logger.debug('LocalFallback', `SLM background learned for intent '${intent}'`);
        } else {
          slmFatigue += 1;
        }
      } else {
        slmFatigue += 1;
      }
      if (slmFatigue >= SLM_FATIGUE_CEIL) {
        const cd = _getFatigueCooldownMs();
        slmFatigueRecoveryAt = Date.now() + cd;
        logger.info('LocalFallback', `SLM fatigued (${slmFatigue} fails) — cooldown ${Math.round(cd / 1000)}s`);
      }
    }).catch(() => {});
  }

  stats.templateHits += 1;
  return {
    chatMessage: tmpl.chatMessage,
    source: 'template',
    latencyMs: Date.now() - t0,
    intent,
    relationshipDelta: _deriveRelationshipDelta(intent, trust, mood),
    emotionDelta: _deriveEmotionDelta(intent, trust, mood),
  };
}

function getLocalFallbackStats() {
  const learned = getLearnedStats();
  return {
    ...stats,
    avgSlmLatencyMs: stats.slmHits > 0 ? Math.round(stats.totalSlmLatencyMs / stats.slmHits) : 0,
    learned,
    slmFatigue,
    slmFatigueCeil: SLM_FATIGUE_CEIL,
    slmFatigueRecoveryAt: slmFatigueRecoveryAt > Date.now() ? slmFatigueRecoveryAt : 0,
    slmFatigueCooldownMs: _getFatigueCooldownMs(),
  };
}

module.exports = { generateLocalChatResponse, getLocalFallbackStats };
