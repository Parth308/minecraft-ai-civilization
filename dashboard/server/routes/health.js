// GET /health — proxies broker + memory-service health, returns combined object with response times
async function healthRoutes(app, aggregator) {
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'dashboard', uptime: process.uptime() });
  });

  app.get('/api/dashboard/health', (req, res) => {
    const state = aggregator.getState();
    res.json({
      broker: state.broker,
      memoryService: state.memoryService,
      spectator: state.spectator,
      timestamp: new Date().toISOString()
    });
  });

  app.get('/api/dashboard/stats', async (req, res) => {
    try {
      const brokerUrl = process.env.BROKER_URL || 'http://brain-broker:3001';
      const r = await fetch(`${brokerUrl}/api/stats`);
      const data = await r.json();
      res.json(data);
    } catch (err) {
      res.status(503).json({ error: `Broker unavailable: ${err.message}` });
    }
  });
}

module.exports = healthRoutes;
