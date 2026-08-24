const logger = require('../../shared/logger');

class SocialDialogueEngine {
  constructor(brainClient, persona, goalManager, relationshipTracker, factionManager = null, dynamicRuleEngine = null, reflectionEngine = null) {
    this.brainClient = brainClient;
    this.persona = persona;
    this.goalManager = goalManager;
    this.relationships = relationshipTracker;
    this.factionManager = factionManager;
    this.dynamicRuleEngine = dynamicRuleEngine;
    this.reflectionEngine = reflectionEngine;
  }

  setReflectionEngine(refEngine) {
    this.reflectionEngine = refEngine;
  }

  setDynamicRuleEngine(ruleEngine) {
    this.dynamicRuleEngine = ruleEngine;
  }

  async processIncomingChat(sender, message, civContext = {}) {
    if (!message || sender === this.persona.agentId) return null;

    logger.info('SocialDialogue', `Processing chat from [${sender}]: "${message}"`);
    const relationship = this.relationships.get(sender);

    // 1. Organic Gossip/Lesson Leaking for "ask" or "private" lessons
    let gossipLesson = null;
    const refEngine = this.reflectionEngine || civContext.reflectionEngine;
    if (refEngine && typeof refEngine.getLessonForGossip === 'function') {
      const senderTrust = relationship?.trust ?? 50;
      const traits = this.persona.traits || {};
      const canGossip = senderTrust >= 40 || (traits.sociability || 0.5) >= 0.60;
      if (canGossip && Math.random() < 0.40) {
        gossipLesson = refEngine.getLessonForGossip();
      }
    }

    const payload = {
      taskType: 'SOCIAL_CHAT',
      agentId: this.persona.agentId,
      speaker: sender,
      message: message,
      relationship: relationship,
      persona: this.persona.getPersonaPromptContext(),
      goals: this.goalManager.getGoalContext(),
      diplomacy: this.factionManager ? this.factionManager.getDiplomaticContext() : {},
      civContext: {
        ...civContext,
        gossipEligibleLesson: gossipLesson ? gossipLesson.lesson : null
      }
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

      // 2. Incoming Informal Lesson Hearing from Peer Chat
      const ruleEngine = this.dynamicRuleEngine || civContext.dynamicRuleEngine;
      const lower = message.toLowerCase();
      const isSurvivalTip = lower.includes('freeze') || lower.includes('powder snow') || lower.includes('boots') ||
                            lower.includes('lava') || lower.includes('fire') || lower.includes('drown') ||
                            lower.includes('avoid') || lower.includes('watch out') || lower.includes('learned') ||
                            lower.includes('lesson') || lower.includes('tip:');

      if (isSurvivalTip && ruleEngine && typeof ruleEngine.seedFromGossip === 'function') {
        const senderTrust = (relationship?.trust ?? 50) / 100;
        const informalConfidence = Number(Math.min(0.40, Math.max(0.25, 0.30 + (senderTrust - 0.5) * 0.15)).toFixed(2));
        ruleEngine.seedFromGossip(sender, message, informalConfidence);
      }

      // Shared Goal Recruitment Evaluation
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

      // Emergent Gossip & Grudge Propagation
      const isAccusation = lower.includes('untrustworthy') || lower.includes('scam') || lower.includes('thief') || lower.includes('stole') || lower.includes('lied') || lower.includes('unfair');
      if (isAccusation) {
        const candidateNames = ['agent_alpha', 'agent_beta', 'agent_gamma'];
        for (const candidate of candidateNames) {
          if (lower.includes(candidate) && candidate !== this.persona.agentId.toLowerCase() && candidate !== sender.toLowerCase()) {
            const properName = candidate.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('_');
            const senderTrust = relationship?.trust ?? 50;
            if (senderTrust >= 40) {
              this.relationships.updateTrust(properName, -15);
              this.relationships.updateAffinity(properName, -10);
              logger.warn('SocialDialogue', `[GOSSIP & REPUTATION] ${this.persona.agentId} heard accusation from ${sender} against ${properName}. Lowered trust/affinity.`);
            }
            break;
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
