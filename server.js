const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

// ─── Mapeamento de perfis usando as vars do Railway ──────────────────────────
const PROFILES = {
  case: {
    name: 'Case Aceleradora',
    handle: '@caseaceleradora',
    get igUserId() { return process.env.INSTAGRAM_ACCOUNT_ID_MARCA; },
    get igToken()  { return process.env.INSTAGRAM_ACCESS_TOKEN; }
  },
  ana: {
    name: 'Ana Moutinho',
    handle: '@analuisa.moutinho',
    get igUserId() { return process.env.INSTAGRAM_ACCOUNT_ID_PESSOAL; },
    get igToken()  { return process.env.INSTAGRAM_ACCESS_TOKEN; }
  }
};

// ─── Multer: upload de PDFs dos manuais de cliente ───────────────────────────
const manualStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = './manuals';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const profile = req.body.profile || 'unknown';
    cb(null, `${profile}_manual.pdf`);
  }
});
const uploadManual = multer({ storage: manualStorage, limits: { fileSize: 20 * 1024 * 1024 } });

// ─── Multer: upload de imagens para hospedar (URL pública para o IG) ─────────
const imageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = './uploads';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`);
  }
});
const uploadImage = multer({ storage: imageStorage, limits: { fileSize: 50 * 1024 * 1024 } });

// ════════════════════════════════════════════════════════════════════════════
//  1. PROXY CLAUDE API
// ════════════════════════════════════════════════════════════════════════════
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
    if (!response.ok) throw new Error(data.error?.message || `Claude API error ${response.status}`);
    res.json(data);
  } catch (err) {
    console.error('Claude proxy error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  2. PROXY GEMINI IMAGEN
// ════════════════════════════════════════════════════════════════════════════
app.post('/api/gemini-image', async (req, res) => {
  try {
    const { prompt, aspectRatio } = req.body;
    // Gemini não aceita '4:5' — mapeia para o mais próximo aceito
    const aspectMap = { '4:5': '4:3', '9:16': '9:16', '1:1': '1:1', '16:9': '16:9', '3:4': '3:4' };
    const geminiAspect = aspectMap[aspectRatio] || '4:3';

    const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${process.env.GEMINI_API_KEY}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: { sampleCount: 1, aspectRatio: geminiAspect }
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || `Gemini error ${response.status}`);
    res.json(data);
  } catch (err) {
    console.error('Gemini image error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  3. PROXY GPT IMAGE-1 (batch: 1–10 imagens simultâneas)
// ════════════════════════════════════════════════════════════════════════════
app.post('/api/image', async (req, res) => {
  try {
    const { prompt, n = 1, size = '1024x1024', quality = 'standard' } = req.body;
    const count = Math.min(Math.max(parseInt(n) || 1, 1), 10);

    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-image-1',
        prompt,
        n: count,
        size,
        quality,
        response_format: 'b64_json'
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || `OpenAI error ${response.status}`);
    res.json(data);
  } catch (err) {
    console.error('GPT image error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  4. MANUAL DO CLIENTE (upload + status)
// ════════════════════════════════════════════════════════════════════════════
app.post('/api/manual/upload', uploadManual.single('manual'), (req, res) => {
  try {
    if (!req.body.profile) return res.status(400).json({ error: 'profile obrigatório' });
    if (!req.file)         return res.status(400).json({ error: 'arquivo não enviado' });
    res.json({ success: true, message: `Manual do perfil "${req.body.profile}" salvo.`, size: req.file.size });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/manual/status/:profile', (req, res) => {
  const file = path.join('./manuals', `${req.params.profile}_manual.pdf`);
  if (fs.existsSync(file)) {
    const stat = fs.statSync(file);
    res.json({ exists: true, size: stat.size, updatedAt: stat.mtime });
  } else {
    res.json({ exists: false });
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  5. CALENDÁRIO EDITORIAL MENSAL
// ════════════════════════════════════════════════════════════════════════════
app.post('/api/calendar/generate', async (req, res) => {
  try {
    const { profile, month, year, postsPerWeek = 4 } = req.body;
    if (!profile || !month || !year) return res.status(400).json({ error: 'profile, month e year obrigatórios' });

    const prof = PROFILES[profile];
    if (!prof) return res.status(400).json({ error: 'Perfil inválido' });

    // Tenta ler o manual do cliente e extrair contexto via Claude
    const manualPath = path.join('./manuals', `${profile}_manual.pdf`);
    let manualContext = 'Nenhum manual carregado para este cliente.';

    if (fs.existsSync(manualPath)) {
      try {
        const base64 = fs.readFileSync(manualPath).toString('base64');
        const extractRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-6',
            max_tokens: 2000,
            messages: [{
              role: 'user',
              content: [
                { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
                { type: 'text', text: 'Extraia e resuma em português: tom de voz, nicho, público-alvo, temas principais, objetivos e diretrizes de conteúdo. Máx. 800 palavras.' }
              ]
            }]
          })
        });
        const extractData = await extractRes.json();
        if (extractData.content?.[0]?.text) manualContext = extractData.content[0].text;
      } catch (e) {
        console.warn('Falha ao extrair manual:', e.message);
      }
    }

    const monthNames = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    const monthName  = monthNames[parseInt(month) - 1];
    const daysInMonth = new Date(year, month, 0).getDate();
    const totalPosts  = Math.round((daysInMonth / 7) * postsPerWeek);

    const prompt = `Você é especialista em marketing digital e criação de conteúdo para Instagram.

