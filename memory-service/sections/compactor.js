const fs = require('fs');
const { getSectionFilePath, parseSectionFile, writeSectionFile } = require('./schema');
const config = require('../config');
const logger = require('../../shared/logger');

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
      for (const item of newSummaries) {
        parsed.entries.push(`- ${item}`);
      }

      writeSectionFile(filePath, parsed.frontmatter, parsed.entries);
      logger.info('MemoryCompactor', `[Tier 1] Appended ${newSummaries.length} entries to ${sectionName}.md for agent ${agentId}`);
    }

    return { success: true, count: eventsList.length };
  }

  // Tier 2: Consolidate oversized section file using LLM (Gemini Flash)
  async consolidateSectionFile(agentId, sectionName, apiKey) {
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

    try {
      let compactedBody = '';

      if (apiKey) {
        // Direct call to Gemini Flash or through Broker
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        const data = await response.json();
        compactedBody = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      }

      if (!compactedBody) {
        // Local heuristic fallback if LLM key unavailable
        logger.warn('MemoryCompactor', 'LLM unavailable for Tier 2 compaction. Applying local deduplication.');
        const unique = Array.from(new Set(parsed.entries));
        compactedBody = unique.slice(-15).join('\n');
      }

      const newEntries = compactedBody
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.startsWith('-'));

      parsed.frontmatter.last_consolidated = new Date().toISOString();
      parsed.frontmatter.last_updated = new Date().toISOString();

      writeSectionFile(filePath, parsed.frontmatter, newEntries);
      logger.info('MemoryCompactor', `[Tier 2] Consolidated ${sectionName}.md for ${agentId}: ${parsed.entries.length} -> ${newEntries.length} entries.`);

      return { success: true, originalCount: parsed.entries.length, newCount: newEntries.length };
    } catch (err) {
      logger.error('MemoryCompactor', `Tier 2 consolidation error for ${sectionName}:`, err);
      return { success: false, error: err.message };
    }
  }
}

module.exports = MemoryCompactor;
