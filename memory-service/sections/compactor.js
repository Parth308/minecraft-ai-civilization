const fs = require('fs');
const { getSectionFilePath, parseSectionFile, writeSectionFile } = require('./schema');
const config = require('../config');
const logger = require('../../shared/logger');

const CONSOLIDATION_PROVIDERS = [
  {
    name: 'Nvidia',
    endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions',
    apiKeyEnv: 'NVIDIA_API_KEY',
    modelEnv: 'NVIDIA_MODEL',
    defaultModel: 'nvidia/nemotron-3-nano-30b-a3b',
    timeoutMs: 30000
  },
  {
    name: 'Mistral',
    endpoint: 'https://api.mistral.ai/v1/chat/completions',
    apiKeyEnv: 'MISTRAL_API_KEY',
    modelEnv: 'MISTRAL_MODEL',
    defaultModel: 'mistral-small-latest',
    timeoutMs: 30000
  }
];

async function callConsolidationProvider(provider, prompt) {
  const apiKey = process.env[provider.apiKeyEnv];
  if (!apiKey) throw new Error(`${provider.apiKeyEnv} is not configured`);

  const response = await fetch(provider.endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: process.env[provider.modelEnv] || provider.defaultModel,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 2048
    }),
    signal: AbortSignal.timeout(provider.timeoutMs)
  });

  if (response.status === 429) {
    const error = new Error(`${provider.name} rate limited (429)`);
    error.status = 429;
    throw error;
  }
  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`${provider.name} HTTP ${response.status} | ${errText.slice(0, 200)}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error(`${provider.name} returned empty content`);
  return text;
}

// Collapse near-identical event summaries (differing only in numbers/coords)
// into one line with a repeat count. Threshold 3 keeps legitimate distinct
// facts (individual trades, unique discoveries) verbatim while killing
// coordinate spam like 9 consecutive "mineblock iron_ore" lines.
function aggregateRepeatedPatterns(summaries) {
  const patternCounts = new Map();
  const orderedPatterns = [];

  for (const summary of summaries) {
    const pattern = summary.replace(/\d+(\.\d+)?/g, '#');
    if (!patternCounts.has(pattern)) {
      patternCounts.set(pattern, { count: 0, sample: summary });
      orderedPatterns.push(pattern);
    }
    patternCounts.get(pattern).count++;
  }

  return orderedPatterns.map(pattern => {
    const { count, sample } = patternCounts.get(pattern);
    return count >= 3 ? `${sample} (and ${count - 1} similar recent events)` : sample;
  });
}

// Per-file promise-chain mutex. Tier1 appends and Tier2 rewrites both do
// read-modify-write on the same section files; without serialization a Tier1
// append landing inside Tier2's LLM await window is silently destroyed by the
// final write.
const _sectionLocks = new Map();

function withSectionLock(key, fn) {
  const prev = _sectionLocks.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  _sectionLocks.set(key, next.catch(() => {}));
  return next;
}

// Local mini-breaker for consolidation providers. These calls bypass the
// broker's rate limiter entirely; without their own trip logic a dead
// provider eats a 30s timeout on every sweep across every agent section.
const CONSOLIDATION_BREAKER_THRESHOLD = 3;
const CONSOLIDATION_BREAKER_COOLDOWN_MS = 15 * 60 * 1000;

const consolidationBreaker = {
  failsByProvider: new Map(),
  isBlocked(name) {
    const st = this.failsByProvider.get(name);
    return !!(st && st.blockedUntil > Date.now());
  },
  recordSuccess(name) {
    this.failsByProvider.delete(name);
  },
  recordFailure(name) {
    const st = this.failsByProvider.get(name) || { fails: 0, blockedUntil: 0 };
    st.fails += 1;
    if (st.fails >= CONSOLIDATION_BREAKER_THRESHOLD) {
      st.blockedUntil = Date.now() + CONSOLIDATION_BREAKER_COOLDOWN_MS;
      logger.warn('MemoryCompactor', `Consolidation breaker OPEN for ${name} (${st.fails} consecutive fails, ${CONSOLIDATION_BREAKER_COOLDOWN_MS / 60000}min cooldown)`);
    }
    this.failsByProvider.set(name, st);
  }
};

class MemoryCompactor {
  constructor(brokerClient = null) {
    this.brokerUrl = config.brokerUrl;
  }

  // Tier 1: Compact a rolling buffer of raw events into section files
  async compactBufferToSections(agentId, eventsList, eventRouter) {
    logger.info('MemoryCompactor', `[Tier 1 Compaction] Processing ${eventsList.length} events for agent ${agentId}`);

    // Group events by target section
    const grouped = {};
    for (const event of eventsList) {
      const routed = eventRouter.routeEvent(event);
      if (!grouped[routed.section]) grouped[routed.section] = [];
      grouped[routed.section].push(routed.summary);
    }

    // Append to corresponding section files under the same per-file lock
    // Tier2 holds, so appends can never land inside a consolidation window.
    for (const [sectionName, newSummaries] of Object.entries(grouped)) {
      await withSectionLock(`${agentId}/${sectionName}`, async () => {
        const filePath = getSectionFilePath(agentId, sectionName);
        const parsed = parseSectionFile(filePath);

        parsed.frontmatter.last_updated = new Date().toISOString();
        for (const item of aggregateRepeatedPatterns(newSummaries)) {
          parsed.entries.push(`- ${item}`);
        }

        writeSectionFile(filePath, parsed.frontmatter, parsed.entries);
      });
      logger.info('MemoryCompactor', `[Tier 1] Appended ${newSummaries.length} entries to ${sectionName}.md for agent ${agentId}`);
    }

    return { success: true, count: eventsList.length };
  }

  // Tier 2: Consolidate oversized section file using an LLM (NVIDIA NIM -> Mistral)
  async consolidateSectionFile(agentId, sectionName) {
    return withSectionLock(`${agentId}/${sectionName}`, () => this._consolidateUnderLock(agentId, sectionName));
  }

  async _consolidateUnderLock(agentId, sectionName) {
    const filePath = getSectionFilePath(agentId, sectionName);
    if (!fs.existsSync(filePath)) return { skipped: true };

    const parsed = parseSectionFile(filePath);
    if (parsed.entries.length < 5) return { skipped: true, reason: 'Too few entries' };

    logger.info('MemoryCompactor', `[Tier 2 Consolidation] Consolidating ${sectionName}.md for ${agentId} (${parsed.entries.length} entries)...`);

    const sectionSpecific = sectionName === 'relationships'
      ? `\n5. For chat entries: condense full transcripts into one-line summaries like "[coop] Trade negotiation with X: topic" or "[conflict] Dispute with X over Y". Never output full chat text.`
      : sectionName === 'recent'
      ? `\n5. For activity entries: merge mining/crafting/trade sequences into single factual lines like "[skill] Mined iron_ore at multiple coordinates" or "[coop] Completed trade with X for Y". Never output raw JSON or coordinates lists.`
      : '';

    const prompt = `You are a memory consolidation engine for an AI Minecraft agent.
