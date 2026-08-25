const fs = require('fs');
const path = require('path');
const logger = require('../../../shared/logger');
const detailedLogger = require('../../../shared/detailedLogger');

const LEDGER_PATH = path.join(__dirname, 'ledger.json');

class CivilizationLedger {
  constructor() {
    this.ensureFileExists();
  }

  ensureFileExists() {
    const dir = path.dirname(LEDGER_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(LEDGER_PATH)) {
      const initial = {
        currencies: [],
        settlements: [],
        factions: [],
        laws: [],
        sharedLessons: [],
        trades: [],
        debts: [],
        territoryClaims: [],
        sharedGoals: [],
        chronicleEntries: [],
        updatedAt: new Date().toISOString()
      };
      fs.writeFileSync(LEDGER_PATH, JSON.stringify(initial, null, 2), 'utf-8');
    }
  }

  getLedger() {
    this.ensureFileExists();
    try {
      const data = JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf-8'));
      if (!Array.isArray(data.sharedLessons)) data.sharedLessons = [];
      if (!Array.isArray(data.unsharedLessons)) data.unsharedLessons = [];
      if (!Array.isArray(data.deaths)) data.deaths = [];
      if (!Array.isArray(data.trades)) data.trades = [];
      if (!Array.isArray(data.debts)) data.debts = [];
      if (!Array.isArray(data.territoryClaims)) data.territoryClaims = [];
      if (!Array.isArray(data.sharedGoals)) data.sharedGoals = [];
      if (!Array.isArray(data.chronicleEntries)) data.chronicleEntries = [];
      return data;
    } catch (err) {
      logger.error('CivLedger', 'Failed to read ledger file', err);
      return { currencies: [], settlements: [], factions: [], laws: [], sharedLessons: [], unsharedLessons: [], deaths: [], trades: [], debts: [], territoryClaims: [], sharedGoals: [], chronicleEntries: [] };
    }
  }

  saveLedger(data) {
    data.updatedAt = new Date().toISOString();
    fs.writeFileSync(LEDGER_PATH, JSON.stringify(data, null, 2), 'utf-8');
  }

  addChronicleEntry(headline, detail, relatedAgents = [], eventType = 'milestone') {
    const data = this.getLedger();
    if (!Array.isArray(data.chronicleEntries)) data.chronicleEntries = [];
    const entry = {
      id: `chron_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      headline,
      detail,
      relatedAgents: Array.isArray(relatedAgents) ? relatedAgents : [relatedAgents],
      eventType,
      timestamp: new Date().toISOString()
    };
    data.chronicleEntries.push(entry);
    this.saveLedger(data);
    logger.info('CivLedger', `[CHRONICLE] 📜 "${headline}"`);
    detailedLogger.logCivilizationMilestone('chronicle_entry', headline, entry);
    return entry;
  }

  getChronicle(limit = 100) {
    const entries = this.getLedger().chronicleEntries || [];
    return entries.slice().reverse().slice(0, limit);
  }

  createSharedGoal(creatorAgentId, description, requiredAgents = 2, requiredContributions = [{ item: 'cobblestone', count: 16 }], location = null) {
    const data = this.getLedger();
    if (!Array.isArray(data.sharedGoals)) data.sharedGoals = [];

    const goal = {
      id: `sgoal_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      creator: creatorAgentId,
      description,
      requiredAgents: Math.max(2, requiredAgents),
      participants: [creatorAgentId],
      requiredContributions: Array.isArray(requiredContributions) ? requiredContributions : [{ item: 'cobblestone', count: 16 }],
      contributions: {},
      location: location || { x: 0, y: 64, z: 0 },
      status: 'active',
      createdAt: new Date().toISOString()
    };
    data.sharedGoals.push(goal);
    this.saveLedger(data);
    logger.info('CivLedger', `[SHARED GOAL PROPOSED] ${creatorAgentId} proposed collaborative goal: "${description}" (${goal.id})`);
    detailedLogger.logCivilizationMilestone('shared_goal_proposed', `Shared goal proposed by ${creatorAgentId}`, goal);
    this.addChronicleEntry(`The Grand Undertaking: "${description}" Proposed`, `Agent ${creatorAgentId} rallied the community to coordinate on a shared goal requiring ${goal.requiredAgents} agents.`, [creatorAgentId], 'shared_goal_proposed');
    return { success: true, goal };
  }

