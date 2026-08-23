const { getSectionFilePath, parseSectionFile, writeSectionFile } = require('../sections/schema');
const logger = require('../../shared/logger');

class GenerativeReflectionEngine {
  constructor(brokerUrl = process.env.BROKER_URL || 'http://localhost:3001') {
    this.brokerUrl = brokerUrl;
    this.isMacroWriter = true; // Sole authorized writer to profile.md
  }

  async runReflection(agentId) {
    logger.info('ReflectionEngine', `[source: macro-reflection] Running periodic macro-reflection pass for ${agentId}...`);

    const eventsPath = getSectionFilePath(agentId, 'events');
    const relationshipsPath = getSectionFilePath(agentId, 'relationships');
    const skillsPath = getSectionFilePath(agentId, 'skills');
    const profilePath = getSectionFilePath(agentId, 'profile');

    const events = parseSectionFile(eventsPath);
    const relationships = parseSectionFile(relationshipsPath);
    const skills = parseSectionFile(skillsPath);
    const profile = parseSectionFile(profilePath);

    if (events.entries.length === 0 && relationships.entries.length === 0 && skills.entries.length === 0) {
      logger.info('ReflectionEngine', `[source: macro-reflection] No accumulated events, skills, or social encounters to reflect upon for ${agentId}.`);
      return null;
    }

    const prompt = `You are the reflective inner consciousness of a sentient Minecraft AI agent named "${agentId}".
Agent Profile: ${JSON.stringify(profile.frontmatter)}
Accumulated Skills & Tactics: ${JSON.stringify(skills.entries.slice(-8))}
Recent Significant Events: ${JSON.stringify(events.entries.slice(-10))}
Recent Social Encounters: ${JSON.stringify(relationships.entries.slice(-10))}

Reflect deeply on your collective experiences and answer:
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
        // Append reflections to profile.md with explicit macro-reflection tag
        const taggedReflections = data.reflections.map(r => `[source: macro-reflection] ${r}`);
        profile.entries.push(...taggedReflections);
        if (data.updatedWorldview) {
          profile.frontmatter.worldview = data.updatedWorldview;
        }
        writeSectionFile(profilePath, profile.frontmatter, profile.entries);
        logger.info('ReflectionEngine', `[source: macro-reflection] Successfully synthesized ${data.reflections.length} deep reflections into profile.md for ${agentId}`);

        // Extract structured numeric rule adjustments feedback loop
        await this._extractAndPublishRuleAdjustments(agentId, data.reflections, data.updatedWorldview);
      }

      return data;
    } catch (err) {
      logger.error('ReflectionEngine', `[source: macro-reflection] Reflection pass failed for ${agentId}: ${err.message}`);
      return null;
    }
  }

  async _extractAndPublishRuleAdjustments(agentId, reflections = [], worldview = '') {
    if (!reflections.length && !worldview) return;

    const memoryServicePort = process.env.PORT || 3002;
    const memoryServiceUrl = process.env.MEMORY_SERVICE_URL || `http://localhost:${memoryServicePort}`;

    const prompt = `Analyze these personal Minecraft reflections and extract tactical numeric rule adjustments:
Reflections: ${JSON.stringify(reflections)}
Updated Worldview: "${worldview}"

Identify any tactical actions (CRAFT, BUILD, FLEE, FIGHT, MINE, EAT, SLEEP, TRADE, TALK, EXPLORE) mentioned where the agent learned a specific rule adjustment.
Reply ONLY with a valid JSON array of adjustment objects (or empty array [] if none):
[
  {
    "ruleType": "CRAFT",
    "situationPattern": "crafting without table or ingredients",
    "recommendedConfidenceDelta": -0.2,
    "reason": "Repeatedly failed craft attempts cost vital daylight"
  }
]`;

    try {
      const response = await fetch(`${this.brokerUrl}/api/escalate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskType: 'REFLECTION',
          agentId,
          topCandidate: { name: 'RULE_ADJUSTMENT_EXTRACTION', prompt },
          stats: {}
        })
      });

      if (response.ok) {
        const raw = await response.json();
        let adjustments = Array.isArray(raw) ? raw : (raw.adjustments || []);
        if (!Array.isArray(adjustments) && raw.ruleType) {
          adjustments = [raw];
        }
        for (const adj of adjustments) {
          if (adj.ruleType && typeof adj.recommendedConfidenceDelta === 'number') {
            await fetch(`${memoryServiceUrl}/api/rules/adjust`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                agentId,
                ruleType: adj.ruleType,
                situationPattern: adj.situationPattern || 'general',
                recommendedConfidenceDelta: Math.max(-0.3, Math.min(0.3, adj.recommendedConfidenceDelta)),
                reason: adj.reason || 'Synthesized from macro-reflection'
              })
            });
            logger.info('ReflectionEngine', `[RULE ADJUSTMENT] Published rule adjustment for ${agentId}: ${adj.ruleType} (${adj.recommendedConfidenceDelta > 0 ? '+' : ''}${adj.recommendedConfidenceDelta})`);
          }
        }
      }
    } catch (err) {
      logger.debug('ReflectionEngine', `Rule adjustment extraction skipped: ${err.message}`);
    }
  }
}

module.exports = GenerativeReflectionEngine;
