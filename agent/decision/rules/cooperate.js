const { ACTIONS } = require('../../../shared/constants');

function evaluateCooperate(senses, stats, persona = null, agentState = {}) {
  const activeSharedGoals = agentState?.activeSharedGoals || [];
  if (!activeSharedGoals || activeSharedGoals.length === 0) {
    return { name: 'CONTRIBUTE', confidence: 0.0, reason: 'No active shared community goals' };
  }

  // Find goal we participate in or can contribute to
  const goal = activeSharedGoals.find(g => g.status === 'active');
  if (!goal) {
    return { name: 'CONTRIBUTE', confidence: 0.0, reason: 'All shared goals completed' };
  }

  // Check if we hold any of the required contribution items
  let deliverableItem = null;
  for (const req of (goal.requiredContributions || [])) {
    if (senses.hasItem(req.item) && senses.countItem(req.item) >= 4) {
      deliverableItem = { item: req.item, count: Math.min(senses.countItem(req.item), 16) };
      break;
    }
  }

  if (!deliverableItem) {
    return { name: 'CONTRIBUTE', confidence: 0.0, reason: 'Do not possess required contribution materials for shared goal' };
  }

  const tr = persona?.traits || {};
  let confidence = 0.65;
  // Loyalty and sociability amplify willingness to deliver materials to community projects
  if (tr.loyalty) confidence += (tr.loyalty - 0.5) * 0.20;
  if (tr.sociability) confidence += (tr.sociability - 0.5) * 0.15;

  return {
    name: 'CONTRIBUTE',
    confidence: Math.min(0.95, Number(confidence.toFixed(2))),
    goalId: goal.id,
    goalDescription: goal.description,
    location: goal.location,
    deliverable: deliverableItem,
    meta: {
      goalId: goal.id,
      item: deliverableItem.item,
      count: deliverableItem.count,
      location: goal.location
    },
    reason: `Holding ${deliverableItem.count}x ${deliverableItem.item} for collaborative goal "${goal.description}"`
  };
}

module.exports = evaluateCooperate;
