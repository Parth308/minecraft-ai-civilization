// GET /api/dashboard/agents — current snapshot of all agent states
function agentRoutes(app, aggregator) {
  app.get('/api/dashboard/agents', (req, res) => {
    res.json(aggregator.getState().agents);
  });

  app.get('/api/dashboard/agents/:agentId', (req, res) => {
    const agents = aggregator.getState().agents;
    const agent = agents.find(a => a.username === req.params.agentId);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    res.json(agent);
  });
}

module.exports = agentRoutes;
