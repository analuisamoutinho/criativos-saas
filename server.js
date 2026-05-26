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
const CALENDAR_FILE  = path.join(DATA_DIR, 'calendar_data.json');
const MANUALS_DIR    = path.join(DATA_DIR, 'manuals');

// ── Supabase ──────────────────────────────────────────────────────────────────
// npm install @supabase/supabase-js
// Variáveis: SUPABASE_URL + SUPABASE_SERVICE_KEY
let supabase = null;
try {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
    const { createClient } = require('@supabase/supabase-js');
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    console.log('✅ Supabase conectado');
  } else {
    console.log('⚠️  Supabase não configurado — usando ficheiros locais como fallback');
  }
} catch(e) {
  console.log('⚠️  @supabase/supabase-js não instalado — usando ficheiros locais');
}

// ── Helpers Supabase com fallback para JSON local ─────────────────────────────
async function dbUpsert(table, row) {
  if (supabase) {
    const { error } = await supabase.from(table).upsert(row, { onConflict: 'id' });
    if (error) throw error;
  }
}
async function dbSelect(table, filters = {}) {
  if (supabase) {
    let q = supabase.from(table).select('*');
    for (const [col, val] of Object.entries(filters)) q = q.eq(col, val);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }
  return [];
}
async function dbDelete(table, id) {
  if (supabase) {
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) throw error;
  }
}

// Garantir dirs de upload (readJSON/writeJSON cuidam dos JSON automaticamente)
try { fs.mkdirSync('uploads/', { recursive: true }); } catch(e) {}
try { fs.mkdirSync(MANUALS_DIR, { recursive: true }); } catch(e) {}

// ── Helpers ───────────────────────────────────────────────────────────────────
function ensureFile(file, defaultContent = '[]') {
  try {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(file)) fs.writeFileSync(file, defaultContent, 'utf-8');
  } catch(e) { console.error('ensureFile error:', file, e.message); }
}

function readJSON(file) {
  try {
    ensureFile(file);
    const raw = fs.readFileSync(file, 'utf-8').trim();
    if (!raw) return [];
    return JSON.parse(raw);
  } catch(e) {
    console.error('readJSON error:', file, e.message);
    return [];
  }
}

function writeJSON(file, data) {
  try {
    ensureFile(file);
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
  } catch(e) {
    console.error('writeJSON error:', file, e.message);
  }
}

// Salva criativo na base geral
function saveGeneratedContent(item) {
  // Local fallback
  const all = readJSON(GENERATED_FILE);
  all.unshift(item);
  writeJSON(GENERATED_FILE, all);
  // Supabase (fire-and-forget)
  if (supabase) {
    supabase.from('generated_content').upsert({
      id:                  item.id,
      profile:             item.profile,
      type:                item.type,
      status:              item.status,
      topic:               item.topic || null,
      caption:             item.caption || null,
      hashtags:            item.hashtags || null,
      carousel_data:       item.carouselData ? JSON.stringify(item.carouselData) : null,
      content_machine_type: item.contentMachineType || null,
      calendar_day:        item.calendarDay || null,
      calendar_month:      item.calendarMonth || null,
      calendar_year:       item.calendarYear || null,
      created_at:          item.createdAt,
    }, { onConflict: 'id' }).then(({ error }) => {
      if (error) console.error('Supabase save error:', error.message);
    });
  }
  return item;
}

// Atualiza status de um criativo
function updateContentStatus(id, status, extra = {}) {
  // Local
  const all = readJSON(GENERATED_FILE);
  const idx = all.findIndex(i => i.id === id);
  if (idx !== -1) { all[idx] = { ...all[idx], status, ...extra }; writeJSON(GENERATED_FILE, all); }
  // Supabase
  if (supabase) {
    supabase.from('generated_content').update({ status, ...extra }).eq('id', id)
      .then(({ error }) => { if (error) console.error('Supabase update error:', error.message); });
  }
}

async function loadGeneratedContent(profile) {
  if (supabase) {
    const { data, error } = await supabase.from('generated_content')
      .select('*').eq('profile', profile).order('created_at', { ascending: false });
    if (!error && data?.length) {
      return data.map(r => ({
        id: r.id, profile: r.profile, type: r.type, status: r.status,
        topic: r.topic, caption: r.caption, hashtags: r.hashtags,
        carouselData: r.carousel_data ? JSON.parse(r.carousel_data) : null,
        contentMachineType: r.content_machine_type,
        calendarDay: r.calendar_day, calendarMonth: r.calendar_month, calendarYear: r.calendar_year,
        createdAt: r.created_at,
      }));
    }
  }
  return readJSON(GENERATED_FILE).filter(i => !profile || i.profile === profile);
}

