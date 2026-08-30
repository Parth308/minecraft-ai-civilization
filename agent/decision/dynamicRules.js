const logger = require('../../shared/logger');

class DynamicRuleEngine {
  constructor(memoryClient = null) {
    this.learnedRules = [];
    this.memoryClient = memoryClient;
    this.tickCount = 0;
  }

  learnRule(situationPayload, decisionData) {
    if (!decisionData || !decisionData.action || decisionData.fallback) return;

    const action = decisionData.action;
    // PLAN and IDLE are cognitive meta-actions or no-ops, not repeatable physical actuation rules
    if (action === 'PLAN' || action === 'IDLE') return;

    const situationName = situationPayload.topCandidate?.name || 'GENERIC';
    const ruleId = `learned_${situationName.toLowerCase()}_${this.learnedRules.length + 1}`;
    const now = Date.now();

    // Check if rule pattern was already learned
    const existing = this.learnedRules.find(r => r.patternSituation === situationName && r.action === action);
    if (existing) {
      existing.confidence = Math.min(0.85, Number((existing.confidence + 0.05).toFixed(2)));
      existing.hitCount++;
      existing.lastReinforcedAt = now;
      logger.info('DynamicRules', `Reinforced existing learned rule ${existing.id} (confidence: ${existing.confidence})`);
      return;
    }

    const newRule = {
      id: ruleId,
      patternSituation: situationName,
      action: action,
      confidence: 0.72, // Soft learned preference that still allows LLM escalation when needed
      reason: `Learned from Broker LLM: ${decisionData.reason || 'Replicated decision'}`,
      hitCount: 1,
      createdAt: now,
      lastReinforcedAt: now
    };

    this.learnedRules.push(newRule);
    logger.info('DynamicRules', `[RULE REPLICATION] Learned dynamic rule ${ruleId} -> Action '${action}' (Confidence: 0.72)`);

    if (this.memoryClient) {
      if (decisionData.tacticLearned) {
        this.memoryClient.flushBuffer([{
          type: 'learnedTactic',
          payload: { tactic: decisionData.tacticLearned, action },
          summary: `[skill] Learned survival tactic: ${decisionData.tacticLearned}`
        }]);
      }
      if (decisionData.reason && action !== 'WANDER') {
        this.memoryClient.flushBuffer([{
          type: 'learnedSkill',
          payload: { ruleId, action, reason: decisionData.reason },
          summary: `[skill] Rule ${ruleId}: When ${situationName}, do ${action} — ${decisionData.reason}`
        }]);
      }
    }
  }

  decayRules(maxAgeMs = 1200000) { // 24 sim-hours (20 real minutes)
    const now = Date.now();
    
    for (const rule of this.learnedRules) {
      // Death-penalized hazard rules have permanent negative weighting and are exempt from standard upward decay
      if (rule.deathPenalty?.permanent) continue;

      const lastActive = rule.lastReinforcedAt || rule.createdAt || now;
      if (now - lastActive > maxAgeMs) {
        rule.confidence = Math.max(0, Number((rule.confidence * 0.9).toFixed(2)));
        logger.debug('DynamicRules', `Decayed rule ${rule.id} to confidence ${rule.confidence} (idle for ${Math.round((now - lastActive) / 1000)}s)`);
      }
    }

    // Prune rules with confidence < 0.2 or non-actuation actions (exempting permanent death-penalized records kept for causal history)
    const beforePrune = this.learnedRules.length;
    this.learnedRules = this.learnedRules.filter(r => {
      if (r.action === 'PLAN' || r.action === 'IDLE') return false;
      if (r.confidence < 0.2 && !r.deathPenalty?.permanent) {
        logger.info('DynamicRules', `[PRUNE] Pruned stale rule ${r.id} (${r.action}) due to low confidence (${r.confidence})`);
        return false;
      }
      return true;
    });

    if (this.learnedRules.length < beforePrune) {
      logger.info('DynamicRules', `[PRUNE] Removed ${beforePrune - this.learnedRules.length} stale rules. Remaining: ${this.learnedRules.length}`);
    }
  }

