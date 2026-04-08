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

// ── ROTA: OpenAI GPT Image ────────────────────────────────
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

// ── ROTA: Gemini Imagen 4 ─────────────────────────────────
app.post('/api/gemini-image', async (req, res) => {
  try {
    const { prompt, n = 3, aspectRatio = '1:1' } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-preview-05-20:predict?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instances: [{ prompt }],
          parameters: {
            sampleCount: Math.min(n, 4),
            aspectRatio,
            safetyFilterLevel: 'block_only_high',
            personGeneration: 'allow_adult'
          }
        })
      }
    );

    const data = await response.json();

    if (data.predictions) {
      res.json({
        data: data.predictions.map(p => ({
          b64_json: p.bytesBase64Encoded,
          url: null
        }))
      });
    } else {
      res.json(data);
    }
  } catch (err) {
    console.error('Erro Gemini:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── INICIA O SERVIDOR ────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Maquina de Criativos rodando na porta ${PORT}`);
});
