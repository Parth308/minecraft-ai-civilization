const logger = require('../../shared/logger');

class SocialDialogueEngine {
  constructor(brainClient, persona, goalManager, relationshipTracker, factionManager = null) {
    this.brainClient = brainClient;
    this.persona = persona;
    this.goalManager = goalManager;
    this.relationships = relationshipTracker;
    this.factionManager = factionManager;
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
      diplomacy: this.factionManager ? this.factionManager.getDiplomaticContext() : {},
      civContext: civContext
    };

    try {
      const response = await this.brainClient.escalate(payload);

      // Apply relationship shifts
      if (response.relationshipDelta) {
        if (response.relationshipDelta.trust) this.relationships.updateTrust(sender, response.relationshipDelta.trust);
        if (response.relationshipDelta.affinity) this.relationships.updateAffinity(sender, response.relationshipDelta.affinity);
      }

      // Dynamic Goal Update
      if (response.newGoal) {
        this.goalManager.setGoal(response.newGoal);
      }

      // Diplomatic actions (War, Treaties, Currencies)
      if (this.factionManager) {
        if (response.warTarget) {
          this.factionManager.declareWar(response.warTarget, response.warReason || 'Declared via dialogue');
        }
        if (response.currencyAdopted) {
          this.factionManager.recognizeCurrency(response.currencyAdopted);
        }
        if (response.treatyAction) {
          this.factionManager.recordTreaty(sender, response.treatyAction.type, response.treatyAction.honors);
        }
      }

      return response.chatMessage || null;
    } catch (err) {
      logger.error('SocialDialogue', `Failed to generate dialogue: ${err.message}`);
      return null;
    }
  }
}

module.exports = SocialDialogueEngine;
