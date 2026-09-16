/**
 * SLM (Small Language Model) fallback client for social chat.
 * Calls the local Ollama qwen2.5:0.5b model via HTTP when all external
 * providers are quarantined and templates can't handle the complexity.
 *
 * ~2-3s latency on VPS CPU (Intel Xeon Gold 5415+), 397MB RAM footprint.
 */

'use strict';

const logger = require('../../shared/logger');

const OLLAMA_URL = process.env.OLLAMA_SLM_URL || 'http://ollama-embeddings:11434';
const MODEL = process.env.OLLAMA_SLM_MODEL || 'qwen2.5:0.5b';
const TIMEOUT_MS = parseInt(process.env.OLLAMA_SLM_TIMEOUT || '4000', 10);

let slmInFlight = 0;
const SLM_MAX_CONCURRENT = 1;

/**
 * Generate a social chat response using the local 0.5B SLM.
 *
 * @param {object} payload - Same payload shape as the SOCIAL_CHAT prompt context
 * @param {string} payload.speaker - Who messaged the agent
 * @param {string} payload.message - Their message text
 * @param {object} payload.persona - Agent persona (agentId, title, temperament, speakingStyle, quirk)
 * @param {object} payload.relationship - { trust, affinity }
 * @param {object} payload.emotions - { mood, emotions, feelings }
 * @param {object} payload.civContext - Current task, goal, position, stats
 * @returns {Promise<{ chatMessage: string, latencyMs: number } | null>}
 */
async function querySLM(payload) {
  const t0 = Date.now();
  const p = payload.persona || {};
  const rel = payload.relationship || {};
  const emo = payload.emotions || {};
  const ctx = payload.civContext || {};

  const trust = rel.trust ?? 50;
  const mood = emo.mood ?? 0;
  const moodLabel = mood > 0.2 ? 'good spirits' : mood < -0.2 ? 'low and heavy' : 'even-keeled';

  const prompt = `You are ${p.agentId || 'a villager'}, a Minecraft player.
Personality: ${p.temperament || 'neutral'}, speaking style: ${p.speakingStyle || 'casual'}.
Your trust in ${payload.speaker || 'them'}: ${trust}/100.
Your mood: ${moodLabel}.
${ctx.currentTask ? `You were just ${ctx.currentTask}.` : ''}

${payload.speaker || 'Someone'} says: "${payload.message || 'hey'}"

Reply in 1 short sentence (under 15 words). Be in-character. No quotes, no JSON.`;

  try {
    if (slmInFlight >= SLM_MAX_CONCURRENT) {
      logger.debug('SLM', `Concurrency limit reached (${slmInFlight}/${SLM_MAX_CONCURRENT}) — skipping SLM`);
      return null;
    }
    slmInFlight += 1;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        prompt,
        stream: false,
        options: {
          num_predict: 40,
          temperature: 0.7,
          top_p: 0.9,
        }
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      logger.warn('SLM', `Ollama returned ${res.status}: ${res.statusText}`);
      return null;
    }

    const data = await res.json();
    const text = (data.response || '').trim();

    if (!text || text.length < 2) {
      logger.debug('SLM', 'Empty response from Ollama');
      return null;
    }

    // Clean up common SLM artifacts
    const cleaned = text
      .replace(/^["']|["']$/g, '')     // strip wrapping quotes
      .replace(/^As .*?, /i, '')       // strip "As a villager, ..." preambles
      .replace(/^In Minecraft, /i, '')
      .replace(/\n.*/s, '')            // only first line
      .trim();

    if (cleaned.length < 2 || cleaned.length > 100) {
      logger.debug('SLM', `Response length out of bounds (${cleaned.length}): ${cleaned}`);
      return null;
    }

    return { chatMessage: cleaned, latencyMs: Date.now() - t0 };
  } catch (err) {
    if (err.name === 'AbortError') {
      logger.warn('SLM', `Ollama request timed out after ${TIMEOUT_MS}ms`);
    } else {
      logger.warn('SLM', `Ollama error: ${err.message}`);
    }
    return null;
  } finally {
    slmInFlight = Math.max(0, slmInFlight - 1);
  }
}

module.exports = { querySLM };