// ── Accounts ─────────────────────────────────────────────────────────────────
const ACCOUNTS = {
  marca:   { id: process.env.INSTAGRAM_ACCOUNT_ID_MARCA,    token: process.env.INSTAGRAM_TOKEN_MARCA,    name: 'Case Aceleradora', handle: '@caseaceleradora'   },
  pessoal: { id: process.env.INSTAGRAM_ACCOUNT_ID_PESSOAL,  token: process.env.INSTAGRAM_TOKEN_PESSOAL,  name: 'Ana Moutinho',      handle: '@analuisa.moutinho' },
  virttus: { id: process.env.INSTAGRAM_ACCOUNT_ID_VIRTTUS,  token: process.env.INSTAGRAM_TOKEN_VIRTTUS,  name: 'Virttus',           handle: '@virttus'           },
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
  return '[Manual do cliente carregado — usar diretrizes de tom, cores e linguagem definidas no PDF]';
}

// ── Banco de fotos pessoais ───────────────────────────────────────────────────
const PHOTOS_DIR  = path.join(DATA_DIR, 'photos');
const PHOTOS_FILE = path.join(DATA_DIR, 'photos_meta.json');
const photoUpload = multer({
  dest: 'uploads/photos/',
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Apenas imagens são permitidas'));
  },
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

if (!fs.existsSync(PHOTOS_DIR))  fs.mkdirSync(PHOTOS_DIR, { recursive: true });
if (!fs.existsSync(PHOTOS_FILE)) fs.writeFileSync(PHOTOS_FILE, '[]');
if (!fs.existsSync('uploads/photos/')) fs.mkdirSync('uploads/photos/', { recursive: true });

// Upload de foto
app.post('/api/photos/upload', photoUpload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhum ficheiro enviado' });
    const { profile = 'pessoal', tags = '', description = '' } = req.body;

    const ext  = path.extname(req.file.originalname) || '.jpg';
    const id   = `photo_${Date.now()}`;
    const dest = path.join(PHOTOS_DIR, `${id}${ext}`);
    fs.renameSync(req.file.path, dest);

    // Ler como base64 para servir no frontend
    const b64 = fs.readFileSync(dest).toString('base64');
    const mime = req.file.mimetype || 'image/jpeg';
    const dataUrl = `data:${mime};base64,${b64}`;

    const meta = {
      id, profile,
      filename: `${id}${ext}`,
      originalName: req.file.originalname,
      tags: tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      description,
      uploadedAt: new Date().toISOString(),
      dataUrl,
    };

    const all = readJSON(PHOTOS_FILE);
    all.unshift(meta);
    writeJSON(PHOTOS_FILE, all);

    res.json({ success: true, photo: meta });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Listar fotos
app.get('/api/photos', (req, res) => {
  const { profile, tag } = req.query;
  let all = readJSON(PHOTOS_FILE);
  if (profile) all = all.filter(p => p.profile === profile);
  if (tag)     all = all.filter(p => p.tags.includes(tag));
  res.json(all.map(({ dataUrl, ...rest }) => rest));
});

// !! DEVE VIR ANTES DE /api/photos/:id — senão "suggest" é tratado como um :id
// Sugerir fotos relevantes para um tema (Claude analisa tags/descrições)
app.post('/api/photos/suggest', async (req, res) => {
  try {
    const { topic, profile = 'pessoal', limit = 3 } = req.body;
    const all = readJSON(PHOTOS_FILE).filter(p => p.profile === profile);
    if (!all.length) return res.json({ suggestions: [] });

    const photoList = all.map(p => `ID: ${p.id} | Tags: ${p.tags.join(', ')} | Descrição: ${p.description}`).join('\n');
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 512,
        messages: [{ role: 'user', content: `Dado este tema de post para Instagram: "${topic}"\n\nEstas são as fotos disponíveis no banco:\n${photoList}\n\nSeleciona até ${limit} IDs de fotos que melhor se encaixam com o tema. Responde APENAS com JSON: {"suggestions": ["id1", "id2"]}` }],
      }),
    });
    const d = await r.json();
    const text = d.content[0].text;
    const match = text.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) : { suggestions: [] };

    const allFull = readJSON(PHOTOS_FILE);
    const photos = parsed.suggestions
      .map(id => allFull.find(p => p.id === id))
      .filter(Boolean);

    res.json({ suggestions: photos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Servir foto por id  (rotas com :id SEMPRE depois das rotas literais)
app.get('/api/photos/:id', (req, res) => {
  const all = readJSON(PHOTOS_FILE);
  const photo = all.find(p => p.id === req.params.id);
  if (!photo) return res.status(404).json({ error: 'Foto não encontrada' });
  res.json(photo);
});

// Apagar foto
app.delete('/api/photos/:id', (req, res) => {
  let all = readJSON(PHOTOS_FILE);
  const photo = all.find(p => p.id === req.params.id);
  if (!photo) return res.status(404).json({ error: 'Foto não encontrada' });
  const filePath = path.join(PHOTOS_DIR, photo.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  all = all.filter(p => p.id !== req.params.id);
  writeJSON(PHOTOS_FILE, all);
  res.json({ success: true });
});

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
    const { month, year, profile, postsPerDay = 2 } = req.body;
    const manualNote = getManualText(profile);
    const account = getAccount(profile);
    const daysInMonth = new Date(year, month, 0).getDate();

    // Gerar em blocos de 10 dias para evitar truncamento do JSON
    const BLOCK = 10;
    const allDays = [];

    for (let blockStart = 1; blockStart <= daysInMonth; blockStart += BLOCK) {
      const blockEnd = Math.min(blockStart + BLOCK - 1, daysInMonth);

      const blockPrompt = `Você é o estrategista de conteúdo da BrandsDecoded criando o calendário editorial de ${account.name} (${account.handle}) para ${month}/${year}.

METODOLOGIA BRANDECODED — SEGUIR OBRIGATORIAMENTE:

O Instagram em 2026 é uma plataforma de DESCOBERTA. Todo post deve funcionar para quem NUNCA viu o perfil.
As métricas que importam: tempo de retenção, compartilhamentos, saves. Curtidas são secundárias.

TIPOS DE POST (usar APENAS estes):
- "tendencia": Análise de Tendência — pega movimento cultural/mercado em alta e analisa com profundidade. É o tipo mais poderoso para alcance orgânico. Ex: mudança de comportamento da Gen Z, tendência de mercado emergente, fenômeno cultural.
- "case": Case de Sucesso — conta a história de uma marca/pessoa/empresa explicando por que deu certo OU deu errado. Alto compartilhamento porque as pessoas querem repostar. Mencionar marcas conhecidas gera collab espontâneo.
- "educativo": Framework ou conceito aplicado com passo a passo. Não dicas genéricas — um método específico com nome.
- "comparacao": Antes/depois, certo/errado, velho/novo. Alto alcance, bom para saves.
- "lista": Lista de insights, erros ou verdades sobre um tema. Fácil de consumir.
- "prova_social": Resultado de cliente real ou conquista da marca. Bom para conversão, menor alcance orgânico.
- "oferta": Apresentação de produto/serviço envolto em valor. Usar no máximo 1x por semana.

PERFIL: ${account.name} (${account.handle})
${manualNote ? 'DIRETRIZES DO CLIENTE:\n' + manualNote : ''}

DISTRIBUIÇÃO DE TIPOS NO BLOCO (dias ${blockStart}–${blockEnd}):
- 40% tendencia
- 30% case
- 15% educativo + comparacao + lista (variar entre eles)
- 15% prova_social + oferta (nunca dois seguidos)

REGRAS DE HORÁRIO E DISTRIBUIÇÃO:
- Terça, quarta, quinta: até ${postsPerDay} posts/dia
- Segunda, sexta: 1-2 posts
- Sábado, domingo: 1 post máximo
- Horários: 09:00, 12:00, 18:00 (escolher os mais adequados ao tipo)

REGRA DE QUALIDADE DO TOPIC — CRÍTICO:
O "topic" é o tema central que será desenvolvido no carrossel. Deve ser:
✅ ESPECÍFICO — nomear empresa, pessoa, fenômeno ou dado concreto
✅ COM ÂNGULO — não só o tema, mas o ponto de vista sobre ele
✅ PARA DESCONHECIDOS — qualquer pessoa deve querer ver mesmo sem conhecer o perfil

EXEMPLOS DE TOPICS QUE FUNCIONAM:
- "Por que a Shein destruiu o varejo físico brasileiro enquanto as marcas dormiam"
- "O método que a Nubank usou para transformar reclamação em fidelização — e o que toda empresa pode copiar"
- "A geração Z trocou o emprego pelo PJ — e os RHs ainda não entenderam o que mudou"
- "Como o Corinthians virou o clube mais seguido do Brasil sem gastar R$1 em influencer"
- "O erro que quebrou a [marca conhecida] e a lição que nenhum empresário quer ouvir"

EXEMPLOS DE TOPICS QUE NÃO FUNCIONAM (PROIBIDOS):
- "Dicas de marketing digital"
- "Como crescer no Instagram"
- "Motivação para empreendedores"
- "A importância do planejamento"
- "Post sobre nossos valores"

Responde APENAS com JSON válido — sem texto antes ou depois, sem truncar:
{
  "days": [
    {
      "day": ${blockStart},
      "posts": [
        { "time": "09:00", "type": "tendencia", "topic": "tema específico com ângulo claro" }
      ]
    }
  ]
}

Inclui TODOS os dias de ${blockStart} a ${blockEnd}. JSON completo e válido.`;

      const blockRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 3000,
          messages: [{ role: 'user', content: blockPrompt }],
        }),
      });

      const blockData = await blockRes.json();
      if (blockData.error) throw new Error(blockData.error.message);

      let blockText = blockData.content[0].text.trim();
      const blockMatch = blockText.match(/\{[\s\S]*\}/);
      if (blockMatch) blockText = blockMatch[0];
      const blockParsed = JSON.parse(blockText);
      allDays.push(...(blockParsed.days || []));
    }

    // Montar calendário final
    const calendar = { calendar: allDays };

    // Cruzar com criativos já gerados/agendados/publicados
    const generated = readJSON(GENERATED_FILE).filter(g => g.profile === profile);
    calendar.calendar = calendar.calendar.map(dayEntry => ({
      ...dayEntry,
      posts: (dayEntry.posts || []).map(post => {
        const postDate = new Date(year, month - 1, dayEntry.day);
        const dateStr  = postDate.toISOString().split('T')[0];
        const match    = generated.find(g =>
          g.calendarDay === dayEntry.day &&
          g.calendarMonth === month &&
          g.calendarYear  === year
        );
        return {
          ...post,
          date: dateStr,
          contentId:   match?.id || null,
          status:      match?.status || 'pendente',
          scheduledAt: match?.scheduledAt || null,
        };
      }),
    }));

    // Persistir calendário para sobreviver a restarts
    writeJSON(CALENDAR_FILE, { profile, month, year, ...calendar });
    if (supabase) {
      supabase.from('calendars').upsert({
        id: `${profile}_${year}_${month}`,
        profile, month, year,
        data: JSON.stringify(calendar.calendar),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' }).then(({ error }) => {
        if (error) console.error('Supabase calendar save error:', error.message);
      });
    }

    res.json(calendar);
  } catch (err) {
    console.error('Calendar error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Carregar calendário guardado ─────────────────────────────────────────────
app.get('/api/calendar/saved', async (req, res) => {
  try {
    const { profile, month, year } = req.query;
    if (supabase) {
      const { data, error } = await supabase.from('calendars')
        .select('data').eq('id', `${profile}_${year}_${month}`).single();
      if (!error && data?.data) {
        return res.json({ found: true, calendar: JSON.parse(data.data) });
      }
    }
    // Fallback local
    const saved = readJSON(CALENDAR_FILE);
    if (saved?.profile === profile && String(saved.month) === String(month) && String(saved.year) === String(year)) {
      return res.json({ found: true, calendar: saved.calendar });
    }
    res.json({ found: false });
  } catch(e) {
    res.json({ found: false });
  }
});


// ── Gerar + Salvar carrossel na base ─────────────────────────────────────────
// Modos:
//   - "blocks": o utilizador cola blocos de texto prontos (ex: # Bloco 1 ... # Bloco 2)
//               a IA organiza cada bloco em 1 slide, sem alterar o conteúdo
//   - "topic":  o utilizador dá só um tema/tópico e a IA cria tudo do zero
// Sem limite de slides — a IA decide quantos fazem sentido para o conteúdo
app.post('/api/carousel/generate-and-save', async (req, res) => {
  try {
    const { topic, blocks, profile, calendarDay, calendarMonth, calendarYear, caption, hashtags, contentMachineType } = req.body;
    const manualNote = getManualText(profile);
    const account = getAccount(profile);
    const mode = blocks ? 'blocks' : 'topic';

    // ── SYSTEM PROMPT: BrandsDecoded Methodology ──────────────────────────────
    const systemPrompt = `Você é o gerador de carrosseis da BrandsDecoded — o padrão mais alto de copy para Instagram no Brasil.

PRINCÍPIOS FUNDAMENTAIS:
1. O Instagram é uma plataforma de DESCOBERTA. Cada carrossel deve funcionar para quem NUNCA viu o perfil.
2. Carrossel não é design. É copy. O que move o dedo para o próximo slide é a tensão narrativa, não a paleta de cores.
3. O carrossel funciona como funil interno: capa para o desconhecido → tração → avanço → CTA.

CONTRATO DA CAPA (slides 1 e 2) — O MAIS IMPORTANTE:
Slide 1 (hook): 14-18 palavras. Estrutura preferencial: afirmação provocativa + dois-pontos + pergunta. Deve parar o scroll de um estranho. Ativar tensão, curiosidade, identidade ou alerta. NUNCA começar com Descubra/Saiba/Aprenda/Conheça.
Slide 2 (sub-hook): 8-12 palavras. Aprofunda ou tensiona o slide 1. Não entrega a resolução. Funciona isoladamente. Não começa com conectivo (E, Mas, Porém, Então).

PADRÕES DE HEADLINE DE ALTA PERFORMANCE:
1. Brasil/contexto nacional — conectar à identidade ou fenômeno brasileiro
2. Fim/Morte/Crise — mudança estrutural, colapso, transformação cultural
3. Geracional — Gen Z, Millennials, comportamento por faixa etária
4. Novidade — nova tendência, nova lógica, fenômeno emergente
5. Investigando — tom jornalístico, documental, analítico
6. Contraste — velho vs novo, status vs saúde, algoritmo vs autenticidade
7. Nome próprio/Referência pop — marca ou fenômeno como âncora de atenção

PROGRESSÃO NARRATIVA OBRIGATÓRIA:
- Slides 1-2: CAPA — parar o scroll
- Slides 3-4: TRAÇÃO — contextualizar a tensão, mais argumentos para continuar
- Slides 5-7: AVANÇO — mecanismo, evidências observáveis, por que acontece
- Slides 8-9: CONSEQUÊNCIA — implicação, o que muda, lição transferível
- Slide final: CTA — convite específico (comentar palavra-chave, seguir, guardar)

PROIBIDO em qualquer slide:
- Travessão (—)
- "virou" em headline
- "a ascensão de", "o impacto de", "não é X, é Y"
- "e isso muda tudo", "no fim das contas", "o ponto é", "colapso silencioso"
- Frases genéricas com cara de IA
- 2ª pessoa nos slides de desenvolvimento (só no CTA)
- Inventar fatos, números, datas ou fontes

Retornar APENAS JSON válido, sem markdown, sem texto antes ou depois.`;

    let prompt;

    if (mode === 'blocks') {
      prompt = `Modo: BLOCOS DE TEXTO
Perfil: ${account.name} (${account.handle})
${manualNote ? 'Diretrizes: ' + manualNote : ''}

Os blocos abaixo devem virar exatamente 1 slide cada. Preservar o texto original de cada bloco — apenas gerar o imagePrompt para cada um.

BLOCOS:
${blocks}

Retornar APENAS JSON:
{
  "title": "título interno (não aparece no post)",
  "slideCount": <número>,
  "slides": [
    {
      "slideNumber": 1,
      "heading": "texto principal preservado do bloco",
      "body": "texto secundário se houver (vazio se não houver)",
      "imagePrompt": "prompt em inglês para imagem de fundo: ambiente, luz, composição, paleta de cores — alinhado ao tom do texto. Absolutamente sem texto na imagem."
    }
  ],
  "caption": "legenda completa para Instagram com emojis, contexto e CTA claro",
  "hashtags": "#hashtag1 #hashtag2 #hashtag3"
}`;

    } else {
      // Modo tópico com tipo BrandsDecoded
      const tipoInstrucoes = {
        tendencia: `TIPO: ANÁLISE DE TENDÊNCIA
Objetivo: pegar movimento cultural/mercado em alta e analisar com profundidade jornalística.
A capa deve tratar o tema como fenômeno, não como notícia.
Slides 3-4: por que essa tendência está acontecendo agora, evidências observáveis.
Slides 5-7: implicações para o mercado/comportamento.
Slides 8-9: o que isso significa para o leitor.`,

        case: `TIPO: CASE DE SUCESSO
Objetivo: contar a história de uma empresa/pessoa/marca explicando o ponto de virada.
A capa deve tratar o case como fenômeno cultural, não como perfil empresarial.
Slides 3-4: contexto — quem é, situação de partida.
Slides 5-6: O PONTO DE VIRADA — a decisão que transformou tudo.
Slides 7-8: resultados e números verificáveis.
Slide 9: lição prática transferível para o leitor.`,

        educativo: `TIPO: EDUCATIVO / FRAMEWORK
Objetivo: ensinar um método específico com nome, não dicas genéricas.
A capa deve prometer um aprendizado concreto e acionável.
Slides 3-9: um passo ou princípio por slide, com exemplo concreto.`,

        comparacao: `TIPO: COMPARAÇÃO / ANTES & DEPOIS
Objetivo: mostrar contraste real entre dois cenários.
A capa deve ativar o contraste imediatamente.
Slides 3-5: Lado A (cenário ruim/antigo), com detalhes reais.
Slide 6: o ponto de virada — o que separa os dois lados.
Slides 7-9: Lado B (cenário bom/novo), com resultados concretos.`,

        lista: `TIPO: LISTA VALIOSA
Objetivo: entregar valor comprimido em itens acionáveis.
A capa deve ter número específico e promessa de valor real.
Slides 3-9: um item por slide, com 2-3 frases de desenvolvimento cada.`,

        prova_social: `TIPO: PROVA SOCIAL
Objetivo: mostrar resultado de cliente real ou conquista da marca.
A capa deve focar no resultado conquistado, não na marca.
Slide 3: situação antes — dor e frustração.
Slides 4-6: o processo — o que foi feito.
Slides 7-8: resultados com números verificáveis.
Slide 9: lição universal extraível.`,

        oferta: `TIPO: OFERTA
Objetivo: apresentar produto/serviço envolto em valor real, não em pitch.
A capa deve ativar desejo sem soar como anúncio.
Slides 3-4: o problema que resolve.
Slides 5-6: a solução e benefícios (não features).
Slide 7: para quem é.
Slide 8: prova.
Slide 9: o que inclui.`,
      };

      const instrucaoTipo = contentMachineType && tipoInstrucoes[contentMachineType]
        ? tipoInstrucoes[contentMachineType]
        : tipoInstrucoes.tendencia;

      prompt = `Perfil: ${account.name} (${account.handle})
${manualNote ? 'Diretrizes do cliente: ' + manualNote + '\n' : ''}
Tema central: "${topic}"

${instrucaoTipo}

PROCESSO INTERNO ANTES DE GERAR OS SLIDES:
1. TRIAGEM: identificar a fricção central do tema (tensão real, não só resumo), o ângulo narrativo mais forte, evidências observáveis.
2. HEADLINE: gerar internamente a capa mais forte possível com o tema. Verificar: 14-18 palavras, padrão de alta performance usado, checklist de interrupção/relevância/clareza/tensão.
3. ESPINHA DORSAL: definir internamente hook (slides 3-4), mecanismo (slides 5-6), prova (slides 7-8), aplicação (slide 9), CTA (slide 10).
4. RENDER: gerar os slides com progressão — cada um abre micro-tensão que o próximo resolve parcialmente.

Total de slides: 10 (seguir a estrutura de 18 textos em 10-15 slides).
Slide 1 + Slide 2 = capa (hook 14-18 palavras + sub-hook 8-12 palavras).

Retornar APENAS JSON:
{
  "title": "título interno",
  "slideCount": 10,
  "slides": [
    { "slideNumber": 1, "heading": "hook 14-18 palavras", "body": "", "imagePrompt": "prompt em inglês para imagem de fundo, sem texto na imagem" },
    { "slideNumber": 2, "heading": "sub-hook 8-12 palavras", "body": "", "imagePrompt": "..." },
    { "slideNumber": 3, "heading": "título da secção 11-15 palavras", "body": "parágrafo 25-32 palavras", "imagePrompt": "..." },
    { "slideNumber": 4, "heading": "", "body": "parágrafo 25-32 palavras", "imagePrompt": "..." },
    { "slideNumber": 5, "heading": "título da secção 11-15 palavras", "body": "parágrafo 25-32 palavras", "imagePrompt": "..." },
    { "slideNumber": 6, "heading": "", "body": "parágrafo curto 22-26 palavras", "imagePrompt": "..." },
    { "slideNumber": 7, "heading": "título da secção 11-15 palavras", "body": "parágrafo 25-32 palavras", "imagePrompt": "..." },
    { "slideNumber": 8, "heading": "", "body": "parágrafo 25-32 palavras", "imagePrompt": "..." },
    { "slideNumber": 9, "heading": "", "body": "fechamento 26-30 palavras", "imagePrompt": "..." },
    { "slideNumber": 10, "heading": "CTA específico com palavra-chave para comentar", "body": "", "imagePrompt": "..." }
  ],
  "caption": "legenda completa com emojis, contexto e CTA claro",
  "hashtags": "#hashtag1 #hashtag2 #hashtag3"
}`;
    }

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 8192,
        system: systemPrompt,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const d = await r.json();
    if (d.error) return res.status(500).json({ error: d.error.message });

    let text = d.content[0].text.trim();
    const matchJson = text.match(/\{[\s\S]*\}/);
    if (matchJson) text = matchJson[0];
    const carouselData = JSON.parse(text);

    const item = saveGeneratedContent({
      id: `cnt_${Date.now()}`,
      createdAt: new Date().toISOString(),
      status: 'pendente',
      type: 'carrossel',
      mode,
      profile,
      topic: topic || `Carrossel ${carouselData.slideCount} slides`,
      caption: caption || carouselData.caption,
      hashtags: hashtags || carouselData.hashtags,
      contentMachineType: contentMachineType || null,
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
// ── Content Machine — geração de copy via GPT-4o (BrandsDecoded) ─────────────
app.post('/api/content-machine/generate', async (req, res) => {
  try {
    const { tipo, tema, profile } = req.body;
    if (!tipo || !tema) return res.status(400).json({ error: 'Faltam campos: tipo e tema são obrigatórios.' });

    const manualNote = getManualText(profile);
    const account = getAccount(profile);

    const tipoLabels = {
      tendencia:'Análise de Tendência', case:'Case de Sucesso',
      educativo:'Educativo / Framework', comparacao:'Comparação / Antes & Depois',
      lista:'Lista Valiosa', prova_social:'Prova Social', oferta:'Oferta', dump:'Dump / Bastidores',
    };

    const systemPrompt = `Você é o gerador oficial de carrosseis de alta performance da BrandsDecoded, combinando o Content Machine 5.4 e o Headline Generator.

MISSÃO: gerar carrosseis com headlines que capturam atenção no feed, progressão narrativa coesa entre slides e copy que não parece produzida por IA.

REGRAS GLOBAIS:
- Nunca inventar fatos, números, datas, locais ou fontes.
- Proibido travessão (—) em qualquer saída.
- Proibido em headline: "quando X vira Y", "a ascensão de", "o impacto de", "não é X, é Y", "virou".
- Proibido como abertura: "Descubra", "Saiba", "Conheça", "Aprenda".
- Proibido AI slop: frases genéricas, jargão corporativo, abstrações vazias, "e isso muda tudo", "no fim das contas", "o ponto é", "colapso silencioso", "menos X, mais Y".
- Sem 2ª pessoa nos slides de desenvolvimento. Apenas no CTA.
- Sem bullets dentro dos textos dos slides.
- Sempre em português do Brasil.
- Apenas fatos verificáveis e observáveis.

CONTRATO DA CAPA:
Slide 1 (hook): 14-18 palavras. Estrutura: afirmação provocativa + dois-pontos + pergunta. Abrir tensão, não resolver. Funcionar isoladamente.
Slide 2 (sub-hook): 8-12 palavras. Tensionar ou concretizar o slide 1. Não entregar resolução. Não começar com conectivo (E, Mas, Porém, Então).

PADRÕES DE ALTA PERFORMANCE (priorizar quando o tema permitir):
1. Brasil/contexto nacional, 2. Fim/Morte/Crise, 3. Geracional, 4. Novidade,
5. Investigando (tom jornalístico), 6. Contraste/Antítese, 7. Pergunta Geracional, 8. Nome próprio/Referência pop

GATILHOS EMOCIONAIS: ativar pelo menos 2 em simultâneo: nostalgia, medo/alerta, indignação, identidade, curiosidade, aspiração.

EXEMPLOS ÂNCORA (referência de forma, não copiar):
- A Morte do Gosto Pessoal: Como a Dopamina Digital Nos Tornou Indiferentes
- Por que a Gen Z Parou de Vestir a Camisa e Começou a Tratar Emprego Como Contrato
- Investigando o Grupo de Pais que Está Criando Seus Filhos com Telefone Fixo
- O fim do complexo de vira-lata: por que a estética brasileira virou a nova referência global?

ESTRUTURA DE 18 TEXTOS EM 10-13 SLIDES:
Os 18 textos são unidades de copy — não são 18 slides. Múltiplos textos podem ocupar o mesmo slide.
textos 1-2 = capa (sempre no slide 1, juntos)
textos 3,7,11,14 = títulos de secção (11-15 palavras)
textos 4,5,8,9,12,13,15,16 = parágrafos (25-32 palavras)
textos 6,10 = parágrafos curtos de transição (22-26 palavras)
texto 17 = fechamento real (26-30 palavras)
texto 18 = assinatura fixa

ASSINATURA FIXA (texto 18 — sempre exatamente assim):
Gostou desse conteúdo? Aproveite para seguir nosso perfil. E caso queira saber sobre o nosso acompanhamento, comente "CASE" que nossa equipe te chama.

PROGRESSÃO NARRATIVA:
Textos 1-2: CAPA. Textos 3-5: TRAÇÃO. Textos 6-10: AVANÇO/MECANISMO. Textos 11-16: CONSEQUÊNCIA/APLICAÇÃO. Texto 17: FECHAMENTO. Texto 18: ASSINATURA.
Cada texto abre micro-tensão que o próximo resolve parcialmente. Nunca repetir ideia do texto anterior.

RETORNAR APENAS JSON VÁLIDO, sem markdown, sem texto antes ou depois.`;

    const tipoInstrucoes = {
      tendencia:`TIPO: ANÁLISE DE TENDÊNCIA. Capa trata o movimento como fenômeno. Slides 3-4: por que acontece agora. Slides 5-7: implicações. Slides 8-9: o que muda para o leitor.`,
      case:`TIPO: CASE DE SUCESSO. Capa trata como fenômeno cultural. Slides 3-4: contexto e ponto de partida. Slides 5-6: o ponto de virada. Slides 7-8: resultados verificáveis. Slide 9: lição transferível.`,
      educativo:`TIPO: EDUCATIVO/FRAMEWORK. Capa promete método específico com nome. Slides 3-9: um passo ou princípio por slide com exemplo concreto.`,
      comparacao:`TIPO: COMPARAÇÃO. Capa activa contraste. Slides 3-5: Lado A (cenário ruim). Slide 6: ponto de virada. Slides 7-9: Lado B (cenário bom com resultados).`,
      lista:`TIPO: LISTA VALIOSA. Capa com número específico e promessa real. Slides 3-9: um item por slide com 2-3 frases de desenvolvimento.`,
      prova_social:`TIPO: PROVA SOCIAL. Capa foca no resultado. Slide 3: situação antes. Slides 4-6: processo. Slides 7-8: resultados com números. Slide 9: lição universal.`,
      oferta:`TIPO: OFERTA. Capa activa desejo sem soar como anúncio. Slides 3-4: problema. Slides 5-6: solução/benefícios. Slide 7: para quem é. Slide 8: prova. Slide 9: o que inclui.`,
      dump:`TIPO: DUMP/BASTIDORES. Capa humaniza e gera curiosidade. Slides 3-7: momentos com narrativa. Slide 8: reflexão. Slide 9: conexão com missão.`,
    };

    const userPrompt = `Tipo: ${tipoLabels[tipo]||tipo}
Perfil: ${account.name} (${account.handle})
${manualNote ? `Diretrizes: ${manualNote}` : ''}
Tema: "${tema}"

${tipoInstrucoes[tipo]||tipoInstrucoes.tendencia}

PROCESSO INTERNO (executar antes de gerar o JSON):
1. TRIAGEM: identificar fricção central, ângulo narrativo dominante, evidências observáveis A/B/C.
2. HEADLINE: gerar internamente a headline mais forte. Verificar padrão usado, contagem de palavras (14-18 / 8-12), checklist interrupção/relevância/clareza/tensão. Se morno, reescrever.
3. ESPINHA DORSAL: hook (textos 3-5), mecanismo (textos 6-10), aplicação (textos 11-16), fechamento (texto 17).
4. RENDER: gerar os 18 textos agrupados em slides.

REGRA DO JSON: cada objeto em "slides" = 1 imagem real. Cada slide tem "textos" com 1 ou 2 entradas. Slide 1 sempre com textos 1+2. Total de slides: 10-13. Total de textos: exatamente 18.

Retornar APENAS este JSON:
{
  "tipo": "${tipo}",
  "tipo_label": "${tipoLabels[tipo]||tipo}",
  "tema": "${tema}",
  "profile": "${profile}",
  "slides": [
    { "slide": 1, "funcao": "CAPA", "textos": [
        { "posicao": 1, "tipo": "hook",     "texto": "..." },
        { "posicao": 2, "tipo": "sub-hook", "texto": "..." }
    ]},
    { "slide": 2, "funcao": "TRAÇÃO", "textos": [
        { "posicao": 3, "tipo": "titulo",    "texto": "..." },
        { "posicao": 4, "tipo": "paragrafo", "texto": "..." }
    ]},
    { "slide": 3, "funcao": "TRAÇÃO", "textos": [
        { "posicao": 5, "tipo": "paragrafo", "texto": "..." }
    ]},
    { "slide": 4, "funcao": "TRANSIÇÃO", "textos": [
        { "posicao": 6, "tipo": "curto", "texto": "..." }
    ]},
    { "slide": 5, "funcao": "AVANÇO", "textos": [
        { "posicao": 7, "tipo": "titulo",    "texto": "..." },
        { "posicao": 8, "tipo": "paragrafo", "texto": "..." }
    ]},
    { "slide": 6, "funcao": "AVANÇO", "textos": [
        { "posicao": 9, "tipo": "paragrafo", "texto": "..." }
    ]},
    { "slide": 7, "funcao": "TRANSIÇÃO", "textos": [
        { "posicao": 10, "tipo": "curto", "texto": "..." }
    ]},
    { "slide": 8, "funcao": "CONSEQUÊNCIA", "textos": [
        { "posicao": 11, "tipo": "titulo",    "texto": "..." },
        { "posicao": 12, "tipo": "paragrafo", "texto": "..." }
    ]},
    { "slide": 9, "funcao": "CONSEQUÊNCIA", "textos": [
        { "posicao": 13, "tipo": "paragrafo", "texto": "..." }
    ]},
    { "slide": 10, "funcao": "APLICAÇÃO", "textos": [
        { "posicao": 14, "tipo": "titulo",    "texto": "..." },
        { "posicao": 15, "tipo": "paragrafo", "texto": "..." }
    ]},
    { "slide": 11, "funcao": "APLICAÇÃO", "textos": [
        { "posicao": 16, "tipo": "paragrafo", "texto": "..." }
    ]},
    { "slide": 12, "funcao": "FECHAMENTO", "textos": [
        { "posicao": 17, "tipo": "fechamento", "texto": "..." }
    ]},
    { "slide": 13, "funcao": "ASSINATURA", "textos": [
        { "posicao": 18, "tipo": "assinatura", "texto": "Gostou desse conteúdo? Aproveite para seguir nosso perfil. E caso queira saber sobre o nosso acompanhamento, comente \"CASE\" que nossa equipe te chama." }
    ]}
  ]
}`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o', temperature: 1.0, max_tokens: 4500,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt   },
        ],
      }),
    });

    const data = await response.json();
    if (data.error) return res.status(500).json({ error: data.error.message });

    let text = data.choices[0].message.content.trim();
    text = text.replace(/^```json\s*/i,'').replace(/```\s*$/i,'').trim();
    const parsed = JSON.parse(text);

    // Normalizar slides para heading/body (compatibilidade biblioteca)
    const slidesNorm = (parsed.slides||[]).map(s => {
      const txs = s.textos||[];
      return {
        slideNumber: s.slide, funcao: s.funcao||'',
        heading: txs[0]?.texto||'', body: txs[1]?.texto||'',
        tipoTexto1: txs[0]?.tipo||'', tipoTexto2: txs[1]?.tipo||'',
        textos: txs,
      };
    });

    const item = saveGeneratedContent({
      id: `cnt_${Date.now()}`,
      createdAt: new Date().toISOString(),
      status: 'pendente', type: 'carrossel',
      contentMachineType: tipo,
      contentMachineTypeLabel: tipoLabels[tipo]||tipo,
      profile, topic: tema,
      carouselData: { title: tema, slideCount: slidesNorm.length, slides: slidesNorm, caption:'', hashtags:'' },
    });

    res.json({ success:true, contentId:item.id, ...parsed, slidesNormalizados:slidesNorm });
  } catch (err) {
    console.error('Content Machine error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.use(express.static('public'));

// Rotas /api/* não encontradas → 404 JSON (nunca devolver index.html para API)
app.use('/api', (req, res) => {
  res.status(404).json({ error: `Rota não encontrada: ${req.method} ${req.originalUrl}` });
});
// SPA catch-all
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`🚀 Máquina de Conteúdo rodando na porta ${PORT}`));
