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
}

module.exports = healthRoutes;
