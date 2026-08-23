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
  }

  get agentId() {
    return this.persona.agentId || 'UnknownAgent';
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
  "newGoal": "optional ambitious new goal or null"
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

        // Cross-Agent Lesson Sharing based on Privacy Preference
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
    const privacy = this.persona?.privacyPreference || 'ask';
    const serviceUrl = this.memoryClient?.serviceUrl || process.env.MEMORY_SERVICE_URL || 'http://localhost:3002';
    const lessonText = reflectionResponse.lifeLesson;

    if (privacy === 'public') {
      logger.info('ReflectionEngine', `[PRIVACY: public] Automatically sharing lesson to civ ledger for ${this.agentId}`);
      try {
        await fetch(`${serviceUrl}/api/ledger/lessons`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: this.agentId,
            lesson: lessonText,
            isPublic: true,
            context: { diary: reflectionResponse.diaryEntry, newGoal: reflectionResponse.newGoal },
            confidence: 0.85
          })
        });
      } catch (err) {
        logger.debug('ReflectionEngine', `Failed to post shared lesson to ledger: ${err.message}`);
      }
    } else if (privacy === 'private') {
      logger.info('ReflectionEngine', `[PRIVACY: private] ${this.agentId} kept lesson private. Saved to local memory only.`);
    } else if (privacy === 'ask') {
      logger.info('ReflectionEngine', `[PRIVACY: ask] ${this.agentId} prompting in-game before sharing lesson.`);
      this.pendingLesson = {
        lesson: lessonText,
        context: { diary: reflectionResponse.diaryEntry, newGoal: reflectionResponse.newGoal },
        timestamp: Date.now()
      };
      if (this.chat && typeof this.chat.say === 'function') {
        this.chat.say(`I learned something: "${lessonText}" — should I share it with the others?`);
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
          agentId: this.agentId,
          lesson: this.pendingLesson.lesson,
          isPublic: true,
          context: this.pendingLesson.context,
          confidence: 0.85
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
