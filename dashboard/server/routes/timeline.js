const fs = require('fs');
const path = require('path');
const logger = require('../../../shared/logger');

function timelineRoutes(app) {
  app.get('/api/timeline', (req, res) => {
    const { agentId, from, to, limit } = req.query;
    const maxEvents = parseInt(limit, 10) || 500;
    const fromTs = from ? new Date(from).getTime() : 0;
    const toTs = to ? new Date(to).getTime() : Date.now() + 86400000;

    const rootDir = path.resolve(__dirname, '../../../');
    const timelineLogPath = path.join(rootDir, 'logs/world/global_timeline.log');
    const civEventsPath = path.join(rootDir, 'logs/world/civilization_events.log');

    const parsedEvents = [];

    function parseLogFile(filePath, defaultCategory = 'world') {
      if (!fs.existsSync(filePath)) return;
      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const lines = raw.split(/\r?\n/).filter(Boolean);
        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            const ts = new Date(data.timestamp || data.time || 0).getTime();
            if (ts >= fromTs && ts <= toTs) {
              if (!agentId || (data.agentId && data.agentId.toLowerCase() === agentId.toLowerCase())) {
                parsedEvents.push({
                  category: defaultCategory,
                  ...data,
                  _parsedTs: ts
                });
              }
            }
          } catch (_) {
            // Unstructured line fallback
            parsedEvents.push({
              category: defaultCategory,
              raw: line,
              _parsedTs: Date.now()
            });
          }
        }
      } catch (err) {
        logger.debug('TimelineRoute', `Error reading ${filePath}: ${err.message}`);
      }
    }

    // Read global timeline and civilization events
    parseLogFile(timelineLogPath, 'world_timeline');
    parseLogFile(civEventsPath, 'civilization_milestone');

    // If specific agent requested, also read agent-specific log
    if (agentId) {
      const agentLogPath = path.join(rootDir, `logs/agents/${agentId}/cognition_and_decisions.log`);
      parseLogFile(agentLogPath, 'agent_cognition');
    }

    // Sort chronologically
    parsedEvents.sort((a, b) => (a._parsedTs || 0) - (b._parsedTs || 0));
    const sliced = parsedEvents.slice(-maxEvents);

    res.json({
      count: sliced.length,
      timeRange: { from: from || null, to: to || null },
      events: sliced
    });
  });
}

module.exports = timelineRoutes;