Crie um calendário editorial completo para ${monthName}/${year} para o perfil ${prof.handle} (${prof.name}).

Configurações:
- Período: ${monthName}/${year} (${daysInMonth} dias)
- Posts/semana: ${postsPerWeek} | Total: ~${totalPosts} posts
- Diretrizes do cliente: ${manualContext}

Retorne APENAS JSON válido (sem markdown, sem texto extra) neste formato exato:
{
  "month": "${month}",
  "year": "${year}",
  "profile": "${profile}",
  "profileName": "${prof.name}",
  "totalPosts": ${totalPosts},
  "strategy": "resumo da estratégia do mês em 2-3 frases",
  "posts": [
    {
      "id": 1,
      "day": 2,
      "weekday": "Segunda",
      "type": "carrossel",
      "theme": "tema do post",
      "title": "título sugerido",
      "caption": "legenda completa com emojis e hashtags",
      "hashtags": ["#tag1", "#tag2"],
      "visualDescription": "descrição detalhada para geração de imagem IA",
      "cta": "chamada para ação",
      "bestTime": "19:00",
      "status": "pending"
    }
  ]
}

Distribua os posts de forma equilibrada. Varie os tipos: carrossel, reels, feed, stories.
Todos os textos em português brasileiro.`;

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 8000, messages: [{ role: 'user', content: prompt }] })
    });

    const claudeData = await claudeRes.json();
    if (!claudeRes.ok) throw new Error(claudeData.error?.message || 'Erro na Claude API');

    const rawText = claudeData.content?.[0]?.text || '';
    if (!rawText) throw new Error('Claude retornou resposta vazia');

    let calendar;
    try {
      const clean = rawText.replace(/^```json\s*/,'').replace(/```\s*$/,'').trim();
      calendar = JSON.parse(clean);
    } catch (e) {
      throw new Error('JSON inválido retornado pela Claude: ' + rawText.slice(0, 300));
    }

    // Persiste o calendário
    const calDir = './calendars';
    if (!fs.existsSync(calDir)) fs.mkdirSync(calDir, { recursive: true });
    fs.writeFileSync(path.join(calDir, `${profile}_${year}_${String(month).padStart(2,'0')}.json`), JSON.stringify(calendar, null, 2));

    res.json({ success: true, calendar });
  } catch (err) {
    console.error('Calendar generate error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/calendar/:profile/:year/:month', (req, res) => {
  const { profile, year, month } = req.params;
  const file = path.join('./calendars', `${profile}_${year}_${String(month).padStart(2,'0')}.json`);
  if (fs.existsSync(file)) {
    res.json({ success: true, calendar: JSON.parse(fs.readFileSync(file, 'utf8')) });
  } else {
    res.json({ success: false, message: 'Calendário não encontrado' });
  }
});

app.patch('/api/calendar/:profile/:year/:month/post/:postId', (req, res) => {
  const { profile, year, month, postId } = req.params;
  const file = path.join('./calendars', `${profile}_${year}_${String(month).padStart(2,'0')}.json`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Calendário não encontrado' });
  const cal = JSON.parse(fs.readFileSync(file, 'utf8'));
  const post = cal.posts.find(p => p.id === parseInt(postId));
  if (!post) return res.status(404).json({ error: 'Post não encontrado' });
  if (req.body.status)    post.status    = req.body.status;
  if (req.body.igPostId)  post.igPostId  = req.body.igPostId;
  if (req.body.imageUrl)  post.imageUrl  = req.body.imageUrl;
  if (req.body.imageUrls) post.imageUrls = req.body.imageUrls;
  fs.writeFileSync(file, JSON.stringify(cal, null, 2));
  res.json({ success: true, post });
});

// ════════════════════════════════════════════════════════════════════════════
//  6. INSTAGRAM — helpers internos
// ════════════════════════════════════════════════════════════════════════════

async function igCreateMediaContainer({ igUserId, igToken, imageUrl, caption, isCarouselItem = false }) {
  const body = new URLSearchParams({ access_token: igToken, image_url: imageUrl });
  if (isCarouselItem) body.append('is_carousel_item', 'true');
  else if (caption)   body.append('caption', caption);

  const r = await fetch(`https://graph.facebook.com/v21.0/${igUserId}/media`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString()
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || `IG media create error ${r.status}`);
  return d.id;
}

