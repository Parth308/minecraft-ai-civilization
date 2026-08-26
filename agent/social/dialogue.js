const logger = require('../../shared/logger');
const SocietyClient = require('../memory/societyClient');
const EmotionalState = require('../cognition/emotions');
const BeliefNetwork = require('../cognition/beliefs');

class SocialDialogueEngine {
  constructor(brainClient, persona, goalManager, relationshipTracker, factionManager = null, dynamicRuleEngine = null, reflectionEngine = null) {
    this.brainClient = brainClient;
    this.persona = persona;
    this.goalManager = goalManager;
    this.relationships = relationshipTracker;
    this.factionManager = factionManager;
    this.dynamicRuleEngine = dynamicRuleEngine;
    this.reflectionEngine = reflectionEngine;
    this.societyClient = SocietyClient.forAgent(persona.agentId);
  }

  setReflectionEngine(refEngine) {
    this.reflectionEngine = refEngine;
  }

  setDynamicRuleEngine(ruleEngine) {
    this.dynamicRuleEngine = ruleEngine;
  }

  // Detect any third party mentioned in a message: known relationship names
  // plus generic Agent_* name pattern. Excludes self and the sender.
  _extractMentionedAgents(message, sender) {
    const selfId = this.persona.agentId.toLowerCase();
    const mentioned = new Set();
    for (const known of Object.keys(this.relationships.getAll())) {
      if (known.toLowerCase() !== selfId && known.toLowerCase() !== sender.toLowerCase() &&
          message.toLowerCase().includes(known.toLowerCase())) {
        mentioned.add(known);
      }
    }
    for (const match of message.matchAll(/Agent[_ ]([A-Za-z0-9]+)/gi)) {
      const proper = `Agent_${match[1].charAt(0).toUpperCase()}${match[1].slice(1)}`;
      if (proper.toLowerCase() !== selfId && proper.toLowerCase() !== sender.toLowerCase()) {
        mentioned.add(proper);
      }
    }
    return [...mentioned];
  }

