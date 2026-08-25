// Ledger route — proxies /api/ledger from memory-service
const MEMORY_URL = process.env.MEMORY_SERVICE_URL || 'http://memory-service:3002';

function ledgerRoutes(app) {
  app.get('/api/dashboard/ledger', async (req, res) => {
    try {
      const r = await fetch(`${MEMORY_URL}/api/ledger`);
      const data = await r.json();
      res.json(data);
    } catch (err) {
      res.status(503).json({ error: `Memory service unavailable: ${err.message}` });
    }
  });

  app.get('/api/dashboard/chronicle', async (req, res) => {
    try {
      const r = await fetch(`${MEMORY_URL}/api/ledger/chronicle`);
      const data = await r.json();
      res.json(data);
    } catch (err) {
      res.status(503).json({ error: `Memory service unavailable: ${err.message}` });
    }
  });

  app.get('/api/dashboard/lessons', async (req, res) => {
    try {
      const r = await fetch(`${MEMORY_URL}/api/ledger/lessons`);
      const data = await r.json();
      res.json(data);
    } catch (err) {
      res.status(503).json({ error: `Memory service unavailable: ${err.message}` });
    }
  });

  app.get('/api/dashboard/trades', async (req, res) => {
    try {
      const r = await fetch(`${MEMORY_URL}/api/ledger/trades`);
      res.json(await r.json());
    } catch (err) {
      res.status(503).json({ error: `Memory service unavailable: ${err.message}` });
    }
  });

  app.get('/api/dashboard/debts', async (req, res) => {
    try {
      const r = await fetch(`${MEMORY_URL}/api/ledger/debts`);
      res.json(await r.json());
    } catch (err) {
      res.status(503).json({ error: `Memory service unavailable: ${err.message}` });
    }
  });

  app.get('/api/dashboard/shared-goals', async (req, res) => {
    try {
      const r = await fetch(`${MEMORY_URL}/api/ledger/shared-goals`);
      res.json(await r.json());
    } catch (err) {
      res.status(503).json({ error: `Memory service unavailable: ${err.message}` });
    }
  });

  app.get('/api/dashboard/factions', async (req, res) => {
    try {
      const r = await fetch(`${MEMORY_URL}/api/ledger/factions`);
      res.json(await r.json());
    } catch (err) {
      res.status(503).json({ error: `Memory service unavailable: ${err.message}` });
    }
  });

  app.get('/api/dashboard/deaths', async (req, res) => {
    try {
      const r = await fetch(`${MEMORY_URL}/api/ledger/deaths`);
      const data = await r.json();
      res.json(data);
    } catch (err) {
      res.status(503).json({ error: `Memory service unavailable: ${err.message}` });
    }
  });
}

module.exports = ledgerRoutes;