async function igCreateCarouselContainer({ igUserId, igToken, children, caption }) {
  const body = new URLSearchParams({
    access_token: igToken,
    media_type: 'CAROUSEL',
    children: children.join(','),
    caption: caption || ''
  });
  const r = await fetch(`https://graph.facebook.com/v21.0/${igUserId}/media`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString()
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || `IG carousel create error ${r.status}`);
  return d.id;
}

async function igPublishContainer({ igUserId, igToken, creationId }) {
  const body = new URLSearchParams({ access_token: igToken, creation_id: creationId });
  const r = await fetch(`https://graph.facebook.com/v21.0/${igUserId}/media_publish`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString()
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || `IG publish error ${r.status}`);
  return d.id;
}

async function igWaitReady(igToken, containerId, maxTries = 20) {
  for (let i = 0; i < maxTries; i++) {
    const r = await fetch(`https://graph.facebook.com/v21.0/${containerId}?fields=status_code&access_token=${igToken}`);
    const d = await r.json();
    if (d.status_code === 'FINISHED') return;
    if (d.status_code === 'ERROR')    throw new Error('Container IG retornou ERROR');
    await new Promise(ok => setTimeout(ok, 3000));
  }
  throw new Error('Timeout aguardando container IG');
}

async function publishToIG(prof, { imageUrl, imageUrls, caption, postType }) {
  if (!prof.igUserId || !prof.igToken) throw new Error('Credenciais Instagram não configuradas para este perfil');

  if (postType === 'carousel' && imageUrls?.length > 1) {
    const childIds = [];
    for (const url of imageUrls) {
      const cid = await igCreateMediaContainer({ igUserId: prof.igUserId, igToken: prof.igToken, imageUrl: url, isCarouselItem: true });
      await igWaitReady(prof.igToken, cid);
      childIds.push(cid);
    }
    const carId = await igCreateCarouselContainer({ igUserId: prof.igUserId, igToken: prof.igToken, children: childIds, caption });
    await igWaitReady(prof.igToken, carId);
    return igPublishContainer({ igUserId: prof.igUserId, igToken: prof.igToken, creationId: carId });
  } else {
    const cid = await igCreateMediaContainer({ igUserId: prof.igUserId, igToken: prof.igToken, imageUrl, caption });
    await igWaitReady(prof.igToken, cid);
    return igPublishContainer({ igUserId: prof.igUserId, igToken: prof.igToken, creationId: cid });
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  7. INSTAGRAM — endpoints públicos
// ════════════════════════════════════════════════════════════════════════════

// Publicação imediata — feed único
app.post('/api/instagram/post', async (req, res) => {
  try {
    const { profile, imageUrl, caption } = req.body;
    if (!profile || !imageUrl) return res.status(400).json({ error: 'profile e imageUrl obrigatórios' });
    const prof = PROFILES[profile];
    if (!prof) return res.status(400).json({ error: 'Perfil inválido' });
    const igPostId = await publishToIG(prof, { imageUrl, caption: caption || '', postType: 'single' });
    res.json({ success: true, igPostId, message: 'Post publicado com sucesso!' });
  } catch (err) {
    console.error('IG post error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Publicação imediata — carrossel
app.post('/api/instagram/carousel', async (req, res) => {
  try {
    const { profile, imageUrls, caption } = req.body;
    if (!profile || !imageUrls?.length) return res.status(400).json({ error: 'profile e imageUrls obrigatórios' });
    if (imageUrls.length < 2 || imageUrls.length > 10) return res.status(400).json({ error: 'Carrossel requer 2–10 imagens' });
    const prof = PROFILES[profile];
    if (!prof) return res.status(400).json({ error: 'Perfil inválido' });
    const igPostId = await publishToIG(prof, { imageUrls, caption: caption || '', postType: 'carousel' });
    res.json({ success: true, igPostId, message: `Carrossel com ${imageUrls.length} slides publicado!` });
  } catch (err) {
    console.error('IG carousel error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Agendamento de post
const scheduledPosts = [];

app.post('/api/instagram/schedule', async (req, res) => {
  try {
    const { profile, imageUrl, imageUrls, caption, scheduledTime, postType = 'single' } = req.body;
    if (!profile || !scheduledTime) return res.status(400).json({ error: 'profile e scheduledTime obrigatórios' });

    const schedDate = new Date(scheduledTime);
    if (isNaN(schedDate.getTime()))   return res.status(400).json({ error: 'scheduledTime inválido (use ISO 8601)' });
    if (schedDate <= new Date())      return res.status(400).json({ error: 'scheduledTime deve ser no futuro' });

    const prof = PROFILES[profile];
    if (!prof) return res.status(400).json({ error: 'Perfil inválido' });

    const schedId = `sched_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    const record = { id: schedId, profile, postType, imageUrl, imageUrls, caption: caption || '', scheduledTime: schedDate.toISOString(), status: 'scheduled', createdAt: new Date().toISOString() };
    scheduledPosts.push(record);

    const delay = schedDate.getTime() - Date.now();
    setTimeout(async () => {
      const p = scheduledPosts.find(x => x.id === schedId);
      if (!p || p.status !== 'scheduled') return;
      p.status = 'publishing';
      try {
        const igPostId = await publishToIG(prof, { imageUrl: p.imageUrl, imageUrls: p.imageUrls, caption: p.caption, postType: p.postType });
        p.status = 'published';
        p.igPostId = igPostId;
        p.publishedAt = new Date().toISOString();
        console.log(`✅ Agendado publicado: ${schedId} → IG: ${igPostId}`);
      } catch (err) {
        p.status = 'error';
        p.error = err.message;
        console.error(`❌ Falha no agendado ${schedId}:`, err.message);
      }
    }, delay);

    res.json({ success: true, schedId, scheduledTime: schedDate.toISOString(), message: `Agendado para ${schedDate.toLocaleString('pt-BR')}` });
  } catch (err) {
    console.error('Schedule error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/instagram/scheduled', (req, res) => {
  const { profile } = req.query;
  const list = profile ? scheduledPosts.filter(p => p.profile === profile) : scheduledPosts;
  res.json({ success: true, posts: list.filter(p => p.status !== 'cancelled').sort((a,b) => new Date(a.scheduledTime) - new Date(b.scheduledTime)) });
});

app.delete('/api/instagram/scheduled/:id', (req, res) => {
  const p = scheduledPosts.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Agendamento não encontrado' });
  if (p.status === 'published') return res.status(400).json({ error: 'Post já publicado, não pode cancelar' });
  p.status = 'cancelled';
  res.json({ success: true, message: 'Agendamento cancelado' });
});

app.get('/api/instagram/insights/:profile', async (req, res) => {
  try {
    const prof = PROFILES[req.params.profile];
    if (!prof) return res.status(400).json({ error: 'Perfil inválido' });
    if (!prof.igUserId || !prof.igToken) return res.status(400).json({ error: 'Credenciais não configuradas' });
    const fields = 'followers_count,media_count,profile_picture_url,name,biography';
    const r = await fetch(`https://graph.facebook.com/v21.0/${prof.igUserId}?fields=${fields}&access_token=${prof.igToken}`);
    const d = await r.json();
    if (!r.ok) throw new Error(d.error?.message || 'Erro nos insights');
    res.json({ success: true, insights: d });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  8. UPLOAD DE IMAGEM (gera URL pública para passar ao IG)
// ════════════════════════════════════════════════════════════════════════════
app.post('/api/upload-image', uploadImage.single('image'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Imagem não enviada' });
    const baseUrl = process.env.PUBLIC_URL || process.env.BASE_URL || `https://${req.get('host')}`;
    const imageUrl = `${baseUrl}/uploads/${req.file.filename}`;
    res.json({ success: true, imageUrl, filename: req.file.filename });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.use('/uploads', express.static('uploads'));

// ════════════════════════════════════════════════════════════════════════════
//  9. HEALTH CHECK
// ════════════════════════════════════════════════════════════════════════════
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    profiles: Object.keys(PROFILES),
    pendingScheduled: scheduledPosts.filter(p => p.status === 'scheduled').length,
    env: {
      claude:   !!process.env.ANTHROPIC_API_KEY,
      gemini:   !!process.env.GEMINI_API_KEY,
      openai:   !!process.env.OPENAI_API_KEY,
      igToken:  !!process.env.INSTAGRAM_ACCESS_TOKEN,
      igMarca:  !!process.env.INSTAGRAM_ACCOUNT_ID_MARCA,
      igPessoal:!!process.env.INSTAGRAM_ACCOUNT_ID_PESSOAL,
      publicUrl: process.env.PUBLIC_URL || process.env.BASE_URL || 'não configurado'
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Máquina de Criativos rodando na porta ${PORT}`));
