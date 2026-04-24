const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

const apiKey = process.env.ANTHROPIC_API_KEY || process.env.anthropic_api_key || '';
console.log('ENV CHECK — ANTHROPIC_API_KEY present:', !!apiKey);
console.log('ENV CHECK — key length:', apiKey.length);
console.log('ENV CHECK — PORT:', PORT);

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.post('/api/analyze', async (req, res) => {
  try {
    const key = process.env.ANTHROPIC_API_KEY || process.env.anthropic_api_key || '';
    
    if (!key || key.length < 10) {
      console.error('API key missing. Length:', key.length);
      return res.status(500).json({ 
        error: 'API key not configured on server.',
        keyLength: key.length
      });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(req.body)
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).json({ error: 'Proxy server error.', details: err.message });
  }
});

app.get('/health', (req, res) => {
  const key = process.env.ANTHROPIC_API_KEY || '';
  res.json({ 
    status: 'ok',
    keyConfigured: !!key && key.length > 10,
    keyLength: key.length
  });
});

app.listen(PORT, () => {
  console.log(`IRONCLAD RECON proxy running on port ${PORT}`);
});
