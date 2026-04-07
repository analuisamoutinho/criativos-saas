const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// ── ROTA: Claude (gera o prompt) ──────────────────────────
app.post('/api/claude', async (req, res) => {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(req.body)
    });

    const data = await response.json();
    res.json(data);

  } catch (err) {
    console.error('Erro Claude:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── ROTA: OpenAI (gera a imagem) ─────────────────────────
app.post('/api/image', async (req, res) => {
  try {
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-image-1',
        prompt: req.body.prompt,
        n: req.body.n || 3,
        size: req.body.size || '1024x1024',
        quality: req.body.quality || 'high'
      })
    });

    const data = await response.json();
    res.json(data);

  } catch (err) {
    console.error('Erro OpenAI:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── INICIA O SERVIDOR ────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AdForge rodando na porta ${PORT}`);
});
