const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
// express.static registado no final, depois das rotas /api/*

// ── Storage ──────────────────────────────────────────────────────────────────
const upload = multer({ dest: 'uploads/' });

// No Railway o filesystem da raiz é read-only em alguns planos; usar /tmp como fallback
const DATA_DIR = fs.existsSync('/tmp') ? '/tmp' : '.';
const SCHEDULED_FILE = path.join(DATA_DIR, 'scheduled_posts.json');
const GENERATED_FILE = path.join(DATA_DIR, 'generated_content.json');
const MANUALS_DIR    = path.join(DATA_DIR, 'manuals');

if (!fs.existsSync('uploads/'))  fs.mkdirSync('uploads/', { recursive: true });
if (!fs.existsSync(MANUALS_DIR)) fs.mkdirSync(MANUALS_DIR, { recursive: true });
if (!fs.existsSync(SCHEDULED_FILE)) fs.writeFileSync(SCHEDULED_FILE, '[]');
if (!fs.existsSync(GENERATED_FILE)) fs.writeFileSync(GENERATED_FILE, '[]');

// ── Helpers ───────────────────────────────────────────────────────────────────
function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return []; }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// Salva criativo na base geral
function saveGeneratedContent(item) {
  const all = readJSON(GENERATED_FILE);
  all.unshift(item);                 // mais recente primeiro
  writeJSON(GENERATED_FILE, all);
  return item;
}

// Atualiza status de um criativo
function updateContentStatus(id, status, extra = {}) {
  const all = readJSON(GENERATED_FILE);
  const idx = all.findIndex(i => i.id === id);
  if (idx !== -1) { all[idx] = { ...all[idx], status, ...extra }; writeJSON(GENERATED_FILE, all); }
}

// ── Accounts ─────────────────────────────────────────────────────────────────
const ACCOUNTS = {
  marca:   { id: process.env.INSTAGRAM_ACCOUNT_ID_MARCA,   token: process.env.INSTAGRAM_TOKEN_MARCA,   name: 'Case Aceleradora',  handle: '@caseaceleradora'  },
  pessoal: { id: process.env.INSTAGRAM_ACCOUNT_ID_PESSOAL, token: process.env.INSTAGRAM_TOKEN_PESSOAL, name: 'Ana Moutinho',       handle: '@analuisa.moutinho' },
};

function getAccount(profile) { return ACCOUNTS[profile] || ACCOUNTS.marca; }

// ── Manual upload ─────────────────────────────────────────────────────────────
app.post('/api/manual/upload', upload.single('pdf'), (req, res) => {
  const { profile } = req.body;
  if (!req.file) return res.status(400).json({ error: 'Nenhum ficheiro enviado' });
  const dest = path.join(MANUALS_DIR, `${profile || 'marca'}.pdf`);
  fs.renameSync(req.file.path, dest);
  res.json({ success: true, message: `Manual do perfil "${profile}" guardado.` });
});

function getManualText(profile) {
  const p = path.join(MANUALS_DIR, `${profile || 'marca'}.pdf`);
  if (!fs.existsSync(p)) return '';
  // Basic extraction – in production use pdf-parse
  return '[Manual do cliente carregado — usar diretrizes de tom, cores e linguagem definidas no PDF]';
}

