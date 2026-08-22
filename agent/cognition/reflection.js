const logger = require('../../shared/logger');
const detailedLogger = require('../../shared/detailedLogger');

class ReflectionEngine {
  constructor(brainClient, persona, memoryClient, chatActuator) {
    this.brainClient = brainClient;
    this.persona = persona;
    this.memoryClient = memoryClient;
    this.chat = chatActuator;
    this.lastReflectionTime = Date.now();
  }

  get agentId() {
    return this.persona.agentId || 'UnknownAgent';
  }

  async runReflection(recentEvents = [], stats = {}) {
    this.lastReflectionTime = Date.now();
    logger.info('ReflectionEngine', `Running episodic life reflection for ${this.agentId}...`);

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
        logger.info('ReflectionEngine', `[DIARY ENTRY]: "${response.diaryEntry}"`);
        detailedLogger.logCognition(this.agentId, 'Authored Episodic Diary Reflection', {
          diary: response.diaryEntry,
          lesson: response.lifeLesson,
          newGoal: response.newGoal
        });

        // Store into long-term vector memory
        if (this.memoryClient) {
          this.memoryClient.flushBuffer([{
            type: 'reflection',
            payload: response,
            summary: `[diary] ${response.diaryEntry} (Lesson: ${response.lifeLesson})`
          }]);
        }

        return response;
      }
    } catch (err) {
      logger.debug('ReflectionEngine', `Reflection skipped: ${err.message}`);
    }
    return null;
  }
}

module.exports = ReflectionEngine;