  reinforceRule(ruleId, outcomeSuccess) {
    if (!ruleId) return;
    const rule = this.learnedRules.find(r => r.id === ruleId);
    if (!rule) return;

    // Cooldown: don't reinforce same rule within 30 seconds
    const now = Date.now();
    if (now - (rule.lastReinforcedAt || 0) < 30000) return;

    rule.lastReinforcedAt = now;
    if (outcomeSuccess) {
      // Sublinear gain: delta shrinks as confidence rises so a trivially-successful
      // action cannot pump a rule to saturation (gamma hit 72k reinforcements on EXPLORE).
      const gain = Number((0.05 * Math.max(0.1, 1 - rule.confidence)).toFixed(4));
      rule.confidence = Math.min(0.85, Number((rule.confidence + gain).toFixed(2)));
      rule.hitCount = (rule.hitCount || 0) + 1;
      logger.info('DynamicRules', `[REINFORCE SUCCESS] Bumped rule ${rule.id} confidence to ${rule.confidence} (+${gain})`);
    } else {
      rule.confidence = Math.max(0.05, Number((rule.confidence - 0.15).toFixed(2)));
      logger.warn('DynamicRules', `[REINFORCE FAILURE] Asymmetric penalty on rule ${rule.id}: confidence dropped to ${rule.confidence} (-0.15)`);
      if (rule.confidence < 0.2 && !rule.deathPenalty?.permanent) {
        this.learnedRules = this.learnedRules.filter(r => r.id !== ruleId);
        logger.info('DynamicRules', `[PRUNE] Deleted failing rule ${rule.id} (confidence dropped below 0.2)`);
      }
    }
  }

  /**
   * Death-driven negative reinforcement:
   * Walks back the last N decisions leading to death.
   * Full penalty (-0.40) applied to immediate rule active at death.
   * Reduced penalty (-0.15, ~35% strength) applied to 1-2 preceding rules in causal chain.
   * Local-first: immediately changes the agent's own decision tree weighting.
   */
  // Traumatic amnesia: death wipes a random fraction of learned rules —
  // hard-won tactics vanish alongside formal memories.
  forgetFraction(fraction = 0.3) {
    if (!Array.isArray(this.learnedRules) || this.learnedRules.length === 0) return 0;
    const dropCount = Math.floor(this.learnedRules.length * Math.min(0.6, Math.max(0, fraction)));
    if (dropCount <= 0) return 0;
    for (let i = 0; i < dropCount; i++) {
      this.learnedRules.splice(Math.floor(Math.random() * this.learnedRules.length), 1);
    }
    logger.warn('DynamicRules', `[AMNESIA] ${dropCount} learned rules forgotten after trauma`);
    return dropCount;
  }

  penalizeFatalDecisionChain(recentDecisions = [], deathCause = 'hazard') {
    const penalizedRuleIds = [];
    if (!Array.isArray(recentDecisions) || recentDecisions.length === 0) return penalizedRuleIds;

    const chain = recentDecisions.slice(-5).reverse(); // Walk backwards from time of death
    let isImmediate = true;
    let precedingCount = 0;

    for (const step of chain) {
      const ruleId = step.ruleId || step.meta?.ruleId;
      const ruleAction = step.action;
      const targetRule = this.learnedRules.find(r => r.id === ruleId || (r.action === ruleAction && isImmediate));

      if (targetRule) {
        if (!penalizedRuleIds.includes(targetRule.id)) {
          const prevConf = targetRule.confidence;
          if (isImmediate) {
            // Full strength penalty on immediate fatal call
            targetRule.confidence = Math.max(0.05, Number((targetRule.confidence - 0.40).toFixed(2)));
            targetRule.deathPenalty = {
              deathCause,
              penaltyStrength: 0.40,
              permanent: true,
              timestamp: Date.now()
            };
            logger.warn('DynamicRules', `[DEATH PENALTY - IMMEDIATE] Fatal rule ${targetRule.id} (${targetRule.action}) penalized: ${prevConf} -> ${targetRule.confidence} (-0.40) tied to ${deathCause}`);
            penalizedRuleIds.push(targetRule.id);
            isImmediate = false;
          } else if (precedingCount < 2) {
            // Reduced strength penalty (~35%) on preceding 1-2 causal steps
            targetRule.confidence = Math.max(0.10, Number((targetRule.confidence - 0.15).toFixed(2)));
            targetRule.deathPenalty = {
              deathCause,
              penaltyStrength: 0.15,
              permanent: true,
              timestamp: Date.now()
            };
            logger.warn('DynamicRules', `[DEATH PENALTY - CAUSAL CHAIN] Preceding rule ${targetRule.id} (${targetRule.action}) penalized: ${prevConf} -> ${targetRule.confidence} (-0.15) tied to ${deathCause}`);
            penalizedRuleIds.push(targetRule.id);
            precedingCount++;
          }
        }
      }
    }

    return penalizedRuleIds;
  }

