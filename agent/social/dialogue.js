const logger = require('../../shared/logger');

class SocialDialogueEngine {
  constructor(brainClient, persona, goalManager, relationshipTracker) {
    this.brainClient = brainClient;
    this.persona = persona;
    this.goalManager = goalManager;
    this.relationships = relationshipTracker;
  }

  async processIncomingChat(sender, message, civContext = {}) {
    if (!message || sender === this.persona.agentId) return null;

    logger.info('SocialDialogue', `Processing chat from [${sender}]: "${message}"`);
    const relationship = this.relationships.get(sender);

    const payload = {
      taskType: 'SOCIAL_CHAT',
      agentId: this.persona.agentId,
      speaker: sender,
      message: message,
      relationship: relationship,
      persona: this.persona.getPersonaPromptContext(),
      goals: this.goalManager.getGoalContext(),
      civContext: civContext
    };

    try {
      const response = await this.brainClient.escalate(payload);
      
      // If persona shift or relationship update is returned
      if (response.relationshipDelta) {
        if (response.relationshipDelta.trust) this.relationships.updateTrust(sender, response.relationshipDelta.trust);
        if (response.relationshipDelta.affinity) this.relationships.updateAffinity(sender, response.relationshipDelta.affinity);
      }

      if (response.newGoal) {
        this.goalManager.setGoal(response.newGoal);
      }

      return response.chatMessage || null;
    } catch (err) {
      logger.error('SocialDialogue', `Failed to generate dialogue: ${err.message}`);
      return null;
    }
  }
}

module.exports = SocialDialogueEngine;