  async processIncomingChat(sender, message, civContext = {}) {
    if (!message || sender === this.persona.agentId) return null;

    const relationship = this.relationships.get(sender);

    // Social avoidance: deep distrust means silence. Being ignored is itself a
    // message — and reconciliation later becomes a visible event.
    if ((relationship?.trust ?? 50) < 15 && Math.random() < 0.9) {
      logger.info('SocialDialogue', `[COLD SHOULDER] ${this.persona.agentId} ignores ${sender} (trust ${relationship.trust})`);
      if (!this._ignoredOnce) this._ignoredOnce = new Map();
      if (!this._ignoredOnce.has(sender)) {
        this._ignoredOnce.set(sender, true);
        this.societyClient.postGossip(sender, -0.4, `Refuses to even speak to me anymore`);
      }
      return null;
    }

    logger.info('SocialDialogue', `Processing chat from [${sender}]: "${message}"`);

    // Conversation continuity: per-pair rolling transcript so exchanges reference
    // their own history instead of feeling like isolated slot-machine replies.
    if (!this._conversations) this._conversations = new Map();
    if (!this._conversations.has(sender)) this._conversations.set(sender, []);
    const transcript = this._conversations.get(sender);
    transcript.push({ role: 'them', text: message.slice(0, 200) });
    if (transcript.length > 12) transcript.splice(0, transcript.length - 12);

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

    // 2. Society knowledge snapshot: what have I heard about this speaker?
    // Knowledge only — how it colors the reply is entirely the agent's choice.
    const [society, faithCtx] = await Promise.all([
      this.societyClient.getContext(),
      this.societyClient.faithContext()
    ]);
    const speakerRep = society?.reputationHighlights?.find(r => r.agentId.toLowerCase() === sender.toLowerCase()) || { score: 0 };
    const heardAboutSpeaker = (society?.recentGossip || [])
      .filter(g => g.about.toLowerCase() === sender.toLowerCase())
      .slice(-3);

    // Exposure bookkeeping: hearing an active tradition's name for the first
    // time marks you 'exposed'. Hearing is not believing — states beyond this
    // only move when the agent itself declares them.
    const traditions = Object.keys(society?.conventions || {}).filter(k => k.startsWith('faith.'));
    const lowerMsg0 = message.toLowerCase();
    const newlyExposedTradition = traditions.find(t => {
      const name = t.replace('faith.', '').toLowerCase();
      return name.length > 2 && lowerMsg0.includes(name);
    });
    if (newlyExposedTradition && faithCtx && faithCtx.state === 'none') {
      this.societyClient.setFaith('exposed', newlyExposedTradition.replace('faith.', ''));
      logger.info('SocialDialogue', `[FAITH EXPOSURE] ${this.persona.agentId} first heard of "${newlyExposedTradition}"`);
    }

    // Semantic recall of this specific relationship — debts surface as
    // memories, not obligations; the LLM decides whether to bring them up.
    let sharedHistory = [];
    try {
      const hRes = await fetch(`${process.env.MEMORY_SERVICE_URL || 'http://localhost:3002'}/api/memory/query?agentId=${encodeURIComponent(this.persona.agentId)}&query=${encodeURIComponent(`history with ${sender}: ${message.slice(0, 60)}`)}&limit=3&section=relationships`, { signal: AbortSignal.timeout(3000) });
      if (hRes.ok) sharedHistory = (await hRes.json()).memories || [];
    } catch { /* recall is optional context */ }

    const payload = {
      taskType: 'SOCIAL_CHAT',
      agentId: this.persona.agentId,
      speaker: sender,
      message: message,
      relationship: relationship,
      persona: this.persona.getPersonaPromptContext(),
      goals: this.goalManager.getGoalContext(),
      diplomacy: this.factionManager ? this.factionManager.getDiplomaticContext() : {},
      conversationHistory: transcript.slice(0, -1).slice(-6),
      privateChat: !!civContext.private,
      societyFaith: faithCtx ? { yourState: faithCtx.state, yourTradition: faithCtx.tradition, yourPiety: faithCtx.piety } : null,
      society: {
        speakerReputationScore: speakerRep.score,
        heardAboutSpeaker,
        conventions: society?.conventions ? Object.fromEntries(Object.entries(society.conventions).map(([k, v]) => [k, v.value])) : {},
        openPledges: (society?.openPledges || []).map(p => `${p.agentId}: ${p.description}`),
        communityNotices: (society?.notices || []).slice(0, 5).map(n => `[${n.type}] ${n.title}`),
        justice: {
          accusedOf: (society?.openAccusations || []).filter(a => a.accused.toLowerCase() === this.persona.agentId.toLowerCase()).map(a => `${a.accuser} accuses you of theft @ ${a.chestKey} (${a.claimedItems})`),
          yourAccusationsPending: (society?.openAccusations || []).filter(a => a.accuser.toLowerCase() === this.persona.agentId.toLowerCase()).length
        },
        finance: {
          youOwe: (society?.openDebts || []).filter(d => d.debtor.toLowerCase() === this.persona.agentId.toLowerCase()).map(d => `${d.amount}x ${d.item} to ${d.creditor}`),
          owedToYou: (society?.openDebts || []).filter(d => d.creditor.toLowerCase() === this.persona.agentId.toLowerCase()).map(d => `${d.debtor} owes you ${d.amount}x ${d.item}`),
          speakerOwesYou: (society?.openDebts || []).filter(d => d.creditor.toLowerCase() === this.persona.agentId.toLowerCase() && d.debtor.toLowerCase() === sender.toLowerCase()).map(d => `${d.amount}x ${d.item}`)
        },
        intelMarket: (society?.intelListings || []).slice(0, 5).map(i => `"${i.title}" — ${i.priceAmount}x ${i.priceItem} (seller: ${i.seller})`),
        marketPrices: (society?.marketHighlights || []).slice(0, 6).map(m => `${m.item}: ~${m.average} ${m.unitCurrency} (from ${m.samples} trades)`),
        faith: faithCtx ? {
          yourState: faithCtx.state,
          yourTradition: faithCtx.tradition,
          yourPiety: faithCtx.piety,
          mortalitySalience: faithCtx.mortalitySalience,
          knownDoctrines: faithCtx.doctrines,
          recentScripture: faithCtx.scriptures.map(s2 => `"${s2.body.slice(0, 80)}" — ${s2.author}`),
          note: 'Faith is yours alone. Adopt, preach, doubt, or ignore — nothing obligates you.'
        } : null,
        sharedHistoryWithSpeaker: sharedHistory,
        tensionWithSpeaker: (() => {
          const g = society?.topGrievances || [];
          return g.filter(x => (x.by.toLowerCase() === sender.toLowerCase() && x.against.toLowerCase() === this.persona.agentId.toLowerCase()) ||
                               (x.by.toLowerCase() === this.persona.agentId.toLowerCase() && x.against.toLowerCase() === sender.toLowerCase())).length;
        })()
      },
      emotions: EmotionalState.forAgent(this.persona.agentId).toContext(),
      beliefs: BeliefNetwork.forAgent(this.persona.agentId).toContext(),
      civContext: {
        ...civContext,
        gossipEligibleLesson: gossipLesson ? gossipLesson.lesson : null
      }
    };

    try {
      const response = await this.brainClient.escalate(payload);

      // Apply relationship shifts
      const prevAffinity = relationship?.affinity ?? 50;
      if (response.relationshipDelta) {
        if (response.relationshipDelta.trust) this.relationships.updateTrust(sender, response.relationshipDelta.trust);
        if (response.relationshipDelta.affinity) this.relationships.updateAffinity(sender, response.relationshipDelta.affinity);
      }

      // Sealed-deal handshake: when the reply concludes a concrete exchange,
      // hand it to the barter actuator so talk becomes an actual world trade
      // instead of chat theater.
      if (response.dealAccepted && typeof this.onTradeAgreed === 'function') {
        try {
          this.onTradeAgreed(sender, response.dealAccepted);
        } catch (tradeErr) {
          logger.warn('SocialDialogue', `Trade handshake failed: ${tradeErr.message}`);
        }
      }

      // Dynamic Goal Update
      if (response.newGoal) {
        this.goalManager.setGoal(response.newGoal);
      }

      // Incoming Informal Lesson Hearing from Peer Chat
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

      // Emergent gossip: accusations against third parties damage their reputation
      // in my eyes AND spread through the society record. Trust-gated — I only
      // believe people I trust.
      const isAccusation = lower.includes('untrustworthy') || lower.includes('scam') || lower.includes('thief') ||
                           lower.includes('stole') || lower.includes('lied') || lower.includes('unfair') ||
                           lower.includes('cheat') || lower.includes('betray');
      const isPraise = lower.includes('trustworthy') || lower.includes('helped me') || lower.includes('good trade') ||
                       lower.includes('generous') || lower.includes('saved me') || lower.includes('reliable');

      const mentionedAgents = this._extractMentionedAgents(message, sender);
      const senderTrust = relationship?.trust ?? 50;

      if ((isAccusation || isPraise) && mentionedAgents.length > 0 && senderTrust >= 40) {
        for (const target of mentionedAgents.slice(0, 2)) {
          const sentiment = isAccusation ? -0.7 : 0.5;
          this.relationships.applyGossipPrior(target, sentiment);
          this.societyClient.postGossip(target, sentiment, `${sender} said: "${message.slice(0, 140)}"`);
          logger.info('SocialDialogue', `[GOSSIP PROPAGATED] ${this.persona.agentId} heard ${isAccusation ? 'accusation' : 'praise'} from ${sender} about ${target}`);
        }
      }

      // Direct experience also becomes word-of-mouth: notably good/bad personal
      // interactions get whispered around (agents prefer spreading good news).
      const affinityDelta = (relationship?.affinity ?? 50) - prevAffinity;
      const emo0 = EmotionalState.forAgent(this.persona.agentId);
      const bel0 = BeliefNetwork.forAgent(this.persona.agentId);
      if (affinityDelta <= -10) {
        this.societyClient.postGossip(sender, -0.6, `Treated me badly in conversation`);
        emo0.feelToward(sender, 'anger', 0.25);
        emo0.appraise('betrayal', { actor: sender }, this.persona.traits || {});
        bel0.learnFrom('betrayal');
      } else if (affinityDelta >= 10) {
        emo0.feelToward(sender, 'gratitude', 0.25);
        emo0.appraise('debt_repaid_to_me', { actor: sender }, this.persona.traits || {});
        bel0.learnFrom('gift_received');
        if (Math.random() < 0.30) {
          this.societyClient.postGossip(sender, 0.5, `Pleasant and trustworthy interaction`);
        }
      }

      // Hearing about others stirs feelings too — reputation is emotional
      for (const target of mentionedAgents.slice(0, 2)) {
        if (isAccusation && senderTrust >= 40) {
          emo0.appraise('bad_gossip_heard', { about: target }, this.persona.traits || {});
          bel0.learnFrom('bad_gossip_heard');
        } else if (isPraise && senderTrust >= 40) {
          emo0.appraise('good_gossip_heard', { about: target }, this.persona.traits || {});
          bel0.learnFrom('good_gossip_heard');
        }
      }

      if (response.chatMessage) {
        transcript.push({ role: 'me', text: String(response.chatMessage).slice(0, 200) });
        if (transcript.length > 12) transcript.splice(0, transcript.length - 12);
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

      // Faith actions: conversion/devotion/rites are ALWAYS the agent's own
      // sovereign choice — the LLM emits faithAction only when its inner life
      // genuinely moves it. We merely record what it declares.
      if (response.faithAction && response.faithAction.type) {
        const fa = response.faithAction;
        if (fa.type === 'convert' && fa.tradition) {
          const res = await this.societyClient.setFaith('believer', fa.tradition);
          logger.warn('SocialDialogue', `[FAITH CONVERTED] ${this.persona.agentId} embraced "${fa.tradition}" (${res?.faith?.piety ?? '?'} piety)`);
          if (fa.tenet && !response.chatMessage) {
            response.chatMessage = `I walk with ${fa.tradition} now. ${fa.tenet}`;
          }
        } else if (fa.type === 'devout' && fa.tradition) {
          await this.societyClient.setFaith('devout', fa.tradition);
          logger.warn('SocialDialogue', `[FAITH DEVOUT] ${this.persona.agentId} deepened devotion to "${fa.tradition}"`);
        } else if (fa.type === 'rite') {
          const rite = await this.societyClient.attendRite(fa.riteType || 'prayer');
          logger.info('SocialDialogue', `[FAITH RITE] ${this.persona.agentId} held a rite${rite?.bondedWith?.length ? ` with ${rite.bondedWith.join(', ')}` : ''}`);
        } else if (fa.type === 'abandon') {
          await this.societyClient.setFaith('none', null);
          logger.info('SocialDialogue', `[FAITH ABANDONED] ${this.persona.agentId} let go of belief`);
        }
      }

      // Job board agency: claim posted work, or post paid tasks of your own.
      if (response.jobAction && response.jobAction.type) {
        const ja = response.jobAction;
        if (ja.type === 'claim' && ja.jobId) {
          const res = await this.societyClient.claimJob(ja.jobId);
          if (res.success) logger.warn('SocialDialogue', `[JOB CLAIMED] ${this.persona.agentId} claimed job ${ja.jobId}`);
        } else if (ja.type === 'complete' && ja.jobId) {
          const res = await this.societyClient.resolveJob(ja.jobId, 'complete');
          if (res.success) {
            logger.warn('SocialDialogue', `[JOB DONE] ${this.persona.agentId} completed job ${ja.jobId} (+${res.paid?.amount} ${res.paid?.currency})`);
            EmotionalState.forAgent(this.persona.agentId).appraise('goal_progress', {}, this.persona.traits || {});
          }
        } else if (ja.type === 'post' && ja.title && ja.currency && ja.amount) {
          const res = await this.societyClient.postJob(ja.title, ja.description || '', ja.currency, ja.amount);
          if (res.success) logger.info('SocialDialogue', `[JOB POSTED] ${this.persona.agentId} hired help: "${ja.title}"`);
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