  evaluateDynamicRules(senses, stats) {
    this.tickCount++;
    if (this.tickCount % 500 === 0) {
      this.decayRules();
    }

    const candidateActions = [];

    for (const rule of this.learnedRules) {
      // Disallow executing meta-actions as repeating dynamic rules
      if (rule.action === 'PLAN' || rule.action === 'IDLE') continue;

      let conf = rule.confidence;
      let targetMeta = { ruleId: rule.id };

      // Context-aware validation for learned rules
      if (rule.action === 'MINE') {
        const nearbyBlock = senses.getNearbyBlock('iron_ore', 16) ||
                            senses.getNearbyBlock('coal_ore', 16) ||
                            senses.getNearbyBlock('log', 24) ||
                            senses.getNearbyBlock('stone', 8);
        if (!nearbyBlock) {
          conf = 0.10; // No valid target nearby
        } else {
          targetMeta = { ...targetMeta, targetBlock: nearbyBlock };
        }
      } else if (rule.action === 'CRAFT') {
        if (!senses.hasItem('log') && !senses.hasItem('oak_planks') && !senses.hasItem('cobblestone')) {
          conf = 0.10;
        }
      } else if (rule.action === 'EXPLORE' || rule.action === 'WANDER') {
        // Exploration is trivially "successful", so an unvalidated explore rule
        // saturates confidence and crowds out every other action. Suppress it
        // whenever survival or combat should take priority.
        const hostileCount = typeof senses.getNearbyHostileMobs === 'function'
          ? (senses.getNearbyHostileMobs(12) || []).length : 0;
        const nearHazard = typeof senses.hazardProximity === 'function' &&
                           !!senses.hazardProximity(2);
        const unsafe = stats.health < 10 ||
                       hostileCount >= 2 ||
                       senses.isOnFire?.() ||
                       senses.isInWater?.() ||
                       nearHazard;
        if (unsafe) conf = 0.10;
      } else if (rule.action === 'TALK') {
        // Learned talk rules looped endlessly at non-citizens (SpectatorBot)
        // when no real conversation partner was around. Only fire when a
        // genuine chat target is within conversational range.
        const targets = typeof senses.getNearbyPlayers === 'function'
          ? (senses.getNearbyPlayers(24) || []).filter(p => !/spectate/i.test(p.username)) : [];
        if (targets.length === 0) conf = 0.10;
      }

      candidateActions.push({
        name: rule.action,
        confidence: conf,
        meta: targetMeta,
        reason: `[Dynamic Learned Rule: ${rule.id}] ${rule.reason}`,
        isDynamic: true,
        ruleId: rule.id
      });
    }

    return candidateActions;
  }

  async seedFromSharedLessons(memoryServiceUrl = 'http://localhost:3002') {
    try {
      const res = await fetch(`${memoryServiceUrl}/api/ledger/lessons`);
      if (!res.ok) return;
      const data = await res.json();
      const lessons = data.sharedLessons || [];
      for (const item of lessons) {
        if (!item || !item.lesson) continue;
        const situationName = 'SHARED_LESSON';
        const ruleId = `shared_${(item.agentId || 'peer').toLowerCase()}_${this.learnedRules.length + 1}`;
        const existing = this.learnedRules.find(r => r.reason.includes(item.lesson));
        if (!existing) {
          // Public/severe hazard lessons seed with higher trust (0.60-0.70) than baseline (0.40)
          const severity = typeof item.severity === 'number' ? item.severity : 0.5;
          const initialConfidence = Number(Math.min(0.75, Math.max(0.40, 0.40 + (severity * 0.30))).toFixed(2));

          this.learnedRules.push({
            id: ruleId,
            patternSituation: situationName,
            action: 'WANDER',
            confidence: initialConfidence,
            reason: `[Shared Civ Lesson from ${item.agentId}]: ${item.lesson}`,
            hitCount: 0,
            isSharedPeerLesson: true,
            severity,
            createdAt: Date.now(),
            lastReinforcedAt: Date.now()
          });
          logger.info('DynamicRules', `[SHARED SEED - SEVERITY WEIGHTED] Seeded rule ${ruleId} from ${item.agentId}'s shared lesson with trust ${initialConfidence} (severity: ${severity})`);
        }
      }
    } catch (err) {
      logger.debug('DynamicRules', `Failed to seed shared lessons from ledger: ${err.message}`);
    }
  }