  recordDeath(agentId, deathCause, position = {}, penalizedRules = [], scarSummary = '') {
    const data = this.getLedger();
    if (!Array.isArray(data.deaths)) data.deaths = [];
    const entry = {
      id: `death_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      agentId,
      deathCause: deathCause || 'hazard',
      position,
      penalizedRules: Array.isArray(penalizedRules) ? penalizedRules : [],
      scarSummary,
      timestamp: new Date().toISOString()
    };
    data.deaths.push(entry);
    this.saveLedger(data);
    logger.warn('CivLedger', `[DEATH RECORDED] ${agentId} died from ${entry.deathCause}. Penalized rules: ${entry.penalizedRules.join(', ') || 'none'}`);
    this.addChronicleEntry(`Fallen Settler: ${agentId} succumbed to ${entry.deathCause}`, `Agent ${agentId} was felled by ${entry.deathCause} at X:${position.x ?? '?'} Y:${position.y ?? '?'} Z:${position.z ?? '?'}. Behavioral scar added.`, [agentId], 'agent_death');
    return entry;
  }

  getDeaths() {
    return this.getLedger().deaths || [];
  }

  joinSharedGoal(goalId, agentId) {
    const data = this.getLedger();
    if (!Array.isArray(data.sharedGoals)) data.sharedGoals = [];
    const goal = data.sharedGoals.find(g => g.id === goalId && g.status === 'active');
    if (!goal) return { success: false, reason: 'Active shared goal not found' };

    if (!goal.participants.includes(agentId)) {
      goal.participants.push(agentId);
      this.saveLedger(data);
      logger.info('CivLedger', `[SHARED GOAL JOINED] ${agentId} joined shared goal: "${goal.description}"`);
      detailedLogger.logCivilizationMilestone('shared_goal_joined', `${agentId} joined goal ${goalId}`, { goalId, agentId });
      this.addChronicleEntry(`Reinforcements Arrive: ${agentId} Joins "${goal.description}"`, `${agentId} joined ${goal.creator}'s collaborative project.`, [agentId, goal.creator], 'shared_goal_joined');
    }
    return { success: true, goal };
  }

  contributeToSharedGoal(goalId, agentId, itemName, count = 1) {
    const data = this.getLedger();
    if (!Array.isArray(data.sharedGoals)) data.sharedGoals = [];
    const goal = data.sharedGoals.find(g => g.id === goalId && g.status === 'active');
    if (!goal) return { success: false, reason: 'Active shared goal not found' };

    if (!goal.participants.includes(agentId)) {
      goal.participants.push(agentId);
    }
    if (!goal.contributions[agentId]) {
      goal.contributions[agentId] = [];
    }

    const existingItem = goal.contributions[agentId].find(i => i.item === itemName);
    if (existingItem) {
      existingItem.count += count;
    } else {
      goal.contributions[agentId].push({ item: itemName, count });
    }

    // Check if goal requirements are fulfilled
    let allFulfilled = true;
    for (const req of goal.requiredContributions) {
      let delivered = 0;
      for (const p of Object.values(goal.contributions)) {
        const found = p.find(i => i.item === req.item);
        if (found) delivered += found.count;
      }
      if (delivered < req.count) {
        allFulfilled = false;
        break;
      }
    }

    if (allFulfilled && goal.participants.length >= goal.requiredAgents) {
      goal.status = 'completed';
      goal.completedAt = new Date().toISOString();
      logger.info('CivLedger', `[SHARED GOAL COMPLETED] 🎉 Shared goal "${goal.description}" fully achieved by ${goal.participants.join(', ')}!`);
      detailedLogger.logCivilizationMilestone('shared_goal_completed', `Goal "${goal.description}" completed!`, goal);
      this.addChronicleEntry(`Civilization Milestone: "${goal.description}" Accomplished!`, `Through coordinated collaboration, ${goal.participants.join(' and ')} successfully finished "${goal.description}"!`, goal.participants, 'shared_goal_completed');

      // Fairness report: freeloaders who joined but never contributed become
      // public knowledge — social pressure replaces mechanical enforcement.
      try {
        const { sharedStore } = require('../../society');
        const contributors = new Set(Object.keys(goal.contributions || {}));
        for (const p of goal.participants) {
          const gave = (goal.contributions[p] || []).reduce((sum, i) => sum + (i.count || 0), 0);
          if (!contributors.has(p)) {
            sharedStore.addGrievance('community', p, `Took part in "${goal.description}" but contributed nothing`, 2);
            sharedStore.addGossip('community', p, -0.5, `Rode on the coattails of others during "${goal.description}"`);
          } else {
            const topGave = Math.max(...[...contributors].filter(c => c !== p).map(c => (goal.contributions[c] || []).reduce((s2, i2) => s2 + (i2.count || 0), 0)), 0);
            if (gave > 0 && gave >= topGave) {
              sharedStore.addGossip('community', p, 0.6, `Carried the team in "${goal.description}"`);
            }
          }
        }
      } catch (fairErr) {
        logger.debug('CivLedger', `Fairness report skipped: ${fairErr.message}`);
      }
    }

    this.saveLedger(data);
    logger.info('CivLedger', `[SHARED GOAL CONTRIBUTION] ${agentId} contributed ${count}x ${itemName} to "${goal.description}" (Status: ${goal.status})`);
    return { success: true, goal, completed: goal.status === 'completed' };
  }

