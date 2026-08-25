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
    defaultModel: 'meta/llama-3.1-8b-instruct',
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

    // Append to corresponding section files
    for (const [sectionName, newSummaries] of Object.entries(grouped)) {
      const filePath = getSectionFilePath(agentId, sectionName);
      const parsed = parseSectionFile(filePath);

      parsed.frontmatter.last_updated = new Date().toISOString();
      for (const item of aggregateRepeatedPatterns(newSummaries)) {
        parsed.entries.push(`- ${item}`);
      }

      writeSectionFile(filePath, parsed.frontmatter, parsed.entries);
      logger.info('MemoryCompactor', `[Tier 1] Appended ${newSummaries.length} entries to ${sectionName}.md for agent ${agentId}`);
    }

    return { success: true, count: eventsList.length };
  }

  // Tier 2: Consolidate oversized section file using an LLM (NVIDIA NIM -> Mistral)
  async consolidateSectionFile(agentId, sectionName) {
    const filePath = getSectionFilePath(agentId, sectionName);
    if (!fs.existsSync(filePath)) return { skipped: true };

    const parsed = parseSectionFile(filePath);
    if (parsed.entries.length < 5) return { skipped: true, reason: 'Too few entries' };

    logger.info('MemoryCompactor', `[Tier 2 Consolidation] Consolidating ${sectionName}.md for ${agentId} (${parsed.entries.length} entries)...`);

    const prompt = `You are a memory consolidation engine for an AI Minecraft agent.
Current Memory Section: "${sectionName}"
Agent: "${agentId}"

Raw Memory Entries:
${parsed.entries.join('\n')}

Instructions:
1. Merge overlapping and redundant entries into single concise factual statements.
2. Condense repeated patterns into durable preferences or observations.
3. Drop outdated temporary chatter, but preserve player trust, conflicts, discoveries, and coordinate facts.
4. Output ONLY valid markdown bullet points starting with '-' and appropriate tags like [met], [conflict], [coop], [location], [skill], [damage]. No introductions or explanations.`;

    let compactedBody = '';
    const providerErrors = [];

    for (const provider of CONSOLIDATION_PROVIDERS) {
      try {
        compactedBody = await callConsolidationProvider(provider, prompt);
        break;
      } catch (err) {
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
      .filter(l => l.startsWith('-'));

    if (newEntries.length === 0 || newEntries.length < parsed.entries.length * 0.3) {
      // LLM output too sparse or malformed — keep original rather than lose knowledge
      logger.warn('MemoryCompactor', `Tier 2 output suspicious (${newEntries.length} entries from ${parsed.entries.length}). Keeping ${agentId}/${sectionName} intact.`);
      return { skipped: true, reason: 'Suspicious consolidation output rejected' };
    }

    parsed.frontmatter.last_consolidated = new Date().toISOString();
    parsed.frontmatter.last_updated = new Date().toISOString();

    writeSectionFile(filePath, parsed.frontmatter, newEntries);
    logger.info('MemoryCompactor', `[Tier 2] Consolidated ${sectionName}.md for ${agentId}: ${parsed.entries.length} -> ${newEntries.length} entries.`);

    return { success: true, originalCount: parsed.entries.length, newCount: newEntries.length };
  }
}

module.exports = MemoryCompactor;
