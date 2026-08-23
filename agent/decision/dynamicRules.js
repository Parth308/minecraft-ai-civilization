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
    const situationName = situationPayload.topCandidate?.name || 'GENERIC';
    const ruleId = `learned_${situationName.toLowerCase()}_${this.learnedRules.length + 1}`;
    const now = Date.now();

    // Check if rule pattern was already learned
    const existing = this.learnedRules.find(r => r.patternSituation === situationName && r.action === action);
    if (existing) {
      existing.confidence = Math.min(0.95, Number((existing.confidence + 0.05).toFixed(2)));
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

    // If tactic statement is returned, record it as a durable skill memory
    if (decisionData.tacticLearned && this.memoryClient) {
      this.memoryClient.flushBuffer([{
        type: 'learnedTactic',
        payload: { tactic: decisionData.tacticLearned, action },
        summary: `[skill] Learned survival tactic: ${decisionData.tacticLearned}`
      }]);
    }
  }

  decayRules(maxAgeMs = 1200000) { // 24 sim-hours (20 real minutes)
    const now = Date.now();
    
    for (const rule of this.learnedRules) {
      const lastActive = rule.lastReinforcedAt || rule.createdAt || now;
      if (now - lastActive > maxAgeMs) {
        rule.confidence = Math.max(0, Number((rule.confidence * 0.9).toFixed(2)));
        logger.debug('DynamicRules', `Decayed rule ${rule.id} to confidence ${rule.confidence} (idle for ${Math.round((now - lastActive) / 1000)}s)`);
      }
    }

    // Prune rules with confidence < 0.2
    const beforePrune = this.learnedRules.length;
    this.learnedRules = this.learnedRules.filter(r => {
      if (r.confidence < 0.2) {
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

    rule.lastReinforcedAt = Date.now();
    if (outcomeSuccess) {
      rule.confidence = Math.min(0.98, Number((rule.confidence + 0.05).toFixed(2)));
      rule.hitCount = (rule.hitCount || 0) + 1;
      logger.info('DynamicRules', `[REINFORCE SUCCESS] Bumped rule ${rule.id} confidence to ${rule.confidence} (+0.05)`);
    } else {
      rule.confidence = Math.max(0, Number((rule.confidence - 0.15).toFixed(2)));
      logger.warn('DynamicRules', `[REINFORCE FAILURE] Asymmetric penalty on rule ${rule.id}: confidence dropped to ${rule.confidence} (-0.15)`);
      if (rule.confidence < 0.2) {
        this.learnedRules = this.learnedRules.filter(r => r.id !== ruleId);
        logger.info('DynamicRules', `[PRUNE] Deleted failing rule ${rule.id} (confidence dropped below 0.2)`);
      }
    }
  }

  evaluateDynamicRules(senses, stats) {
    this.tickCount++;
    if (this.tickCount % 500 === 0) {
      this.decayRules();
    }

    const candidateActions = [];

    for (const rule of this.learnedRules) {
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
          this.learnedRules.push({
            id: ruleId,
            patternSituation: situationName,
            action: 'WANDER',
            confidence: 0.40, // Trust others' experience less (0.40) until reinforced
            reason: `[Shared Civ Lesson from ${item.agentId}]: ${item.lesson}`,
            hitCount: 0,
            isSharedPeerLesson: true,
            createdAt: Date.now(),
            lastReinforcedAt: Date.now()
          });
          logger.info('DynamicRules', `[SHARED SEED] Seeded rule ${ruleId} from ${item.agentId}'s shared lesson with initial confidence 0.40`);
        }
      }
    } catch (err) {
      logger.debug('DynamicRules', `Failed to seed shared lessons from ledger: ${err.message}`);
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
        rule.confidence = Math.min(0.98, Math.max(0.1, Number((rule.confidence + delta).toFixed(2))));
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
        confidence: Math.min(0.95, Math.max(0.2, Number(baseConf.toFixed(2)))),
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
