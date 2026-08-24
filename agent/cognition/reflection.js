const logger = require('../../shared/logger');
const detailedLogger = require('../../shared/detailedLogger');

class ReflectionEngine {
  constructor(brainClient, persona, memoryClient, chatActuator) {
    this.brainClient = brainClient;
    this.persona = persona;
    this.memoryClient = memoryClient;
    this.chat = chatActuator;
    this.lastReflectionTime = Date.now();
    this.allowProfileWrite = false; // Micro-reflection writes ONLY to vector store / diary; never mutates profile.md directly
    this.unsharedLessons = []; // Known-but-unshared lessons tracking (for diagnostic & organic gossip)
  }

  get agentId() {
    return this.persona.agentId || 'UnknownAgent';
  }

  getUnsharedLessons() {
    return [...this.unsharedLessons];
  }

  /**
   * Returns a lesson eligible for gossip during high-trust dialogue.
   */
  getLessonForGossip() {
    if (this.unsharedLessons.length === 0) return null;
    return this.unsharedLessons[Math.floor(Math.random() * this.unsharedLessons.length)];
  }

  async runReflection(recentEvents = [], stats = {}) {
    this.lastReflectionTime = Date.now();
    logger.info('ReflectionEngine', `[source: agent-diary] Running per-event micro-reflection for ${this.agentId}...`);

    const prompt = `You are ${this.agentId}, an autonomous Minecraft player with personality: ${JSON.stringify(this.persona.getPersonaPromptContext ? this.persona.getPersonaPromptContext() : this.persona)}.
Current Vitals & Emotions: ${JSON.stringify(stats)}
Recent Experiences: ${JSON.stringify(recentEvents.slice(-10))}

Write a short (2-sentence) reflective diary entry in your personal journal about what you experienced today, what you learned, and your immediate ambition for tomorrow.
Reply ONLY with a valid JSON object:
{
  "diaryEntry": "your 2-sentence journal entry",
  "lifeLesson": "one key tactical or philosophical principle learned",
  "newGoal": "optional ambitious new goal or null",
  "severity": 0.8
}`;

    try {
      const response = await this.brainClient.escalate({
        taskType: 'REFLECTION',
        agentId: this.agentId,
        topCandidate: { prompt }
      });

      if (response && response.diaryEntry) {
        logger.info('ReflectionEngine', `[source: agent-diary] [DIARY ENTRY]: "${response.diaryEntry}"`);
        detailedLogger.logCognition(this.agentId, 'Authored Episodic Diary Reflection', {
          diary: response.diaryEntry,
          lesson: response.lifeLesson,
          newGoal: response.newGoal,
          source: 'agent-diary'
        });

        // Store into long-term vector memory with source tag
        if (this.memoryClient) {
          this.memoryClient.flushBuffer([{
            type: 'reflection',
            source: 'agent-diary',
            payload: {
              ...response,
              source: 'agent-diary',
              agentId: this.agentId,
              timestamp: Date.now()
            },
            summary: `[diary] ${response.diaryEntry} (Lesson: ${response.lifeLesson})`
          }]);
        }

        // Cross-Agent Lesson Sharing based on Severity-Weighted Effective Openness
        if (response.lifeLesson) {
          await this._handleLessonSharing(response);
        }

        return response;
      }
    } catch (err) {
      logger.debug('ReflectionEngine', `Micro-reflection skipped: ${err.message}`);
    }
    return null;
  }

  async _handleLessonSharing(reflectionResponse) {
    const serviceUrl = this.memoryClient?.serviceUrl || process.env.MEMORY_SERVICE_URL || 'http://localhost:3002';
    const lessonText = reflectionResponse.lifeLesson;

    // Detect hazard/survival severity
    const lower = (lessonText + ' ' + (reflectionResponse.diaryEntry || '')).toLowerCase();
    const isHazard = lower.includes('death') || lower.includes('freeze') || lower.includes('snow') ||
                    lower.includes('frost') || lower.includes('lava') || lower.includes('fire') ||
                    lower.includes('drown') || lower.includes('fall') || lower.includes('starv') ||
                    lower.includes('killed') || lower.includes('zombie') || lower.includes('skeleton') ||
                    lower.includes('hazard');

    let severity = typeof reflectionResponse.severity === 'number' ? reflectionResponse.severity : (isHazard ? 0.90 : 0.30);
    const effective = this.persona?.calculateEffectiveOpenness ? this.persona.calculateEffectiveOpenness(severity) : {
      effectivePrivacy: this.persona?.privacyPreference || 'ask',
      effectiveOpenness: this.persona?.traits?.openness || 0.5
    };

    const privacy = effective.effectivePrivacy;
    const lessonEntry = {
      agentId: this.agentId,
      lesson: lessonText,
      severity,
      baseOpenness: effective.baseOpenness,
      effectiveOpenness: effective.effectiveOpenness,
      isPublic: privacy === 'public',
      status: privacy === 'public' ? 'shared' : (privacy === 'ask' ? 'ask_pending' : 'unshared_private'),
      context: { diary: reflectionResponse.diaryEntry, newGoal: reflectionResponse.newGoal, isHazard },
      confidence: privacy === 'public' ? Math.max(0.65, effective.effectiveOpenness) : 0.40,
      timestamp: Date.now()
    };

    if (privacy === 'public') {
      logger.info('ReflectionEngine', `[PRIVACY: public | severity: ${severity}] Automatically sharing lesson to civ ledger for ${this.agentId} (effectiveOpenness: ${effective.effectiveOpenness})`);
      try {
        await fetch(`${serviceUrl}/api/ledger/lessons`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(lessonEntry)
        });
      } catch (err) {
        logger.debug('ReflectionEngine', `Failed to post shared lesson to ledger: ${err.message}`);
      }
    } else {
      // Record unshared lesson in local tracker and register in ledger as unshared diagnostic
      this.unsharedLessons.push(lessonEntry);
      if (this.unsharedLessons.length > 50) this.unsharedLessons.shift();

      logger.info('ReflectionEngine', `[PRIVACY: ${privacy} | severity: ${severity}] ${this.agentId} tracked unshared lesson (effectiveOpenness: ${effective.effectiveOpenness}). Stored for local memory & organic gossip.`);
      try {
        await fetch(`${serviceUrl}/api/ledger/lessons`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...lessonEntry, isPublic: false })
        });
      } catch (err) {
        logger.debug('ReflectionEngine', `Failed to register unshared diagnostic lesson to ledger: ${err.message}`);
      }

      if (privacy === 'ask') {
        this.pendingLesson = lessonEntry;
      }
    }
  }

  confirmPendingLessonShare(approved = true) {
    if (!this.pendingLesson) return false;
    if (approved) {
      const serviceUrl = this.memoryClient?.serviceUrl || process.env.MEMORY_SERVICE_URL || 'http://localhost:3002';
      fetch(`${serviceUrl}/api/ledger/lessons`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...this.pendingLesson,
          isPublic: true,
          status: 'shared_after_ask'
        })
      }).catch(() => {});
      logger.info('ReflectionEngine', `[PRIVACY: ask -> approved] ${this.agentId} shared pending lesson to civ ledger.`);
    } else {
      logger.info('ReflectionEngine', `[PRIVACY: ask -> rejected] Pending lesson share discarded.`);
    }
    this.pendingLesson = null;
    return true;
  }
}

module.exports = ReflectionEngine;