  getSharedGoals() {
    return this.getLedger().sharedGoals || [];
  }

  claimTerritory(agentId, origin, radius = 20, structureType = 'shelter') {
    if (!agentId || !origin || typeof origin.x !== 'number' || typeof origin.z !== 'number') {
      return { success: false, reason: 'Invalid agentId or origin coordinates' };
    }
    const data = this.getLedger();
    if (!Array.isArray(data.territoryClaims)) data.territoryClaims = [];

    // Check spatial collision with existing claims
    for (const existing of data.territoryClaims) {
      if (existing.agentId === agentId) continue; // Agent expanding own claim or contiguous build
      const dist = Math.hypot(existing.origin.x - origin.x, existing.origin.z - origin.z);
      const minDistance = (existing.radius || 20) + radius;
      if (dist < minDistance) {
        logger.warn('CivLedger', `[TERRITORY CONFLICT] ${agentId} build at (${origin.x}, ${origin.z}) encroaches on ${existing.agentId}'s claim (Distance: ${Math.round(dist)}m < required ${minDistance}m)`);
        return {
          success: false,
          conflict: true,
          owner: existing.agentId,
          existingClaim: existing,
          distance: Math.round(dist),
          requiredDistance: minDistance
        };
      }
    }

    const claim = {
      id: `claim_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      agentId,
      origin: { x: Math.round(origin.x), y: Math.round(origin.y || 64), z: Math.round(origin.z) },
      radius,
      structureType,
      claimedAt: new Date().toISOString()
    };
    data.territoryClaims.push(claim);
    this.saveLedger(data);
    logger.info('CivLedger', `[TERRITORY CLAIMED] ${agentId} claimed ${structureType} at (${claim.origin.x}, ${claim.origin.y}, ${claim.origin.z}) [Radius: ${radius}m]`);
    detailedLogger.logCivilizationMilestone('territory_claimed', `Territory claimed by ${agentId}`, claim);
    this.addChronicleEntry(`Territorial Settlement: ${agentId} Founds ${structureType}`, `Agent ${agentId} staked territorial sovereignty over coordinates (${claim.origin.x}, ${claim.origin.y}, ${claim.origin.z}) with a boundary radius of ${radius}m.`, [agentId], 'territory_claimed');
    return { success: true, claim };
  }

  getTerritoryAt(x, y, z) {
    const claims = this.getTerritoryClaims();
    for (const c of claims) {
      const dist = Math.hypot(c.origin.x - x, c.origin.z - z);
      if (dist <= (c.radius || 20)) {
        return c;
      }
    }
    return null;
  }

  getTerritoryClaims() {
    return this.getLedger().territoryClaims || [];
  }

  recordTrade(agentA, agentB, itemsGiven, itemsReceived, fairnessScore = 1.0) {
    const data = this.getLedger();
    if (!Array.isArray(data.trades)) data.trades = [];
    const entry = {
      id: `trade_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      agentA,
      agentB,
      itemsGiven,
      itemsReceived,
      fairnessScore: typeof fairnessScore === 'number' ? Number(fairnessScore.toFixed(2)) : 1.0,
      timestamp: new Date().toISOString()
    };
    data.trades.push(entry);
    this.saveLedger(data);
    logger.info('CivLedger', `[TRADE RECORDED] ${agentA} <-> ${agentB}: ${JSON.stringify(itemsGiven)} for ${JSON.stringify(itemsReceived)} (Fairness: ${entry.fairnessScore})`);
    detailedLogger.logCivilizationMilestone('trade_executed', `Trade between ${agentA} and ${agentB}`, entry);

    // Handing goods to a creditor auto-settles a matching open IOU —
    // debts clear through real deliveries, not just promises.
    const delivered = Array.isArray(itemsGiven) ? itemsGiven : [];
    const settledDebts = [];
    if (!Array.isArray(data.debts)) data.debts = [];
    for (const g of delivered) {
      const match = data.debts.find(d =>
        d.status === 'open' &&
        d.debtorId === agentA &&
        d.creditorId === agentB &&
        d.item === g.item &&
        g.count >= d.count
      );
      if (match) {
        match.status = 'settled';
        match.settledAt = new Date().toISOString();
        match.settledViaTrade = entry.id;
        settledDebts.push(match);
        logger.info('CivLedger', `[DEBT SETTLED] ${match.debtorId} repaid ${match.count}x ${match.item} to ${match.creditorId} via trade ${entry.id}`);
        this.addChronicleEntry(`Debt Cleared: ${match.debtorId} Repays ${match.creditorId}`, `${match.count}x ${match.item} delivered, honouring the outstanding obligation.`, [match.debtorId, match.creditorId], 'debt_settled');
      }
    }

    this.saveLedger(data);

    // Barter cross-rates feed the market price memory — economies develop
    // a sense of "what things usually go for" from real observed trades.
    try {
      const { sharedStore } = require('../../society');
      const given = Array.isArray(itemsGiven) ? itemsGiven : [];
      const received = Array.isArray(itemsReceived) ? itemsReceived : [];
      for (const g of given) {
        for (const r of received) {
          if (!g.item || !r.item || !g.count || !r.count) continue;
          sharedStore.recordPrice(g.item, r.count / g.count, r.item, `trade:${entry.id}`);
          sharedStore.recordPrice(r.item, g.count / r.count, g.item, `trade:${entry.id}`);
        }
      }
    } catch (priceErr) {
      logger.debug('CivLedger', `Price memory skipped: ${priceErr.message}`);
    }
    return { saved: true, trade: entry, settledDebts };
  }