  seedFromGossip(sender, tipMessage, informalConfidence = 0.32) {
    if (!tipMessage) return;
    const ruleId = `gossip_${(sender || 'peer').toLowerCase()}_${this.learnedRules.length + 1}`;
    const cleanTip = tipMessage.replace(/^(hey|yo|look|listen|watch out),?\s*/i, '').substring(0, 120);
    const existing = this.learnedRules.find(r => r.reason.includes(cleanTip));
    if (!existing) {
      this.learnedRules.push({
        id: ruleId,
        patternSituation: 'GOSSIP_HEARING',
        action: 'WANDER',
        confidence: informalConfidence, // Gossip seeds lower (0.30-0.35) due to informal channel
        reason: `[Gossiped Advice from ${sender}]: ${cleanTip}`,
        hitCount: 0,
        isGossipLesson: true,
        createdAt: Date.now(),
        lastReinforcedAt: Date.now()
      });
      logger.info('DynamicRules', `[GOSSIP SEED] Seeded informal rule ${ruleId} from ${sender} with trust ${informalConfidence}`);
    }
  }

  async pollRuleAdjustments(agentId, memoryServiceUrl = 'http://localhost:3002') {
    if (!agentId) return;
    try {
      const res = await fetch(`${memoryServiceUrl}/api/rules/adjust/${agentId}`);
      if (!res.ok) return;
      const data = await res.json();
      const adjustments = data.adjustments || [];
      for (const adj of adjustments) {
        this.applyRuleAdjustment(adj);
      }
    } catch (err) {
      logger.debug('DynamicRules', `Failed to poll rule adjustments for ${agentId}: ${err.message}`);
    }
  }

  applyRuleAdjustment(adj) {
    if (!adj || !adj.ruleType) return;
    const matching = this.learnedRules.filter(r => r.action === adj.ruleType || r.patternSituation?.includes(adj.ruleType));
    if (matching.length > 0) {
      for (const rule of matching) {
        const delta = adj.recommendedConfidenceDelta || 0;
        rule.confidence = Math.min(0.85, Math.max(0.1, Number((rule.confidence + delta).toFixed(2))));
        rule.lastReinforcedAt = Date.now();
        logger.info('DynamicRules', `[FEEDBACK LOOP] Applied adjustment to rule ${rule.id} (${rule.action}): ${delta > 0 ? '+' : ''}${delta} -> New confidence: ${rule.confidence} (${adj.reason})`);
      }
    } else if (adj.recommendedConfidenceDelta !== 0) {
      // Create new dynamic rule with the suggested delta if none existed
      const ruleId = `macro_${adj.ruleType.toLowerCase()}_${this.learnedRules.length + 1}`;
      const baseConf = 0.50 + adj.recommendedConfidenceDelta;
      this.learnedRules.push({
        id: ruleId,
        patternSituation: adj.situationPattern || adj.ruleType,
        action: adj.ruleType,
        confidence: Math.min(0.85, Math.max(0.2, Number(baseConf.toFixed(2)))),
        reason: `[Macro Feedback]: ${adj.reason}`,
        hitCount: 0,
        createdAt: Date.now(),
        lastReinforcedAt: Date.now()
      });
      logger.info('DynamicRules', `[FEEDBACK LOOP] Created dynamic rule ${ruleId} (${adj.ruleType}) with confidence ${baseConf.toFixed(2)} based on reflection feedback.`);
    }
  }

  getRulesCount() {
    return this.learnedRules.length;
  }
}

module.exports = DynamicRuleEngine;
