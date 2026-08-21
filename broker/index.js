const express = require('express');
const config = require('./config');
const ProviderRouter = require('./router');
const logger = require('../shared/logger');

const app = express();
app.use(express.json());

const router = new ProviderRouter();

// Health Check Endpoint
app.get('/health', (req, res) => {
  const activeKeys = Object.entries(config.keys)
    .filter(([_, key]) => !!key)
    .map(([name]) => name);

  res.json({
    status: 'ok',
    uptime: process.uptime(),
    configuredProviders: activeKeys
  });
});

// Escalation Endpoint
app.post('/api/escalate', async (req, res) => {
  try {
    const payload = req.body;
    if (!payload || (!payload.topCandidate && !payload.taskType)) {
      return res.status(400).json({ error: 'Invalid payload. Missing situation or taskType.' });
    }

    logger.info('BrainBroker', `Received escalation request [task:${payload.taskType || 'REASONING'}] for: ${payload.topCandidate?.name || payload.message || 'generic'}`);
    const decision = await router.processEscalation(payload);
    return res.json(decision);
  } catch (err) {
    logger.error('BrainBroker', 'Unhandled escalation error:', err);
    return res.status(500).json({
      error: 'Brain Broker internal processing error',
      details: err.message
    });
  }
});

app.listen(config.port, () => {
  logger.info('BrainBroker', `Central Brain Broker Service running on http://localhost:${config.port}`);
});
