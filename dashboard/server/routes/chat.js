// Chat routes — relay in-game chat and allow operator to send messages via RCON
function chatRoutes(app, aggregator, rcon) {
  // GET last N chat messages buffered by aggregator
  app.get('/api/dashboard/chat', (req, res) => {
    const limit = parseInt(req.query.limit, 10) || 50;
    const msgs = aggregator.getChatHistory(limit);
    res.json(msgs);
  });

  // POST — operator sends a message to the MC server via RCON /say
  app.post('/api/dashboard/chat', async (req, res) => {
    const { message } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message required' });
    }

    if (!rcon) {
      return res.status(503).json({ error: 'RCON not configured — cannot send chat' });
    }

    try {
      const sanitized = message.slice(0, 256).replace(/["`]/g, "'");
      // Use /tellraw so it shows as [Operator] prefix in a distinct color
      const tellraw = JSON.stringify([
        { text: '[Operator] ', color: 'gold', bold: true },
        { text: sanitized, color: 'white' }
      ]);
      await rcon.send(`tellraw @a ${tellraw}`);

      // Echo into dashboard chat history so it appears in live feed
      aggregator.pushChat({ username: 'Operator', message: sanitized, source: 'operator' });

      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: `RCON failed: ${err.message}` });
    }
  });
}

module.exports = chatRoutes;
