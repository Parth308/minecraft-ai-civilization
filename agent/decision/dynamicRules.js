const logger = require('../../shared/logger');

const MAX_ACTIVE_RULES = 80;

class DynamicRuleEngine {
  constructor(memoryClient = null) {
    this.learnedRules = [];
    this.memoryClient = memoryClient;
    this.tickCount = 0;
    this._seededOnce = false;
    this._lastSeedTick = 0;
  }

  _ensureCapacity() {
    if (this.learnedRules.length < MAX_ACTIVE_RULES) return;

    let lowestIdx = -1;
    let lowestConf = Infinity;
    for (let i = 0; i < this.learnedRules.length; i++) {
      const r = this.learnedRules[i];
      if (r.deathPenalty?.permanent) continue;
      if (r.confidence < lowestConf) {
        lowestConf = r.confidence;
        lowestIdx = i;
      }
    }

    if (lowestIdx !== -1) {
      const removed = this.learnedRules.splice(lowestIdx, 1)[0];
      logger.info('DynamicRules', `[CAP EVICTION] Evicted lowest-confidence rule ${removed.id} (${removed.action}, conf: ${removed.confidence}) to stay under MAX_ACTIVE_RULES=${MAX_ACTIVE_RULES}`);
    }
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

    const socialActions = new Set(['TRADE', 'TALK', 'COOPERATE']);
    // Initial confidence is intentionally kept BELOW the escalation threshold (0.75)
    // so that learned rules execute directly from accumulated knowledge without
    // needing live LLM confirmation every tick. 0.60 for most actions; 0.52 for
    // social actions (TRADE/TALK) since those require a partner + items — lower
    // initial weight prevents them from dominating over survival actions.
    const initialConfidence = socialActions.has(action) ? 0.52 : 0.60;
    const newRule = {
      id: ruleId,
      patternSituation: situationName,
      action: action,
      confidence: initialConfidence,
      reason: `Learned from Broker LLM: ${decisionData.reason || 'Replicated decision'}`,
      hitCount: 1,
      createdAt: now,
      lastReinforcedAt: now
    };

    this._ensureCapacity();
    this.learnedRules.push(newRule);
    logger.info('DynamicRules', `[RULE REPLICATION] Learned dynamic rule ${ruleId} -> Action '${action}' (Confidence: ${initialConfidence})`);

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
    if (!this.learnedRules || this.learnedRules.length === 0) return candidateActions;

    // Batch pre-computed context checks once per tick (avoids 100x redundant block/item scans)
    const cachedMiningBlock = senses.getNearbyBlock('iron_ore', 16) ||
                              senses.getNearbyBlock('coal_ore', 16) ||
                              senses.getNearbyBlock('log', 24) ||
                              senses.getNearbyBlock('stone', 8) ||
                              senses.getNearbyBlock('copper_ore', 16) ||
                              senses.getNearbyBlock('deepslate', 12);
    const hasCraftable = senses.hasItem('log') || senses.hasItem('oak_planks') ||
                         senses.hasItem('cobblestone') || senses.hasItem('iron_ingot') ||
                         senses.hasItem('raw_iron') || senses.hasItem('stick');
    const hasSmeltable = senses.hasItem('raw_iron') || senses.hasItem('raw_gold') ||
                         senses.hasItem('raw_copper') || senses.hasItem('iron_ore');
    const hasFuel = senses.hasItem('coal') || senses.hasItem('charcoal') || senses.hasItem('log') || senses.hasItem('oak_planks');
    const hasFurnace = !!senses.getNearbyBlock?.('furnace', 16);
    const hasBlocks = senses.hasItem('oak_planks') || senses.hasItem('cobblestone') ||
                      senses.hasItem('dirt') || senses.hasItem('stone') || senses.hasItem('stone_bricks');
    const hostileCount16 = typeof senses.getNearbyHostileMobs === 'function'
      ? (senses.getNearbyHostileMobs(16) || []).length : 0;
    const hostiles12 = typeof senses.getNearbyHostileMobs === 'function'
      ? (senses.getNearbyHostileMobs(12) || []) : [];
    const inWater = senses.isInWater?.();
    const onFire = senses.isOnFire?.();
    const oxygenLow = (senses.bot?.oxygenLevel ?? 20) < 12;
    const lowHealth = stats.health < 12;
    const hasWeapon = senses.hasItem('sword') || senses.hasItem('iron_sword') || senses.hasItem('stone_sword') || senses.hasItem('wooden_sword');
    const hasFood = senses.hasItem('bread') || senses.hasItem('cooked_beef') ||
                    senses.hasItem('cooked_porkchop') || senses.hasItem('apple') || senses.hasItem('baked_potato');
    const allies20 = typeof senses.getNearbyPlayers === 'function'
      ? (senses.getNearbyPlayers(20) || []).filter(p => !/spectate/i.test(p.username)) : [];
    const targets24 = typeof senses.getNearbyPlayers === 'function'
      ? (senses.getNearbyPlayers(24) || []).filter(p => !/spectate/i.test(p.username)) : [];
    const nearHazard = typeof senses.hazardProximity === 'function' && !!senses.hazardProximity(2);
    const unsafeExplore = stats.health < 10 || hostiles12.length >= 2 || onFire || inWater || nearHazard;
    const hasTradable = senses.hasItem('oak_planks') || senses.hasItem('cobblestone') ||
                        senses.hasItem('iron_ore') || senses.hasItem('diamond') ||
                        senses.hasItem('iron_ingot') || senses.hasItem('gold_ingot') ||
                        senses.hasItem('coal') || senses.hasItem('raw_iron') ||
                        senses.hasItem('bread') || senses.hasItem('cooked_beef');

    for (const rule of this.learnedRules) {
      // Disallow executing meta-actions as repeating dynamic rules
      if (rule.action === 'PLAN' || rule.action === 'IDLE') continue;

      let conf = rule.confidence;
      let targetMeta = { ruleId: rule.id };

      // Context-aware validation for learned rules
      if (rule.action === 'MINE') {
        if (!cachedMiningBlock) {
          conf = 0.10; // No valid target nearby
        } else {
          targetMeta = { ...targetMeta, targetBlock: cachedMiningBlock };
        }
      } else if (rule.action === 'CRAFT') {
        if (!hasCraftable) {
          conf = 0.10;
        }
      } else if (rule.action === 'SMELT') {
        if (!hasSmeltable || (!hasFurnace && !hasFuel)) {
          conf = 0.10;
        }
      } else if (rule.action === 'BUILD') {
        if (!hasBlocks) {
          conf = 0.10;
        }
      } else if (rule.action === 'FLEE') {
        // Only trigger FLEE learned rule when there's an actual danger
        if (hostileCount16 === 0 && !inWater && !onFire && !lowHealth && !oxygenLow) {
          conf = 0.05;
        }
      } else if (rule.action === 'FIGHT') {
        if (hostiles12.length === 0 || (stats.health < 8 && !hasWeapon)) {
          conf = 0.05;
        } else if (hostiles12.length > 0) {
          targetMeta = { ...targetMeta, target: hostiles12[0] };
        }
      } else if (rule.action === 'EAT') {
        if (!hasFood || stats.hunger > 90) {
          conf = 0.05;
        }
      } else if (rule.action === 'GUARD') {
        if (allies20.length === 0) {
          conf = 0.10;
        }
      } else if (rule.action === 'EXPLORE' || rule.action === 'WANDER') {
        if (unsafeExplore) conf = 0.10;
      } else if (rule.action === 'TALK') {
        if (targets24.length === 0) conf = 0.10;
      } else if (rule.action === 'TRADE') {
        if (!hasTradable) conf = 0.10;
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

  static categorizeLesson(text) {
    let t = (text || '').toLowerCase();
    t = t.replace(/\[hazard[^\]]*\]\s*/gi, '');
    if (/slain|skeleton|zombie|creeper|spider|hostile|mob|combat|fight|attack|wither|kill|weapon|armor|sword|defend/.test(t)) return 'combat';
    if (/trade|barter|exchange|deal|merchant|shop|ally|trust|social|chat|gossip|talk|faction|treaty|alliance/.test(t)) return 'social';
    if (/mine|ore|diamond|iron|gold|copper|tin|mineral|dig|craft|smelt|furnace|cook|gather|wood|food|bread|wheat|farm|crop|steal|loot|rob/.test(t)) return 'gathering';
    if (/build|shelter|house|wall|fortif|base|camp|place.*torch|torch.*place|air.pocket|settle|town|bunker/.test(t)) return 'building';
    if (/explore|scout|wander|discover|journey|travel|surface|cave|navigate|pathfind/.test(t)) return 'exploration';
    if (/drown|water|swim|suffoc|breath|underwater|starv|hunger|eat|fall|climb|ladder|drop|height|night|unarmored/.test(t)) return 'survival';
    return 'survival';
  }

  /**
   * Returns false for pure noise lessons that provide no actionable DT signal:
   * - Raw coordinate death dumps: "Died to X at X:... Y:... Z:..." with no strategy
   * - Generic mob danger notices: "Killed by zombie — they are dangerous" (DT already knows)
   * Returns true for lessons with verbs/strategies that can inform rule seeding.
   */
  static _isActionableLesson(text) {
    if (!text || typeof text !== 'string') return false;
    const t = text.trim();
    // Pure coordinate death dumps: no actionable content beyond "place was lethal"
    if (/^Died to .+ at X:[\d.-]+\s+Y:[\d.-]+\s+Z:[\d.-]+\s+[\u2014-]/.test(t) &&
        !/avoid|craft|flee|build|torch|shelter|surface|swim|breath|leather|bucket|armor|weapon|equip|smelt|mine|food/i.test(t)) {
      return false;
    }
    // Generic "they are dangerous" mob warnings — static rules already handle these
    if (/^Killed by .+ [\u2014-] they are dangerous, avoid or prepare defenses$/.test(t)) {
      return false;
    }
    return true;
  }

  /**
   * Extracts the intended action verb from lesson text when not explicitly provided
   * in the structured lesson payload.
   */
  static extractActionFromLesson(text) {
    if (!text || typeof text !== 'string') return 'EXPLORE';
    const t = text.toLowerCase();
    if (/flee|retreat|escape|run away|surface|air pocket|avoid.*danger/.test(t)) return 'FLEE';
    if (/craft|make.*tool|make.*armor|make.*sword|make.*pickaxe|plank/.test(t)) return 'CRAFT';
    if (/smelt|furnace|ingot|melt/.test(t)) return 'SMELT';
    if (/mine|dig|ore|coal|iron ore|diamond|stone|gather.*wood|chop/.test(t)) return 'MINE';
    if (/build|shelter|wall|bunker|roof|fortify|torch.*place|place.*torch/.test(t)) return 'BUILD';
    if (/eat|food|hunger|starv|bread|apple|meat/.test(t)) return 'EAT';
    if (/fight|attack|sword|weapon|engage|strike|slay/.test(t)) return 'FIGHT';
    if (/trade|barter|exchange|merchant|deal/.test(t)) return 'TRADE';
    if (/talk|chat|gossip|speak|ally|dialogue/.test(t)) return 'TALK';
    if (/guard|defend.*base|patrol|stand guard/.test(t)) return 'GUARD';
    if (/explore|scout|wander|discover|search/.test(t)) return 'EXPLORE';
    return 'EXPLORE';
  }

  static traitAffinity(category, traits) {
    const affinities = {
      survival:    (traits.caution || 0.5) * 0.6 + (1 - (traits.ambition || 0.5)) * 0.4,
      combat:      (traits.ambition || 0.5) * 0.5 + (1 - (traits.caution || 0.5)) * 0.5,
      social:      (traits.sociability || 0.5) * 0.6 + (traits.greed || 0.5) * 0.4,
      gathering:   (traits.greed || 0.5) * 0.5 + (traits.ambition || 0.5) * 0.5,
      building:    (traits.ambition || 0.5) * 0.5 + (traits.curiosity || 0.5) * 0.5,
      exploration: (traits.curiosity || 0.5) * 0.6 + (traits.openness || 0.5) * 0.4,
    };
    return affinities[category] || 0.5;
  }

  async seedFromSharedLessons(memoryServiceUrl = 'http://localhost:3002', persona = null) {
    if (this._seededOnce && this.tickCount - this._lastSeedTick < 1500) return;
    this._lastSeedTick = this.tickCount;

    try {
      const sinceParam = this._lastSeedTimestamp ? `&since=${this._lastSeedTimestamp}` : '';
      const res = await fetch(`${memoryServiceUrl}/api/ledger/lessons?limit=60${sinceParam}`);
      if (!res.ok) return;
      const data = await res.json();
      // Pre-filter: skip pure coordinate death-dumps and generic mob warnings.
      // These make up ~85% of the ledger but have zero actionable signal for the DT.
      const allLessons = (data.sharedLessons || []).filter(item =>
        item && item.lesson && DynamicRuleEngine._isActionableLesson(item.lesson)
      );
      const lessons = allLessons;

      const traits = persona?.traits || {};
      const enriched = lessons
        .filter(item => item && item.lesson)
        .map(item => {
          const category = DynamicRuleEngine.categorizeLesson(item.lesson);
          const affinity = DynamicRuleEngine.traitAffinity(category, traits);
          const severity = typeof item.severity === 'number' ? item.severity : 0.5;
          const traitScore = severity * 0.4 + affinity * 0.6;
          return { ...item, category, affinity, severity, traitScore };
        });

      const hasPersonality = Object.keys(traits).length > 0;
      const MIN_AFFINITY = hasPersonality ? 0.38 : 0;
      const MAX_SLOTS = 50;
      const MAX_PER_CATEGORY = 12;

      const highAffinity = enriched.filter(i => i.affinity >= MIN_AFFINITY);
      const lowAffinity = enriched.filter(i => i.affinity < MIN_AFFINITY);
      const highByScore = [...highAffinity].sort((a, b) => b.traitScore - a.traitScore);
      const lowBySeverity = [...lowAffinity].sort((a, b) => b.severity - a.severity);

      // Round-robin with per-category cap: prevents one category from filling all slots
      const catCounts = {};
      const combined = [];
      for (const item of [...highByScore, ...lowBySeverity]) {
        const cat = item.category || 'survival';
        if ((catCounts[cat] || 0) >= MAX_PER_CATEGORY) continue;
        combined.push(item);
        catCounts[cat] = (catCounts[cat] || 0) + 1;
        if (combined.length >= MAX_SLOTS) break;
      }

      const existingReasons = new Set(
        (this.learnedRules || []).map(r => r.reason ? r.reason.substring(0, 80) : '')
      );

      let seeded = 0;
      const categoryCount = {};
      const traitAffinities = {};
      for (const item of combined) {
        const fingerprint = `[Shared Civ Lesson from ${item.agentId}]: ${item.lesson}`.substring(0, 80);
        if (existingReasons.has(fingerprint)) continue;

        const ruleId = `shared_${(item.agentId || 'peer').toLowerCase()}_${this.learnedRules.length + 1}`;
        const severity = item.severity || 0.5;
        const baseConfidence = Math.min(0.75, Math.max(0.40, 0.40 + (severity * 0.30)));
        const traitBoost = (item.affinity - 0.5) * 0.30;
        const initialConfidence = Number(Math.min(0.75, Math.max(0.35, baseConfidence + traitBoost)).toFixed(2));

        // Use explicit recommendedAction from structured lesson if available,
        // or extract actionable verb from lesson text. NO MORE DEFAULTING TO 'WANDER'!
        const resolvedAction = item.recommendedAction ||
                               item.context?.recommendedAction ||
                               DynamicRuleEngine.extractActionFromLesson(item.lesson);

        const patternSit = item.triggerCondition ||
                           item.context?.triggerCondition ||
                           (item.category ? `SHARED_${item.category.toUpperCase()}` : 'SHARED_LESSON');

        this._ensureCapacity();
        this.learnedRules.push({
          id: ruleId,
          patternSituation: patternSit,
          action: resolvedAction,
          avoidAction: item.avoidAction || item.context?.avoidAction || null,
          confidence: initialConfidence,
          reason: `[Shared Civ Lesson from ${item.agentId}]: ${item.lesson}`,
          hitCount: 0,
          isSharedPeerLesson: true,
          severity,
          category: item.category,
          traitAffinity: Number(item.affinity.toFixed(2)),
          createdAt: Date.now(),
          lastReinforcedAt: Date.now()
        });
        existingReasons.add(fingerprint);
        categoryCount[item.category] = (categoryCount[item.category] || 0) + 1;
        if (!traitAffinities[item.category]) traitAffinities[item.category] = item.affinity;
        seeded++;
      }

      const skipped = enriched.length - highAffinity.length;
      const breakdown = Object.entries(categoryCount).map(([k, v]) => `${k}:${v}`).join(' ');
      const affinityDebug = Object.entries(traitAffinities).map(([k, v]) => `${k}@${v.toFixed(2)}`).join(' ');
      if (!this._seededOnce) {
        logger.info('DynamicRules', `[SEED COMPLETE] ${seeded} rules seeded (${lessons.length} total${skipped > 0 ? `, ${skipped} low-affinity skipped` : ''}, breakdown: ${breakdown || 'none new'}${affinityDebug ? ` [${affinityDebug}]` : ''})`);
      } else if (seeded > 0) {
        logger.info('DynamicRules', `[SEED UPDATE] ${seeded} new rules (breakdown: ${breakdown}${affinityDebug ? ` [${affinityDebug}]` : ''})`);
      }
      this._seededOnce = true;
      this._lastSeedTimestamp = new Date().toISOString();
    } catch (err) {
      logger.debug('DynamicRules', `Failed to seed shared lessons from ledger: ${err.message}`);
      this._seededOnce = true;
    }
  }

  seedFromGossip(sender, tipMessage, informalConfidence = 0.32) {
    if (!tipMessage) return;
    const ruleId = `gossip_${(sender || 'peer').toLowerCase()}_${this.learnedRules.length + 1}`;
    const cleanTip = tipMessage.replace(/^(hey|yo|look|listen|watch out),?\s*/i, '').substring(0, 120);
    const existing = this.learnedRules.find(r => r.reason.includes(cleanTip));
    if (!existing) {
      const gossipAction = DynamicRuleEngine.extractActionFromLesson(cleanTip);
      this._ensureCapacity();
      this.learnedRules.push({
        id: ruleId,
        patternSituation: 'GOSSIP_HEARING',
        action: gossipAction,
        confidence: informalConfidence, // Gossip seeds lower (0.30-0.35) due to informal channel
        reason: `[Gossiped Advice from ${sender}]: ${cleanTip}`,
        hitCount: 0,
        isGossipLesson: true,
        createdAt: Date.now(),
        lastReinforcedAt: Date.now()
      });
      logger.info('DynamicRules', `[GOSSIP SEED] Seeded informal rule ${ruleId} -> ${gossipAction} from ${sender} with trust ${informalConfidence}`);
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
      this._ensureCapacity();
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
