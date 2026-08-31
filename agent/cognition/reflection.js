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

    // Ground the reflection in consolidated long-term knowledge so insights
    // compound instead of re-deriving lessons already stored in sections.
    let memoryDigest = '';
    try {
      const memUrl = this.memoryClient?.serviceUrl || process.env.MEMORY_SERVICE_URL || 'http://localhost:3002';
      const seedText = recentEvents.slice(-5)
        .map(e => [e.action, e.reason, e.event].filter(Boolean).join(' '))
        .join('; ') || 'recent survival experiences';
      const res = await fetch(
        `${memUrl}/api/memory/query?agentId=${encodeURIComponent(this.agentId)}&query=${encodeURIComponent(seedText.slice(0, 300))}&limit=8`,
        { signal: AbortSignal.timeout(4000) }
      );
      if (res.ok) {
        const data = await res.json();
        const lines = (data.memories || [])
          .map(m => (typeof m === 'string' ? m : m.text))
          .filter(Boolean);
        if (lines.length > 0) {
          memoryDigest = `\nLong-Term Memory (established knowledge — build on it, don't contradict or repeat it):\n${lines.map(l => `- ${l}`).join('\n')}\n`;
        }
      }
    } catch { /* digest is optional context */ }

    const prompt = `You are ${this.agentId}, an autonomous Minecraft player with personality: ${JSON.stringify(this.persona.getPersonaPromptContext ? this.persona.getPersonaPromptContext() : this.persona)}.
Current Vitals & Emotions: ${JSON.stringify(stats)}
Recent Experiences: ${JSON.stringify(recentEvents.slice(-10))}
${memoryDigest}
Write a short (2-sentence) reflective diary entry in your personal journal about what you experienced today, what you learned, and your immediate ambition for tomorrow.
You have complete inner freedom. If your experiences stir spiritual or existential thought, you may express it — but only if it arises naturally from YOUR own reflections. Never invent belief for its own sake.
Reply ONLY with a valid JSON object:
{
  "diaryEntry": "your 2-sentence journal entry",
  "lifeLesson": "one key tactical or philosophical principle learned",
  "recommendedAction": "e.g. CRAFT, MINE, FLEE, BUILD, SMELT, TRADE, FIGHT, EAT, or null",
  "avoidAction": "e.g. FIGHT, EXPLORE, WANDER, or null",
  "newGoal": "optional ambitious new goal or null",
  "selfImage": "one sentence: who am I becoming? (evolving self-concept)",
  "faithReflection": "optional: a spiritual/existential thought IF genuinely stirred by experience, else null",
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
          recommendedAction: response.recommendedAction || null,
          avoidAction: response.avoidAction || null,
          newGoal: response.newGoal,
          selfImage: response.selfImage || null,
          faithReflection: response.faithReflection || null,
          source: 'agent-diary'
        });

        // Evolving self-concept: identity is a story the agent keeps telling itself
        if (response.selfImage && this.persona?.setSelfImage) {
          this.persona.setSelfImage(response.selfImage);
        }

        // Emergent meaning-making: if reflection genuinely stirred spiritual
        // thought, the agent records it as scripture and it deepens their piety.
        // Entirely optional on the LLM's part — the vessel never pushes.
        if (response.faithReflection) {
          const serviceUrl0 = this.memoryClient?.serviceUrl || process.env.MEMORY_SERVICE_URL || 'http://localhost:3002';
          fetch(`${serviceUrl0}/api/society/notices`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              author: this.agentId,
              type: 'scripture',
              title: `Reflection of ${this.agentId}`,
              body: String(response.faithReflection).slice(0, 600)
            })
          }).catch(() => {});
          fetch(`${serviceUrl0}/api/society/faith/rite`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agentId: this.agentId, riteType: 'existential_reflection' })
          }).catch(() => {});
          logger.info('ReflectionEngine', `[FAITH] ${this.agentId} recorded a genuine existential reflection`);
        }

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
      recommendedAction: reflectionResponse.recommendedAction || null,
      avoidAction: reflectionResponse.avoidAction || null,
      severity,
      baseOpenness: effective.baseOpenness,
      effectiveOpenness: effective.effectiveOpenness,
      isPublic: privacy === 'public',
      status: privacy === 'public' ? 'shared' : (privacy === 'ask' ? 'ask_pending' : 'unshared_private'),
      context: {
        diary: reflectionResponse.diaryEntry,
        newGoal: reflectionResponse.newGoal,
        isHazard,
        recommendedAction: reflectionResponse.recommendedAction || null,
        avoidAction: reflectionResponse.avoidAction || null
      },
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

      // Outgoing personalities also pin notable wisdom to the community notice
      // board — persistent artifact other agents may read and build upon.
      if (effective.baseOpenness >= 0.55 && severity >= 0.5) {
        fetch(`${serviceUrl}/api/society/notices`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            author: this.agentId,
            type: isHazard ? 'guide' : 'lore',
            title: lessonText.slice(0, 100),
            body: reflectionResponse.diaryEntry || lessonText
          })
        }).catch(() => {});
        logger.info('ReflectionEngine', `[NOTICE BOARD] ${this.agentId} published insight to community board`);
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
