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

  app.post('/api/dashboard/agents/:agentId/personality', async (req, res) => {
    const agentName = req.params.agentId;
    const agents = aggregator.getState().agents;
    const agent = agents.find(a => a.username === agentName);
    
    // Determine internal host/port
    const hostMap = {
      'Agent_Alpha':   'http://agent-alpha:3010',
      'Agent_Beta':    'http://agent-beta:3011',
      'Agent_Gamma':   'http://agent-gamma:3012',
      'Agent_Delta':   'http://agent-delta:3013',
      'Agent_Echo':    'http://agent-echo:3014',
      'Agent_Foxtrot': 'http://agent-foxtrot:3015',
      'Agent_Golf':    'http://agent-golf:3016',
      'Agent_Hotel':   'http://agent-hotel:3017'
    };
    const targetUrl = hostMap[agentName] || agent?.statusUrl || `http://${agentName.toLowerCase().replace('_', '-')}:3010`;

    try {
      const resp = await fetch(`${targetUrl}/personality`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body),
        signal: AbortSignal.timeout(4000)
      });
      const data = await resp.json();
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: `Failed to update agent personality: ${err.message}` });
    }
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