// ── Claude API ────────────────────────────────────────────────────────────────
app.post('/api/claude', async (req, res) => {
  try {
    const { prompt, profile, systemExtra } = req.body;
    const manualNote = getManualText(profile);
    const systemMsg = `Você é especialista em marketing digital e criação de conteúdo para Instagram.
Responda sempre em português de Portugal.
${manualNote ? `\n## Manual do cliente\n${manualNote}` : ''}
${systemExtra || ''}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: systemMsg,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await response.json();
    if (data.error) return res.status(500).json({ error: data.error.message });
    res.json({ content: data.content[0].text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Image generation — GPT Image-1 ───────────────────────────────────────────
app.post('/api/image', async (req, res) => {
  try {
    const { prompt, size = '1024x1024' } = req.body;
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-image-1', prompt, n: 1, size }),
    });
    const data = await response.json();
    if (data.error) return res.status(500).json({ error: data.error.message });
    res.json({ url: data.data[0].url, b64: data.data[0].b64_json });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Image generation — Gemini Imagen ─────────────────────────────────────────
app.post('/api/gemini-image', async (req, res) => {
  try {
    const { prompt } = req.body;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${process.env.GEMINI_API_KEY}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instances: [{ prompt }], parameters: { sampleCount: 1 } }),
    });
    const data = await response.json();
    if (data.error) return res.status(500).json({ error: data.error.message });
    const b64 = data.predictions[0].bytesBase64Encoded;
    res.json({ b64 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Base de criativos gerados ─────────────────────────────────────────────────
app.get('/api/content', (req, res) => {
  const all = readJSON(GENERATED_FILE);
  const { profile, type, status } = req.query;
  let filtered = all;
  if (profile) filtered = filtered.filter(i => i.profile === profile);
  if (type)    filtered = filtered.filter(i => i.type    === type);
  if (status)  filtered = filtered.filter(i => i.status  === status);
  res.json(filtered);
});

app.post('/api/content/save', (req, res) => {
  const item = {
    id: `cnt_${Date.now()}`,
    createdAt: new Date().toISOString(),
    status: 'pendente',   // pendente | agendado | publicado
    ...req.body,
  };
  saveGeneratedContent(item);
  res.json({ success: true, item });
});

app.patch('/api/content/:id', (req, res) => {
  const all = readJSON(GENERATED_FILE);
  const idx = all.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Criativo não encontrado' });
  all[idx] = { ...all[idx], ...req.body };
  writeJSON(GENERATED_FILE, all);
  res.json({ success: true, item: all[idx] });
});

// ── Instagram — publicação imediata ──────────────────────────────────────────
async function publishSingle(account, imageUrl, caption) {
  const { id: accountId, token } = account;
  // 1. criar container
  const containerRes = await fetch(
    `https://graph.facebook.com/v19.0/${accountId}/media?image_url=${encodeURIComponent(imageUrl)}&caption=${encodeURIComponent(caption)}&access_token=${token}`,
    { method: 'POST' }
  );
  const { id: containerId, error } = await containerRes.json();
  if (error) throw new Error(error.message);

  // 2. aguardar processamento
  await new Promise(r => setTimeout(r, 5000));

  // 3. publicar
  const pubRes = await fetch(
    `https://graph.facebook.com/v19.0/${accountId}/media_publish?creation_id=${containerId}&access_token=${token}`,
    { method: 'POST' }
  );
  return pubRes.json();
}

async function publishCarousel(account, imageUrls, caption) {
  const { id: accountId, token } = account;
  // 1. criar item containers
  const childIds = [];
  for (const url of imageUrls) {
    const r = await fetch(
      `https://graph.facebook.com/v19.0/${accountId}/media?image_url=${encodeURIComponent(url)}&is_carousel_item=true&access_token=${token}`,
      { method: 'POST' }
    );
    const { id, error } = await r.json();
    if (error) throw new Error(error.message);
    childIds.push(id);
  }

  // 2. container do carrossel
  const carouselRes = await fetch(
    `https://graph.facebook.com/v19.0/${accountId}/media?media_type=CAROUSEL&children=${childIds.join(',')}&caption=${encodeURIComponent(caption)}&access_token=${token}`,
    { method: 'POST' }
  );
  const { id: carouselId, error: cerr } = await carouselRes.json();
  if (cerr) throw new Error(cerr.message);

  await new Promise(r => setTimeout(r, 8000));

  const pubRes = await fetch(
    `https://graph.facebook.com/v19.0/${accountId}/media_publish?creation_id=${carouselId}&access_token=${token}`,
    { method: 'POST' }
  );
  return pubRes.json();
}

app.post('/api/instagram/post', async (req, res) => {
  try {
    const { imageUrl, caption, profile, contentId } = req.body;
    const account = getAccount(profile);
    const result = await publishSingle(account, imageUrl, caption);
    if (result.error) return res.status(500).json({ error: result.error.message });
    if (contentId) updateContentStatus(contentId, 'publicado', { publishedAt: new Date().toISOString(), instagramId: result.id });
    res.json({ success: true, id: result.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/instagram/carousel', async (req, res) => {
  try {
    const { imageUrls, caption, profile, contentId } = req.body;
    const account = getAccount(profile);
    const result = await publishCarousel(account, imageUrls, caption);
    if (result.error) return res.status(500).json({ error: result.error.message });
    if (contentId) updateContentStatus(contentId, 'publicado', { publishedAt: new Date().toISOString(), instagramId: result.id });
    res.json({ success: true, id: result.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Agendamento ───────────────────────────────────────────────────────────────
app.post('/api/instagram/schedule', (req, res) => {
  try {
    const { scheduledAt, contentId, ...rest } = req.body;
    const posts = readJSON(SCHEDULED_FILE);
    const newPost = { id: `sch_${Date.now()}`, contentId, scheduledAt, status: 'pending', ...rest };
    posts.push(newPost);
    writeJSON(SCHEDULED_FILE, posts);

    if (contentId) updateContentStatus(contentId, 'agendado', {
      scheduledAt,
      scheduleId: newPost.id,
    });

    res.json({ success: true, scheduledPost: newPost });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/instagram/scheduled', (req, res) => {
  const posts = readJSON(SCHEDULED_FILE);
  res.json(posts);
});

// ── Processador de posts agendados (roda a cada minuto) ───────────────────────
setInterval(async () => {
  const posts = readJSON(SCHEDULED_FILE);
  const now = new Date();
  let changed = false;

  for (const post of posts) {
    if (post.status !== 'pending') continue;
    const scheduled = new Date(post.scheduledAt);
    if (scheduled > now) continue;

    try {
      const account = getAccount(post.profile);
      let result;
      if (post.type === 'carousel' && post.imageUrls?.length > 1) {
        result = await publishCarousel(account, post.imageUrls, post.caption);
      } else {
        result = await publishSingle(account, post.imageUrl || post.imageUrls?.[0], post.caption);
      }
      post.status = result.error ? 'error' : 'published';
      post.publishedAt = new Date().toISOString();
      post.instagramId = result.id;
      if (post.contentId) updateContentStatus(post.contentId, 'publicado', { publishedAt: post.publishedAt, instagramId: result.id });
      changed = true;
    } catch (err) {
      post.status = 'error';
      post.error = err.message;
      changed = true;
    }
  }

  if (changed) writeJSON(SCHEDULED_FILE, posts);
}, 60_000);

// ── Calendário editorial ──────────────────────────────────────────────────────
// Sem limite de 7/semana — o utilizador configura maxPerDay (padrão 3)
app.post('/api/calendar/generate', async (req, res) => {
  try {
    const { month, year, profile, postsPerDay = 2, totalPosts } = req.body;
    const manualNote = getManualText(profile);
    const account = getAccount(profile);

    // Calcular número de dias úteis no mês (seg-sáb) para distribuição inteligente
    const daysInMonth = new Date(year, month, 0).getDate();
    const calculatedTotal = totalPosts || Math.min(postsPerDay * daysInMonth, 90); // máx 90/mês

    const prompt = `Gera um calendário editorial para Instagram para ${account.name} (${account.handle}).

Mês: ${month}/${year}
Total de posts: ${calculatedTotal}
Posts por dia (máx): ${postsPerDay}
Dias no mês: ${daysInMonth}

Distribui os posts ao longo de todos os dias do mês.
Pode ter até ${postsPerDay} posts por dia em dias de maior engajamento (terça, quarta, quinta).
Nos fins de semana podes ter 1 post por dia.

${manualNote ? `\nDiretrizes do cliente:\n${manualNote}` : ''}

Responde APENAS com JSON válido neste formato exacto:
{
  "calendar": [
    {
      "day": 1,
      "posts": [
        {
          "time": "09:00",
          "type": "carrossel",
          "topic": "tema do post",
          "caption": "legenda completa com emojis",
          "hashtags": "#hashtag1 #hashtag2",
          "visualDescription": "descrição visual para geração de imagem",
          "callToAction": "texto do CTA"
        }
      ]
    }
  ]
}

Tipos possíveis: "carrossel", "feed", "reels"
Distribui variedade de tipos ao longo do mês.
Certifica-te que o JSON é válido e completo.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 8192,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await response.json();
    if (data.error) return res.status(500).json({ error: data.error.message });

    let text = data.content[0].text.trim();
    // Extrair JSON do texto
    const match = text.match(/\{[\s\S]*\}/);
    if (match) text = match[0];

    const calendar = JSON.parse(text);

    // Cruzar com criativos já gerados/agendados/publicados
    const generated = readJSON(GENERATED_FILE).filter(g => g.profile === profile);
    const scheduled = readJSON(SCHEDULED_FILE);

    // Enriquecer cada post do calendário com status
    calendar.calendar = calendar.calendar.map(dayEntry => ({
      ...dayEntry,
      posts: dayEntry.posts.map(post => {
        const postDate = new Date(year, month - 1, dayEntry.day);
        const dateStr = postDate.toISOString().split('T')[0];

        // Verificar se existe criativo gerado para este dia/tipo
        const match = generated.find(g =>
          g.calendarDay === dayEntry.day &&
          g.calendarMonth === month &&
          g.calendarYear === year
        );

        return {
          ...post,
          date: dateStr,
          contentId: match?.id || null,
          status: match?.status || 'pendente',  // pendente | agendado | publicado
          scheduledAt: match?.scheduledAt || null,
        };
      }),
    }));

    res.json(calendar);
  } catch (err) {
    console.error('Calendar error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Gerar + Salvar carrossel na base ─────────────────────────────────────────
// Endpoint que gera o JSON do carrossel E salva na base de criativos
app.post('/api/carousel/generate-and-save', async (req, res) => {
  try {
    const { topic, profile, slides = 7, calendarDay, calendarMonth, calendarYear, caption, hashtags } = req.body;
    const manualNote = getManualText(profile);
    const account = getAccount(profile);

    const prompt = `Cria um carrossel para Instagram sobre: "${topic}".
Perfil: ${account.name} (${account.handle})
${manualNote ? `\nDiretrizes:\n${manualNote}` : ''}

Gera ${slides} slides. Responde apenas com JSON:
{
  "title": "Título do carrossel",
  "slides": [
    {
      "slideNumber": 1,
      "heading": "Título do slide",
      "body": "Texto principal",
      "imagePrompt": "prompt detalhado para geração de imagem"
    }
  ],
  "caption": "legenda para o Instagram",
  "hashtags": "#hashtag1 #hashtag2"
}`;

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const d = await r.json();
    if (d.error) return res.status(500).json({ error: d.error.message });

    let text = d.content[0].text.trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (match) text = match[0];
    const carouselData = JSON.parse(text);

    // Salvar na base de criativos
    const item = saveGeneratedContent({
      id: `cnt_${Date.now()}`,
      createdAt: new Date().toISOString(),
      status: 'pendente',
      type: 'carrossel',
      profile,
      topic,
      caption: caption || carouselData.caption,
      hashtags: hashtags || carouselData.hashtags,
      carouselData,
      calendarDay: calendarDay || null,
      calendarMonth: calendarMonth || null,
      calendarYear: calendarYear || null,
    });

    res.json({ success: true, contentId: item.id, ...carouselData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Ficheiros estáticos (SEMPRE depois das rotas /api/*) ─────────────────────
// Se o static vier antes, o Express serve index.html para rotas /api/* não encontradas
// causando "Unexpected token '<'" ao tentar fazer JSON.parse do HTML
app.use(express.static('public'));

// Catch-all: qualquer rota não-API devolve o index.html (SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`🚀 Máquina de Conteúdo rodando na porta ${PORT}`));