Current Memory Section: "${sectionName}"
Agent: "${agentId}"

Raw Memory Entries:
${parsed.entries.join('\n')}

Instructions:
1. Merge overlapping and redundant entries into single concise factual statements.
2. Condense repeated patterns into durable preferences or observations.
3. Drop outdated temporary chatter, but preserve player trust, conflicts, discoveries, and coordinate facts.
4. Output ONLY valid markdown bullet points starting with '-' and appropriate tags like [met], [conflict], [coop], [location], [skill], [damage]. No introductions or explanations.${sectionSpecific}`;

    let compactedBody = '';
    const providerErrors = [];

    for (const provider of CONSOLIDATION_PROVIDERS) {
      if (consolidationBreaker.isBlocked(provider.name)) {
        providerErrors.push(`${provider.name}: breaker open`);
        continue;
      }
      try {
        compactedBody = await callConsolidationProvider(provider, prompt);
        consolidationBreaker.recordSuccess(provider.name);
        break;
      } catch (err) {
        consolidationBreaker.recordFailure(provider.name);
        providerErrors.push(`${provider.name}: ${err.message}`);
        logger.warn('MemoryCompactor', `Tier 2 provider ${provider.name} failed for ${agentId}/${sectionName}: ${err.message}`);
      }
    }

    if (!compactedBody) {
      // Non-destructive fallback: keep the file intact and defer to the next sweep.
      // Never truncate here — the old slice(-15) fallback silently shredded history.
      logger.warn('MemoryCompactor', `LLM unavailable for Tier 2 compaction (${providerErrors.join(' | ')}). Deferring consolidation of ${agentId}/${sectionName} — file left intact.`);
      return { skipped: true, reason: 'All consolidation providers unavailable', errors: providerErrors };
    }

    const newEntries = compactedBody
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.startsWith('-'))
      .filter(l => !/\b(the instruction|we can use|could be|not needed|maybe we|so we|output only|no introductions|the tag|allowed tags|appropriate tags)\b/i.test(l));

    // Adaptive threshold: large files (500+ entries) compress aggressively
    // because mining/combat spam dominates. Small files keep tighter guards.
    const inputCount = parsed.entries.length;
    const minAcceptable = inputCount >= 500 ? Math.max(3, Math.floor(inputCount * 0.02))
                        : inputCount >= 100 ? Math.max(5, Math.floor(inputCount * 0.05))
                        : Math.max(3, Math.floor(inputCount * 0.15));

    if (newEntries.length === 0 || newEntries.length < minAcceptable) {
      logger.warn('MemoryCompactor', `Tier 2 output suspicious (${newEntries.length} entries < min ${minAcceptable} from ${inputCount}). Keeping ${agentId}/${sectionName} intact.`);
      return { skipped: true, reason: 'Suspicious consolidation output rejected' };
    }

    // One-generation backup: consolidation is destructive by design; .bak lets
    // an operator recover the pre-consolidation text if an LLM hallucinated.
    fs.copyFileSync(filePath, `${filePath}.bak`);

    parsed.frontmatter.last_consolidated = new Date().toISOString();
    parsed.frontmatter.last_updated = new Date().toISOString();

    writeSectionFile(filePath, parsed.frontmatter, newEntries);
    logger.info('MemoryCompactor', `[Tier 2] Consolidated ${sectionName}.md for ${agentId}: ${parsed.entries.length} -> ${newEntries.length} entries.`);

    return { success: true, originalCount: parsed.entries.length, newCount: newEntries.length };
  }
}

module.exports = MemoryCompactor;
