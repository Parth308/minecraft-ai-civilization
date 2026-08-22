// GET /api/dashboard/agents — current snapshot of all agent states
// POST /api/dashboard/register-agent — dynamic self-registration for any agent
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

  app.post('/api/dashboard/register-agent', (req, res) => {
    const { name, url } = req.body || {};
    if (!url) {
      return res.status(400).json({ error: 'Agent url is required' });
    }
    const ok = aggregator.registerAgent({ name, url });
    res.json({ ok, name: name || 'Agent', url });
  });
}

module.exports = agentRoutes;
