const logger = require('../../shared/logger');

async function queryGroq(apiKey, prompt) {
  if (!apiKey) throw new Error('GROQ_API_KEY is not configured');

  logger.info('GroqProvider', 'Querying Groq API...');

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (response.status === 429) {
    const error = new Error('Groq API Rate Limit Exceeded (429)');
    error.status = 429;
    throw error;
  }

  if (!response.ok) {
    throw new Error(`Groq API Error: ${response.statusText} (${response.status})`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('Invalid response structure from Groq API');
  return text;
}

module.exports = queryGroq;
