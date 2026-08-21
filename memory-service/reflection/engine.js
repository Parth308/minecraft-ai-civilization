const { getSectionFilePath, parseSectionFile, writeSectionFile } = require('../sections/schema');
const logger = require('../../shared/logger');

class GenerativeReflectionEngine {
  constructor(brokerUrl = process.env.BROKER_URL || 'http://localhost:3001') {
    this.brokerUrl = brokerUrl;
  }

  async runReflection(agentId) {
    logger.info('ReflectionEngine', `Running cognitive reflection pass for ${agentId}...`);

    const eventsPath = getSectionFilePath(agentId, 'events');
    const relationshipsPath = getSectionFilePath(agentId, 'relationships');
    const profilePath = getSectionFilePath(agentId, 'profile');

    const events = parseSectionFile(eventsPath);
    const relationships = parseSectionFile(relationshipsPath);
    const profile = parseSectionFile(profilePath);

    if (events.entries.length === 0 && relationships.entries.length === 0) {
      logger.info('ReflectionEngine', `No new events or social encounters to reflect upon for ${agentId}.`);
      return null;
    }

    const prompt = `You are the reflective inner consciousness of a sentient Minecraft AI agent named "${agentId}".
Agent Profile: ${JSON.stringify(profile.frontmatter)}
Recent Significant Events: ${JSON.stringify(events.entries.slice(-10))}
Recent Social Encounters: ${JSON.stringify(relationships.entries.slice(-10))}

Reflect deeply on your experiences and answer:
1. What higher-level social truths have you realized about your neighbors?
2. How has your character/worldview evolved?
3. What are your aspirations regarding alliances, currencies, or survival? (You have full free will: conform or rebel).

Reply ONLY with a valid JSON object:
{
  "reflections": [
    "High-level insight 1",
    "High-level insight 2"
  ],
  "updatedWorldview": "Concise updated personal worldview statement",
  "nextGoalSuggestion": "Suggested next aspiration"
}`;

    try {
      const response = await fetch(`${this.brokerUrl}/api/escalate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskType: 'REFLECTION',
          agentId,
          topCandidate: { name: 'REFLECTION', prompt },
          stats: {}
        })
      });

      if (!response.ok) throw new Error(`Broker error HTTP ${response.status}`);
      const data = await response.json();

      if (data.reflections && Array.isArray(data.reflections)) {
        // Append reflections to profile.md
        profile.entries.push(...data.reflections.map(r => `[reflection] ${r}`));
        if (data.updatedWorldview) {
          profile.frontmatter.worldview = data.updatedWorldview;
        }
        writeSectionFile(profilePath, profile.frontmatter, profile.entries);
        logger.info('ReflectionEngine', `Successfully recorded ${data.reflections.length} deep reflections for ${agentId}`);
      }

      return data;
    } catch (err) {
      logger.error('ReflectionEngine', `Reflection pass failed for ${agentId}: ${err.message}`);
      return null;
    }
  }
}

module.exports = GenerativeReflectionEngine;