  getTrades() {
    return this.getLedger().trades || [];
  }

  addDebt(creditorId, debtorId, item, count, reason = '') {
    const data = this.getLedger();
    if (!Array.isArray(data.debts)) data.debts = [];
    const debt = {
      id: `debt_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      creditorId,
      debtorId,
      item,
      count: parseInt(count, 10) || 1,
      reason: String(reason || '').slice(0, 200),
      status: 'open',
      createdAt: new Date().toISOString()
    };
    data.debts.push(debt);
    this.saveLedger(data);
    logger.info('CivLedger', `[DEBT RECORDED] ${debtorId} owes ${creditorId}: ${debt.count}x ${item}${reason ? ` (${reason})` : ''}`);
    this.addChronicleEntry(`IOU Struck: ${debtorId} Owes ${creditorId}`, `${debt.count}x ${item} promised${reason ? ` — "${reason}"` : ''}.`, [creditorId, debtorId], 'debt_created');
    return { saved: true, debt };
  }

  settleDebt(debtId, settledBy) {
    const data = this.getLedger();
    if (!Array.isArray(data.debts)) return { saved: false, reason: 'No debts recorded' };
    const debt = data.debts.find(d => d.id === debtId && d.status === 'open');
    if (!debt) return { saved: false, reason: 'Open debt not found' };
    debt.status = 'settled';
    debt.settledAt = new Date().toISOString();
    if (settledBy) debt.settledBy = settledBy;
    this.saveLedger(data);
    logger.info('CivLedger', `[DEBT SETTLED] ${debt.debtorId} repaid ${debt.count}x ${debt.item} to ${debt.creditorId}`);
    this.addChronicleEntry(`Debt Cleared: ${debt.debtorId} Repays ${debt.creditorId}`, `${debt.count}x ${debt.item} obligation honourably discharged.`, [debt.creditorId, debt.debtorId], 'debt_settled');
    return { saved: true, debt };
  }

  getOpenDebts(agentId) {
    const data = this.getLedger();
    if (!Array.isArray(data.debts)) return [];
    return data.debts.filter(d => d.status === 'open' && (d.creditorId === agentId || d.debtorId === agentId));
  }

  recordLesson(agentId, lesson, isPublic = true, context = {}, confidence = 0.8, severity = 0.5, status = null) {
    if (!lesson) return { saved: false, reason: 'Empty lesson' };
    const data = this.getLedger();
    if (!Array.isArray(data.sharedLessons)) data.sharedLessons = [];
    if (!Array.isArray(data.unsharedLessons)) data.unsharedLessons = [];

    const isPublicBool = isPublic === true || isPublic === 'true';
    const lessonStatus = status || (isPublicBool ? 'shared' : 'unshared_private');

    const entry = {
      id: `lsn_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      agentId,
      lesson,
      context,
      severity: typeof severity === 'number' ? Number(severity.toFixed(2)) : 0.5,
      confidence: typeof confidence === 'number' ? Number(confidence.toFixed(2)) : (isPublicBool ? 0.8 : 0.4),
      isPublic: isPublicBool,
      status: lessonStatus,
      timestamp: new Date().toISOString()
    };

    if (isPublicBool) {
      data.sharedLessons.push(entry);
      this.saveLedger(data);
      logger.info('CivLedger', `[SHARED LESSON] ${agentId} publicly shared hard-won lesson (severity: ${entry.severity}): "${lesson}"`);
      detailedLogger.logCivilizationMilestone('lesson_shared', `Lesson shared publicly by ${agentId}`, { lesson, confidence: entry.confidence, severity: entry.severity });
      this.addChronicleEntry(`Emergent Wisdom: ${agentId} Shares Philosophy`, `A foundational lesson was entered into global civilization knowledge: "${lesson}"`, [agentId], 'wisdom_shared');
      return { saved: true, sharedPublicly: true, lesson: entry };
    } else {
      // Diagnostic tracking for known-but-unshared lessons
      data.unsharedLessons.push(entry);
      if (data.unsharedLessons.length > 100) data.unsharedLessons.shift();
      this.saveLedger(data);
      logger.info('CivLedger', `[KNOWN-BUT-UNSHARED LESSON] ${agentId} lesson registered as unshared diagnostic (status: ${lessonStatus}, severity: ${entry.severity}): "${lesson}"`);
      return { saved: true, sharedPublicly: false, status: lessonStatus, lesson: entry };
    }
  }

