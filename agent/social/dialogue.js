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

      // Shared Goal Recruitment Evaluation
      const lower = message.toLowerCase();
      if ((lower.includes('shared goal') || lower.includes('community project') || lower.includes('let\'s build') || lower.includes('need volunteers')) &&
          civContext.activeSharedGoals && civContext.activeSharedGoals.length > 0) {
        const tr = this.persona.traits || {};
        const isSociallyInclined = (tr.sociability || 0.5) >= 0.40 || (tr.loyalty || 0.5) >= 0.50;
        const hasCapacity = (this.goalManager.personalGoalLoad || 1) < 2;

        if (isSociallyInclined && hasCapacity) {
          const targetGoal = civContext.activeSharedGoals[0];
          if (targetGoal && targetGoal.id !== this.goalManager.activeSharedGoalId) {
            await this.goalManager.joinSharedGoal(targetGoal.id);
            logger.info('SocialDialogue', `[SHARED GOAL RECRUITMENT] ${this.persona.agentId} joined "${targetGoal.description}" invited by ${sender}`);
            if (!response.chatMessage) {
              response.chatMessage = `Count me in, ${sender}! I'll contribute to "${targetGoal.description}".`;
            }
          }
        }
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
