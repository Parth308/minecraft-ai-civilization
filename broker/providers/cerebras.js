const logger = require('../../shared/logger');

async function queryCerebras(apiKey, prompt) {
  if (!apiKey) throw new Error('CEREBRAS_API_KEY is not configured');

  logger.info('CerebrasProvider', 'Querying Cerebras API...');

  const response = await fetch('https://api.cerebras.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'llama3.1-8b',
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (response.status === 429) {
    const error = new Error('Cerebras API Rate Limit Exceeded (429)');
    error.status = 429;
    throw error;
  }

  if (!response.ok) {
    throw new Error(`Cerebras API Error: ${response.statusText} (${response.status})`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('Invalid response structure from Cerebras API');
  return text;
}

module.exports = queryCerebras;
