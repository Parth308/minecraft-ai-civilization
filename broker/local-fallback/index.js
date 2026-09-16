/**
 * Local Fallback Orchestrator
 *
 * When ALL external LLM providers are quarantined, this module provides
 * instant (template) or near-instant (SLM) chat responses so agents
 * never go silent during provider exhaustion.
 *
 * Routing logic:
 *   1. Try template first (<1ms) — handles greetings, yes/no, taunts, etc.
 *   2. If message is complex (trade negotiation, accusation, multi-sentence
 *      context, question requiring reasoning) → escalate to local SLM (~2-3s).
 *   3. If SLM fails → template catch-all (never silent).
 *
 * For non-chat fallbacks (physical actions), the original fallbackHeuristic
 * in router.js still applies.
 */

'use strict';

const { tryTemplate, classifyIntent } = require('./templates');
const { querySLM } = require('./ollamaClient');
const logger = require('../../shared/logger');

// Intents that templates handle well — no SLM needed
const SIMPLE_INTENTS = new Set([
  'greeting', 'farewell', 'yes', 'no', 'thanks', 'emote',
  'compliment', 'agreement', 'refusal', 'status',
]);

// Intents that benefit from SLM (need reasoning / context)
const COMPLEX_INTENTS = new Set([
  'trade_offer', 'accusation', 'threat', 'question', 'help',
  'gossip', 'location', 'taunt', 'refusal',
]);

// SLM is called in parallel with template for complex messages;
// if SLM responds within this window, use SLM; else use template.
const SLM_TIMEOUT_MS = 5000;

/**
 * Generate a local fallback response for SOCIAL_CHAT when all providers are down.
 *
 * @param {object} payload - Full social chat payload from SocialDialogueEngine
 * @returns {Promise<{ chatMessage: string, source: 'template'|'slm'|'catchall', latencyMs: number, intent: string }>}
 */
async function generateLocalChatResponse(payload) {
  const t0 = Date.now();
  const message = payload.message || '';

  // Step 1: Classify intent
  const intent = classifyIntent(message);

  // Step 2: Always generate template response (instant fallback guarantee)
  const templateResult = tryTemplate(payload);

  // Step 3: For simple intents, template is sufficient — skip SLM
  if (SIMPLE_INTENTS.has(intent)) {
    return {
      chatMessage: templateResult.chatMessage,
      source: 'template',
      latencyMs: Date.now() - t0,
      intent,
    };
  }

  // Step 4: For complex intents, race template vs SLM
  const templatePromise = Promise.resolve(templateResult);
  const slmPromise = querySLM(payload).catch(err => {
    logger.debug('LocalFallback', `SLM error: ${err.message}`);
    return null;
  });

  // Wait for whichever finishes first within timeout
  const result = await Promise.race([
    slmPromise.then(slmResult => {
      if (slmResult && slmResult.chatMessage) {
        return { chatMessage: slmResult.chatMessage, source: 'slm', latencyMs: slmResult.latencyMs, intent };
      }
      return null;
    }),
    new Promise(resolve => {
      setTimeout(() => resolve(null), SLM_TIMEOUT_MS);
    }),
  ]);

  if (result) {
    logger.debug('LocalFallback', `SLM responded in ${result.latencyMs}ms for intent '${intent}'`);
    return result;
  }

  // Step 5: SLM didn't respond in time — use template (guaranteed non-null)
  return {
    chatMessage: templateResult.chatMessage,
    source: 'template',
    latencyMs: Date.now() - t0,
    intent,
  };
}

module.exports = { generateLocalChatResponse };
