const evaluateEat = require('./rules/eat');
const evaluateFlee = require('./rules/flee');
const evaluateFight = require('./rules/fight');
const evaluateSleep = require('./rules/sleep');
const evaluateMine = require('./rules/mine');
const evaluateCraft = require('./rules/craft');
const evaluateExplore = require('./rules/explore');
const evaluateTrade = require('./rules/trade');
const evaluateTalk = require('./rules/talk');
const evaluateCooperate = require('./rules/cooperate');
const evaluateFarm = require('./rules/farm');
const buildAffordances = require('../perception/affordances');
const DynamicRuleEngine = require('./dynamicRules');
const ConfidenceEvaluator = require('./confidence');
const EscalationManager = require('./escalate');
const SocietyClient = require('../memory/societyClient');
const EmotionalState = require('../cognition/emotions');
const BeliefNetwork = require('../cognition/beliefs');
const logger = require('../../shared/logger');

class DecisionTree {
  constructor(threshold = 0.6, memoryClient = null, brainClient = null) {
    this.confidenceEvaluator = new ConfidenceEvaluator(threshold);
    this.escalator = new EscalationManager(brainClient);
    this.dynamicRuleEngine = new DynamicRuleEngine(memoryClient);
  }

  async evaluate(senses, statsManager, persona = null, agentState = {}) {
    const stats = statsManager.getSummary();

    if (!this._evalCount) this._evalCount = 0;
    this._evalCount++;
    if (this._evalCount % 30 === 0) {
      const agentId = senses.bot?.username || persona?.agentId || 'Agent';
      this.dynamicRuleEngine.pollRuleAdjustments(agentId, process.env.MEMORY_SERVICE_URL || 'http://localhost:3002');
      // Re-seed from the civ ledger so deaths that happened after this agent
      // spawned still propagate as caution rules (spawn-time seeding alone misses them).
      this.dynamicRuleEngine.seedFromSharedLessons(process.env.MEMORY_SERVICE_URL || 'http://localhost:3002');
    }

    const staticCandidates = [
      evaluateFlee(senses, stats),
      evaluateEat(senses, stats),
      evaluateFight(senses, stats, persona),
      evaluateSleep(senses, stats, persona, agentState),
      evaluateCraft(senses, stats),
      evaluateMine(senses, stats),
      evaluateExplore(senses, stats),
      evaluateTrade(senses, stats, persona, agentState),
      evaluateTalk(senses, stats, persona, agentState),
      evaluateCooperate(senses, stats, persona, agentState),
      evaluateFarm(senses, stats, persona, agentState)
    ];

    // Include dynamically learned rules
    const dynamicCandidates = this.dynamicRuleEngine.evaluateDynamicRules(senses, stats);
    const rawCandidates = [...staticCandidates, ...dynamicCandidates];

    // Apply persona trait biases so different agents make distinct behavioral choices
    const candidates = rawCandidates.map(c => {
      let conf = c.confidence;
      if (persona && persona.traits) {
        const tr = persona.traits;
        if (c.name === 'EXPLORE') conf += (tr.curiosity - 0.5) * 0.25;
        if (c.name === 'FLEE') conf += (tr.caution - 0.5) * 0.20;
        if (c.name === 'CRAFT') conf += (tr.caution - 0.5) * 0.18 + (tr.curiosity - 0.5) * 0.10;
        if (c.name === 'MINE') conf += (tr.ambition - 0.5) * 0.20 + (tr.greed - 0.5) * 0.15;
        if (c.name === 'TRADE' || c.name === 'TALK') conf += (tr.sociability - 0.5) * 0.25 + (tr.greed - 0.5) * 0.15;
        if (c.name === 'FIGHT') conf += (0.5 - tr.caution) * 0.20 + (tr.ambition - 0.5) * 0.15;
      }
      return { ...c, confidence: Math.min(0.99, Math.max(0.01, Number(conf.toFixed(2)))) };
    });

    // ── Inner weather & needs: feelings tint confidence, never command. ────────
    const selfId = senses.bot?.username || persona?.agentId || 'Agent';
    const emo = EmotionalState.forAgent(selfId);
    const beliefs = BeliefNetwork.forAgent(selfId);
    for (const c of candidates) {
      if (c.name === 'FLEE') c.confidence += emo.emotions.fear * 0.06;
      if (c.name === 'FIGHT') c.confidence += emo.directedSum('anger') * 0.07;
      if (c.name === 'TALK' || c.name === 'COOPERATE') {
        c.confidence += emo.emotions.gratitude * 0.05;
        if (emo.inGrief()) c.confidence += 0.05; // grief seeks company
      }
      if (c.name === 'EXPLORE') c.confidence += emo.emotions.joy * 0.03;
    }

    // Motivation ladder: when survival is handled, unmet higher needs whisper.
    const survivalFine = stats.health > 14 && stats.hunger > 50;
    if (survivalFine && persona?.traits) {
      const tr = persona.traits;
      if ((tr.sociability ?? 0.5) > 0.6) {
        for (const c of candidates) if (c.name === 'TALK') c.confidence += 0.04; // belonging
      }
      if ((tr.curiosity ?? 0.5) > 0.65 || (tr.ambition ?? 0.5) > 0.7) {
        for (const c of candidates) if (c.name === 'MINE' || c.name === 'CRAFT') c.confidence += 0.04; // mastery
      }
    }

    // Mastery: accumulated learned rules per action = lived competence
    const ruleCounts = {};
    for (const r of (this.dynamicRuleEngine.learnedRules || [])) {
      ruleCounts[r.action] = (ruleCounts[r.action] || 0) + 1;
    }
    for (const c of candidates) {
      if (ruleCounts[c.name]) c.confidence += Math.min(0.04, ruleCounts[c.name] * 0.01);
    }

    // Mob grudges: repeated harm from a creature type hardens into targeted aggression
    for (const c of candidates) {
      if (c.name === 'FIGHT' && c.meta?.target?.name) {
        c.confidence += beliefs.grudgeAgainst(c.meta.target.name) * 0.08;
      }
    }

    // Failure refractory: an action that JUST failed is deprioritized for the
    // immediate re-pick so alternates get a chance — previously a blocked
    // action re-won every tick until the 6-cycle stuck-loop detector fired,
    // burning escalation budget on doomed repeats.
    const lastResult = agentState.lastActionResult;
    if (lastResult && lastResult.action && lastResult.ok === false) {
      for (const c of candidates) {
        if (c.name === lastResult.action) c.confidence -= 0.18;
      }
    }

    // Sort by highest confidence
    candidates.sort((a, b) => b.confidence - a.confidence);
    let topCandidate = candidates[0];

    // Action loop & stagnation detector: prevent infinite repetitive actions.
    // FIGHT excluded on purpose — re-selecting combat every cycle is correct behavior.
    if (!this._actionHistory) this._actionHistory = [];
    if (!this._loopPenalties) this._loopPenalties = new Map(); // action -> penalty until timestamp
    this._actionHistory.push(topCandidate.name);
    if (this._actionHistory.length > 8) this._actionHistory.shift();

    const now = Date.now();
    for (const [action, expiry] of this._loopPenalties) {
      if (now < expiry) {
        for (const c of candidates) {
          if (c.name === action) c.confidence -= 0.35;
        }
      } else {
        this._loopPenalties.delete(action);
      }
    }
    candidates.sort((a, b) => b.confidence - a.confidence);
    const penalizedTop = candidates[0];

    const LOOPABLE_ACTIONS = new Set(['EXPLORE', 'WANDER', 'MINE', 'CRAFT', 'EAT', 'FLEE', 'EQUIP']);
    const isStuckInLoop = (
      this._actionHistory.length >= 6 &&
      this._actionHistory.every(a => a === topCandidate.name) &&
      LOOPABLE_ACTIONS.has(topCandidate.name)
    );

    if (isStuckInLoop) {
      logger.warn('DecisionTree', `[STUCK LOOP DETECTED] Agent repeated '${topCandidate.name}' 6 consecutive cycles without progress. Penalizing action for 30s and escalating.`);
      this._loopPenalties.set(topCandidate.name, Date.now() + 30000);
      this._actionHistory = [];
      if (penalizedTop.name !== topCandidate.name) {
        topCandidate = penalizedTop;
      }
    }

    logger.info('DecisionTree', `Evaluated top action '${topCandidate.name}' with confidence ${topCandidate.confidence} (${topCandidate.reason}) [Learned Rules: ${this.dynamicRuleEngine.getRulesCount()}]`);

    // Environmental Hazard Detection & Counter-Strategy Tagging
    const biomeLower = (agentState.biome || senses.getBiome?.() || '').toLowerCase();
    const isColdBiome = biomeLower.includes('snow') || biomeLower.includes('ice') || biomeLower.includes('frozen') || biomeLower.includes('peak') || biomeLower.includes('cold') || biomeLower.includes('grove');
    const isFreezingRisk = isColdBiome && (stats.health < 20 || (topCandidate.reason || '').toLowerCase().includes('snow') || (topCandidate.reason || '').toLowerCase().includes('freeze'));
    const isFireRisk = senses.isOnFire?.() || agentState.isOnFire || (topCandidate.reason || '').toLowerCase().includes('lava') || (topCandidate.reason || '').toLowerCase().includes('fire');
    const isWaterRisk = (senses.isInWater?.() || agentState.isInWater) && (stats.health < 16 || senses.bot?.oxygenLevel < 15);
    const isMobRisk = (senses.getNearbyHostileMobs?.(8)?.length || 0) >= 2 || (stats.health <= 10 && (senses.getNearbyHostileMobs?.(12)?.length || 0) > 0);

    const isHazard = isFreezingRisk || isFireRisk || isWaterRisk || isMobRisk;
    let hazardType = null;
    let hazardResearchQuery = null;

    if (isFreezingRisk) {
      hazardType = 'powder_snow';
      hazardResearchQuery = 'minecraft powder snow freezing damage counter leather boots';
    } else if (isFireRisk) {
      hazardType = 'lava';
      hazardResearchQuery = 'minecraft lava fire damage water bucket counter';
    } else if (isWaterRisk) {
      hazardType = 'drowning';
      hazardResearchQuery = 'minecraft drowning underwater oxygen torch air pocket counter';
    } else if (isMobRisk) {
      hazardType = 'mob_swarm';
      hazardResearchQuery = 'minecraft hostile mob swarm pillar defense tactics';
    }

    // Society knowledge snapshot (cached ~60s) is only consumed by escalation
    // payloads, so its network calls live inside the escalation branch — they
    // previously ran on every 1s tick even when the decision resolved locally.
    if (this.confidenceEvaluator.shouldEscalate(topCandidate.confidence) || isStuckInLoop || isHazard) {
      const isResearchNeeded = isHazard || (
        topCandidate.name === 'CRAFT' ||
        topCandidate.name === 'BUILD' ||
        topCandidate.reason?.toLowerCase().includes('unknown') ||
        topCandidate.reason?.toLowerCase().includes('recipe') ||
        topCandidate.reason?.toLowerCase().includes('ingredient') ||
        topCandidate.reason?.toLowerCase().includes('cooldown') ||
        topCandidate.reason?.toLowerCase().includes('fail') ||
        agentState.activeGoal?.toLowerCase().includes('craft') ||
        agentState.activeGoal?.toLowerCase().includes('build')
      );

      const taskType = isStuckInLoop ? 'PLAN' : (isHazard || isResearchNeeded ? 'RESEARCH' : (topCandidate.name === 'TALK' ? 'CHAT' : 'REASONING'));
      const taskHint = isStuckInLoop ? 'PLAN' : (isHazard || isResearchNeeded ? 'RESEARCH' : null);

      // Society snapshot + geography-of-memory: awareness, not instruction —
      // the LLM decides what conventions/pledges/reputation mean for this choice.
      let societyContext = null;
      try {
        const societyAgentId = senses.bot?.username || persona?.agentId || 'Agent';
        const client = SocietyClient.forAgent(societyAgentId);
        societyContext = await client.getContext();

        // Geography that remembers: emotional weight of nearby places colors
        // decisions here. The agent feels the history of the ground it stands on.
        const pos = senses.bot?.entity?.position;
        if (pos && typeof pos.x === 'number') {
          client.setLastPosition(pos.x, pos.z);
          const near = await client.placesNear(pos.x, pos.z, 24);
          if (near.length > 0) societyContext.nearbyPlaceMemories = near;
          // Field observations other settlers logged nearby — offered as hints,
          // never instructions.
          try {
            const dRes = await fetch(`${process.env.MEMORY_SERVICE_URL || 'http://localhost:3002'}/api/world/discoveries?x=${Math.round(pos.x)}&z=${Math.round(pos.z)}&radius=64&limit=5`, { signal: AbortSignal.timeout(3000) });
            if (dRes.ok) societyContext.nearbyDiscoveries = (await dRes.json()).discoveries || [];
          } catch { /* optional context */ }
        }
      } catch { /* society knowledge is optional */ }
      
      const payload = {
        agentId: senses.bot?.username || persona?.agentId || 'Agent',
        taskType,
        taskHint,
        isHazard,
        hazardType,
        researchQuery: hazardResearchQuery || null,
        isStuckInLoop,
        stuckWarning: isStuckInLoop ? `You have been looping on '${topCandidate.name}' for multiple cycles without finding trees/progress. Think like a real human player: break this loop. Formulate a multi-step objective, head towards high elevation/vantage point, punch tall grass for seeds, search near rivers, or find companions.` : null,
        topCandidate,
        allCandidates: candidates,
        stats,
        // Full environmental context for rich LLM reasoning
        inventory: agentState.inventory || [],
        position: agentState.position || {},
        biome: agentState.biome || 'unknown',
        timeOfDay: agentState.timeOfDay || 'day',
        isNight: agentState.isNight || false,
        isRaining: agentState.isRaining || false,
        activeGoal: agentState.activeGoal || '',
        nearby: {
          players: senses.getNearbyPlayers ? senses.getNearbyPlayers(32).map(p => p.username) : [],
          hostiles: senses.getNearbyHostileMobs ? senses.getNearbyHostileMobs(16).map(m => m.name || m.mobType || 'mob') : [],
          animals: senses.getNearbyPassiveMobs ? senses.getNearbyPassiveMobs(16).map(m => m.name || m.mobType || 'animal') : [],
          ores: senses.getNearbyOres ? senses.getNearbyOres(20).map(b => `${b.name}@Y${b.position.y}`) : [],
          trees: senses.getNearbyTrees ? senses.getNearbyTrees(16).map(b => `${b.name}@Y${b.position.y}`) : [],
          blocks: [
            senses.getNearbyBlock('crafting_table', 8) ? 'crafting_table nearby' : null,
            senses.getNearbyBlock('furnace', 8) ? 'furnace nearby' : null,
            senses.getNearbyBlock('chest', 12) ? 'chest nearby' : null,
            senses.getNearbyBlock('bed', 10) ? 'bed nearby' : null,
            senses.getNearbyBlock('water', 8) ? 'water nearby' : null
          ].filter(Boolean)
        },
        equipment: agentState.equipment || {},
        lightLevel: senses.getLightLevel ? senses.getLightLevel() : 15,
        isUnderground: senses.isUnderground ? senses.isUnderground() : false,
        recentEvents: (agentState.recentDecisions || []).slice(-5).map(d => `${d.action}(${d.source})`).join(' → '),
        lastActionResult: agentState.lastActionResult || null,
        affordances: buildAffordances.build(senses.bot, senses, stats),
        persona: persona?.getPersonaPromptContext ? persona.getPersonaPromptContext() : (persona || {}),
        society: societyContext ? {
          conventions: Object.fromEntries(Object.entries(societyContext.conventions || {}).map(([k, v]) => [k, v.value])),
          openPledges: (societyContext.openPledges || []).slice(0, 8).map(p => `${p.agentId}: ${p.description}`),
          recentNotices: (societyContext.notices || []).slice(0, 4).map(n => `[${n.type}] ${n.title}`),
          reputationHighlights: societyContext.reputationHighlights || [],
          openAccusations: (societyContext.openAccusations || []).slice(0, 4).map(a => `${a.accuser} vs ${a.accused}: theft @${a.chestKey} (${a.evidenceCount} evidence records)`),
          nearbyPlaceMemories: (societyContext.nearbyPlaceMemories || []).map(p => `(${p.x},${p.z}): ${p.label} [feeling: ${p.sentiment}]`),
          nearbyDiscoveries: (societyContext.nearbyDiscoveries || []).map(d => `${d.item} @(${d.x},${d.z}) — seen by ${d.agentId}`)
        } : null,
        innerLife: {
          mood: emo.mood,
          emotions: emo.top(),
          feelings: emo.directedContext(),
          grieving: emo.inGrief(),
          beliefs: beliefs.toContext()
        }
      };

      const escalationResult = await this.escalator.escalate(payload);

      // Plans outrank reflexes: a fresh LLM-authored goal suppresses ambient
      // night-flee for a few minutes so decisions stick instead of snapping back
      // to instinct every tick. Hazard-driven flee is never suppressed.
      if ((escalationResult.newGoal || isStuckInLoop) && !isHazard) {
        evaluateFlee.setFleeCooldown('night', 3 * 60 * 1000);
        logger.info('DecisionTree', '[PLAN COMMITMENT] New goal suppresses ambient night-flee for 3 minutes');
      }

      // Replicate learned decision into local dynamic rule engine and long-term skills.md!
      this.dynamicRuleEngine.learnRule(payload, escalationResult);

      // If a severe hazard counter-strategy was learned, immediately seed into dynamic rules and share with ledger
      if (isHazard && escalationResult.tacticLearned) {
        const memUrl = process.env.MEMORY_SERVICE_URL || 'http://localhost:3002';
        fetch(`${memUrl}/api/ledger/lessons`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: senses.bot?.username || 'Agent',
            lesson: `[Hazard Counter-Strategy: ${hazardType || 'survival'}] ${escalationResult.tacticLearned}`,
            isPublic: true,
            severity: 0.90,
            confidence: 0.85,
            context: { isHazard: true, hazardType }
          })
        }).catch(() => {});
      }

      // Apply emotion updates if returned by LLM
      if (escalationResult.emotionDelta) {
        if (escalationResult.emotionDelta.anger) statsManager.addAnger(escalationResult.emotionDelta.anger);
        if (escalationResult.emotionDelta.happiness) statsManager.addHappiness(escalationResult.emotionDelta.happiness);
        if (escalationResult.emotionDelta.fatigue) statsManager.addFatigue(escalationResult.emotionDelta.fatigue);
      }

      const isCached = !!escalationResult.cached;
      const isFallback = !!escalationResult.fallback;
      const source = isCached ? 'cache' : (isFallback ? 'fallback' : 'llm');

      return {
        action: escalationResult.action || 'WANDER',
        confidence: topCandidate.confidence,
        escalated: true,
        source,
        speaker: payload.speaker || null,
        whisper: !!(payload.privateChat || escalationResult.whisper),
        provider: escalationResult.provider || (isCached ? 'Cache' : isFallback ? 'Local Fallback' : 'Broker'),
        model: escalationResult.model || null,
        cached: isCached,
        cacheType: escalationResult.cacheType || null,
        fallback: isFallback,
        costUsd: typeof escalationResult.costUsd === 'number' ? escalationResult.costUsd : null,
        latencyMs: typeof escalationResult.latencyMs === 'number' ? escalationResult.latencyMs : null,
        webKnowledgeUsed: !!escalationResult.webKnowledgeUsed,
        reason: escalationResult.reason || (isHazard ? `Autonomous hazard counter-strategy executed for ${hazardType}` : 'Escalated to LLM for autonomous reasoning'),
        tacticLearned: escalationResult.tacticLearned || null,
        chatMessage: escalationResult.chatMessage || null,
        newGoal: escalationResult.newGoal || null,
        steps: escalationResult.steps || null,
        targetResource: escalationResult.targetResource || null,
        buildType: escalationResult.buildType || null,
        tradeOffer: escalationResult.tradeOffer || null,
        meta: {
          ...topCandidate,
          itemToCraft: escalationResult.itemToCraft || topCandidate.itemToCraft,
          targetBlock: topCandidate.targetBlock || null,
          threat: topCandidate.threat || null,
          target: topCandidate.target || null
        },
        allCandidates: candidates.map(c => ({
          name: c.name,
          confidence: c.confidence,
          reason: c.reason || '',
          isDynamic: !!c.isDynamic
        }))
      };
    }

    return {
      action: topCandidate.name,
      confidence: topCandidate.confidence,
      escalated: false,
      source: topCandidate.isDynamic ? 'learned_rule' : 'builtin_rule',
      provider: null,
      model: null,
      cached: false,
      cacheType: null,
      fallback: false,
      costUsd: 0,
      latencyMs: 0,
      reason: topCandidate.reason || '',
      ruleId: topCandidate.ruleId || topCandidate.meta?.ruleId || null,
      meta: topCandidate,
      allCandidates: candidates.map(c => ({
        name: c.name,
        confidence: c.confidence,
        reason: c.reason || '',
        isDynamic: !!c.isDynamic,
        ruleId: c.ruleId || c.meta?.ruleId || null
      }))
    };
  }
}

module.exports = DecisionTree;
