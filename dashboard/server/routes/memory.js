// Memory routes — proxy to memory-service /api/memory/query and /api/memory/sections
const MEMORY_URL = process.env.MEMORY_SERVICE_URL || 'http://memory-service:3002';

function memoryRoutes(app) {
  // Query memory semantically
  app.get('/api/dashboard/memory/query', async (req, res) => {
    const { agentId, query, section, limit } = req.query;
    if (!agentId) return res.status(400).json({ error: 'agentId required' });

    try {
      const params = new URLSearchParams({ agentId, ...(query && { query }), ...(section && { section }), ...(limit && { limit }) });
      const r = await fetch(`${MEMORY_URL}/api/memory/query?${params}`);
      const data = await r.json();
      res.json(data);
    } catch (err) {
      res.status(503).json({ error: `Memory service unavailable: ${err.message}` });
    }
  });

  // Get raw markdown section content
  app.get('/api/dashboard/memory/sections/:agentId/:section', async (req, res) => {
    const { agentId, section } = req.params;
    try {
      const r = await fetch(`${MEMORY_URL}/api/memory/sections/${encodeURIComponent(agentId)}/${encodeURIComponent(section)}`);
      const data = await r.json();
      res.json(data);
    } catch (err) {
      res.status(503).json({ error: `Memory service unavailable: ${err.message}` });
    }
  });
}

module.exports = memoryRoutes;