  getUnsharedLessons() {
    const data = this.getLedger();
    return data.unsharedLessons || [];
  }

  recordTreaty(proposer, target, treatyType, honorsStatus = true) {
    const data = this.getLedger();
    if (!Array.isArray(data.laws)) data.laws = [];
    const lawEntry = {
      id: `treaty_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      proposer,
      target,
      treatyType,
      honorsStatus,
      timestamp: new Date().toISOString()
    };
    data.laws.push(lawEntry);
    this.saveLedger(data);
    logger.info('CivLedger', `[TREATY RATIFIED] ${proposer} and ${target} established ${treatyType} (Honors: ${honorsStatus})`);
    detailedLogger.logCivilizationMilestone('treaty_ratified', `Treaty ratified between ${proposer} and ${target}`, lawEntry);
    const chronicle = this.addChronicleEntry(`Diplomatic Accord: ${proposer} & ${target} Sign ${treatyType}`, `An official accord (${treatyType}) was established between ${proposer} and ${target}.`, [proposer, target], 'treaty_signed');
    return { success: true, treaty: lawEntry, chronicle };
  }

  getSharedLessons() {
    const data = this.getLedger();
    return data.sharedLessons || [];
  }

  recordCurrency(name, establishedBy, description) {
    const data = this.getLedger();
    const existing = data.currencies.find(c => c.name.toLowerCase() === name.toLowerCase());
    if (!existing) {
      data.currencies.push({ name, establishedBy, description, date: new Date().toISOString() });
      this.saveLedger(data);
      logger.info('CivLedger', `[EMERGENT CURRENCY] '${name}' registered by ${establishedBy}`);
      detailedLogger.logCivilizationMilestone('currency', `Currency '${name}' established by ${establishedBy}`, { description });
    }
  }

  recordSettlement(name, claimedBy, center, radius = 50) {
    const data = this.getLedger();
    const existing = data.settlements.find(s => s.name.toLowerCase() === name.toLowerCase());
    if (!existing) {
      data.settlements.push({ name, claimedBy, center, radius, date: new Date().toISOString() });
      this.saveLedger(data);
      logger.info('CivLedger', `[EMERGENT SETTLEMENT] '${name}' claimed by ${claimedBy}`);
      detailedLogger.logCivilizationMilestone('settlement', `Settlement '${name}' claimed by ${claimedBy}`, { center, radius });
    }
  }

  recordFaction(name, founder) {
    const data = this.getLedger();
    const existing = data.factions.find(f => f.name.toLowerCase() === name.toLowerCase());
    if (!existing) {
      data.factions.push({ name, founder, members: [founder], date: new Date().toISOString() });
      this.saveLedger(data);
      logger.info('CivLedger', `[EMERGENT FACTION] '${name}' founded by ${founder}`);
      detailedLogger.logCivilizationMilestone('faction', `Faction '${name}' founded by ${founder}`);
    }
  }
}

module.exports = CivilizationLedger;
