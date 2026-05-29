const express = require('express');
const cors    = require('cors');
const multer  = require('multer');
const fs      = require('fs');
const path    = require('path');
const fetch   = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const upload = multer({ dest: 'uploads/' });

const DATA_DIR       = fs.existsSync('/tmp') ? '/tmp' : '.';
const SCHEDULED_FILE = path.join(DATA_DIR, 'scheduled_posts.json');
const GENERATED_FILE = path.join(DATA_DIR, 'generated_content.json');
const CALENDAR_FILE  = path.join(DATA_DIR, 'calendar_data.json');
const MANUALS_DIR    = path.join(DATA_DIR, 'manuals');
const IMAGES_DIR     = path.join(DATA_DIR, 'carousel_images');

try { fs.mkdirSync('uploads/',        { recursive: true }); } catch(e) {}
try { fs.mkdirSync(MANUALS_DIR,       { recursive: true }); } catch(e) {}
try { fs.mkdirSync(IMAGES_DIR,        { recursive: true }); } catch(e) {}
try { fs.mkdirSync('uploads/photos/', { recursive: true }); } catch(e) {}

// ── Supabase ──────────────────────────────────────────────────────────────
let supabase = null;
try {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
    const { createClient } = require('@supabase/supabase-js');
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    console.log('✅ Supabase conectado');
  } else {
    console.log('⚠️  Supabase não configurado — usando ficheiros locais');
  }
} catch(e) {
  console.log('⚠️  Supabase não instalado — usando ficheiros locais');
}

// ── Helpers JSON ──────────────────────────────────────────────────────────
function ensureFile(file, def = '[]') {
  try {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(file)) fs.writeFileSync(file, def, 'utf-8');
  } catch(e) { console.error('ensureFile:', file, e.message); }
}
function readJSON(file) {
  try {
    ensureFile(file);
    const raw = fs.readFileSync(file, 'utf-8').trim();
    if (!raw) return [];
    return JSON.parse(raw);
  } catch(e) { console.error('readJSON:', file, e.message); return []; }
}
function writeJSON(file, data) {
  try {
    ensureFile(file);
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
  } catch(e) { console.error('writeJSON:', file, e.message); }
}

// ── Conteúdo gerado ───────────────────────────────────────────────────────
function saveGeneratedContent(item) {
  const all = readJSON(GENERATED_FILE);
  all.unshift(item);
  writeJSON(GENERATED_FILE, all);
  if (supabase) {
    supabase.from('generated_content').upsert({
      id: item.id, profile: item.profile, type: item.type,
      status: item.status, topic: item.topic || null,
      caption: item.caption || null, hashtags: item.hashtags || null,
      carousel_data: item.carouselData ? JSON.stringify(item.carouselData) : null,
      content_machine_type: item.contentMachineType || null,
      calendar_day: item.calendarDay || null,
      calendar_month: item.calendarMonth || null,
      calendar_year: item.calendarYear || null,
      image_urls: item.imageUrls || [],
      created_at: item.createdAt,
    }, { onConflict: 'id' }).then(({ error }) => {
      if (error) console.error('Supabase save:', error.message);
    });
  }
  return item;
}

function updateContentStatus(id, status, extra = {}) {
  const all = readJSON(GENERATED_FILE);
  const idx = all.findIndex(i => i.id === id);
  if (idx !== -1) { all[idx] = { ...all[idx], status, ...extra }; writeJSON(GENERATED_FILE, all); }
  if (supabase) {
    const updates = { status };
    if (extra.imageUrls)    updates.image_urls   = extra.imageUrls;
    if (extra.publishedAt)  updates.published_at = extra.publishedAt;
    if (extra.scheduledAt)  updates.scheduled_at = extra.scheduledAt;
    if (extra.instagramId)  updates.instagram_id = extra.instagramId;
    supabase.from('generated_content').update(updates).eq('id', id)
      .then(({ error }) => { if (error) console.error('Supabase update:', error.message); });
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
        calendarDay: r.calendar_day, calendarMonth: r.calendar_month,
        calendarYear: r.calendar_year, createdAt: r.created_at,
        imageUrls: r.image_urls || [],
      }));
    }
  }
  return readJSON(GENERATED_FILE).filter(i => !profile || i.profile === profile);
}

// ── Accounts ──────────────────────────────────────────────────────────────
const ACCOUNTS = {
  marca:   { id: process.env.INSTAGRAM_ACCOUNT_ID_MARCA,   token: process.env.INSTAGRAM_TOKEN_MARCA,   name: 'Case Aceleradora', handle: '@caseaceleradora'   },
  pessoal: { id: process.env.INSTAGRAM_ACCOUNT_ID_PESSOAL, token: process.env.INSTAGRAM_TOKEN_PESSOAL, name: 'Ana Moutinho',     handle: '@analuisa.moutinho' },
  virttus: { id: process.env.INSTAGRAM_ACCOUNT_ID_VIRTTUS, token: process.env.INSTAGRAM_TOKEN_VIRTTUS, name: 'Virttus',          handle: '@virttus'           },
};
function getAccount(profile) { return ACCOUNTS[profile] || ACCOUNTS.marca; }

function getManualText(profile) {
  const p = path.join(MANUALS_DIR, `${profile || 'marca'}.pdf`);
  if (!fs.existsSync(p)) return '';
  return '[Manual do cliente carregado — aplicar diretrizes de tom, identidade visual e linguagem definidas no PDF]';
}

// ═══════════════════════════════════════════════════════════════════════════
// IDENTIDADES VISUAIS
// ═══════════════════════════════════════════════════════════════════════════
const BRAND_IDENTITIES = {

  // ── CASE ACELERADORA ────────────────────────────────────────────────────
  marca: {
    accent:      '#C8A020',
    accentAlt:   '#FFFFFF',
    bgDark:      '#0A0A0A',
    bgLight:     '#F5F4F0',
    bgBrand:     '#0A0A0A',
    textOnDark:  '#FFFFFF',
    textOnLight: '#0A0A0A',
    handle:      '@caseaceleradora',
    name:        'CASE',
    moods: ['HERO_DARK','EDITORIAL_LIGHT','TYPE_LIGHT','SPLIT_LIGHT','TABLE_LIGHT','TYPE_DARK','EDITORIAL_LIGHT','BRAND_PUNCH','CTA_LIGHT'],
    aestheticDNA: `Premium B2B editorial design. Think The Economist meets McKinsey Digital.
TYPOGRAPHY: Geometric sans-serif, weight 700-900, clean and authoritative.
NEVER: hype graphics, rockets, cartoonish elements, neon colors.
ALWAYS: structure, clarity, strategic intelligence, data-driven precision.
PHOTOGRAPHY: executive boardroom, architectural details, desaturated editorial tones.`,
  },

  // ── ANA MOUTINHO — IDENTIDADE COMPLETA DO MANUAL ───────────────────────
  pessoal: {
    accent:      '#8B7355',   // marrom café — calor, intimidade, maturidade
    accentAlt:   '#C4A882',   // caramelo claro — destaque suave
    accentFem:   '#C17B6F',   // rosa queimado — feminino sem infantil
    bgDark:      '#1A1612',   // quase preto com tom quente
    bgLight:     '#FAF8F5',   // off-white / creme
    bgMid:       '#EDEAE4',   // cinza quente
    bgBrand:     '#2C2420',   // grafite escuro e quente
    textOnDark:  '#F5F2EE',   // creme sobre escuro
    textOnLight: '#1A1612',   // grafite sobre claro
    handle:      '@analuisa.moutinho',
    name:        'Ana Moutinho',

    // Moods baseados no manual: lo-fi, editorial, diário visual
    moods: ['HERO_LOFI','DIARIO_EDITORIAL','TYPE_CREME','COLAGEM_REAL','FRASE_IMPACTO','TYPE_DARK_WARM','DIARIO_EDITORIAL','VIRADA','CTA_INTIMO'],

    aestheticDNA: `IDENTIDADE: "Ana mais real" — diário visual inteligente de uma mulher construindo a própria vida com intenção.

SENSAÇÃO DESEJADA:
— "ela observa o mundo de um jeito diferente"
— "ela não está tentando parecer perfeita"
— "ela traduz coisas que eu sinto, mas não sabia nomear"
— "ela é estratégica, mas humana"

PERSONALIDADE: realista, observadora, estratégica, feminina sem ser frágil, ambiciosa sem ser performática, vulnerável com filtro.

ESTÉTICA VISUAL (CRÍTICO):
— real, crua, íntima, sofisticada, levemente granulada
— luz natural, fotos espontâneas, imperfeições bonitas
— aparência de diário visual, não de agência de marketing
— tipografia forte sobre fotos reais
— paleta: off-white/creme (#FAF8F5), preto suave, marrom café (#8B7355), verde oliva, cinza quente, rosa queimado (#C17B6F)

TOM DE VOZ:
— reflexivo, direto, levemente provocativo, íntimo, inteligente, feminino
— frases curtas e marcantes, como pensamentos reais
— NUNCA: "seja sua melhor versão", "mulher de alta performance", "desbloqueie seu potencial"
— NUNCA: motivacional raso, tom de guru, coach, LinkedIn

EXEMPLO DE FRASES NO TOM CERTO:
"Às vezes a vida não muda porque você ainda está tentando caber numa versão sua que já venceu o prazo."
"Rotina não é sobre fazer mais. É sobre parar de negociar todos os dias com a pessoa que você disse que queria ser."
"Tem gente tentando parecer autoridade antes de ter construído uma visão de mundo."

PILARES: construção pessoal, leitura de comportamento, estratégia de vida, estética de vida real, marca pessoal.

NÃO PARECE: portfólio de marketing, perfil motivacional, vitrine artificial, design Canva, feed perfeito demais.`,

    copyDNA: `COPY PARA ANA MOUTINHO — REGRAS OBRIGATÓRIAS:

1. HOOK (slide 1): afirmação provocativa que nomeia algo que a pessoa sente mas não sabe nomear. 12-16 palavras. Nunca começa com "Descubra", "Saiba", "5 dicas".

2. TOM: íntimo e observador, como se fosse uma anotação de diário que também é estratégica. Reflexivo, não instrucional.

3. PROIBIDO: "mulher de alta performance", "desbloqueie", "seja sua melhor versão", "sucesso", linguagem de coach, tom corporativo, superlativos vazios.

4. ESTRUTURA dos carrosseis (6-8 slides):
   Slide 1: gancho — nomeia o padrão ou comportamento
   Slide 2: tensão — aprofunda o desconforto
   Slide 3: explicação com observação real
   Slide 4: exemplo concreto ou dado
   Slide 5: virada de chave
   Slide 6: frase memorável
   Slide 7: fechamento com reflexão
   Slide 8: CTA leve ("salva pra reler", "me diz se fez sentido", "envia pra alguém")

5. VOZ: primeira pessoa ocasional, mas sem excessos. Usa "a gente" às vezes. Não usa segunda pessoa no tom imperativo.`,
  },

  // ── VIRTTUS ─────────────────────────────────────────────────────────────
  virttus: {
    accent:      '#00D4AA',
    accentAlt:   '#7B2FFF',
    bgDark:      '#050B18',
    bgLight:     '#F0F4FF',
    bgBrand:     '#0A1628',
    textOnDark:  '#FFFFFF',
    textOnLight: '#050B18',
    handle:      '@virttus',
    name:        'Virttus',
    moods: ['HERO_DARK','TYPE_DARK','EDITORIAL_LIGHT','HERO_DARK','TABLE_LIGHT','TYPE_DARK','EDITORIAL_LIGHT','BRAND_PUNCH','CTA_LIGHT'],
    aestheticDNA: `Tech B2B precision design. Sharp, forward-looking, data-driven.
TYPOGRAPHY: Geometric tech sans-serif, precise and clean, weight 700-900.
VISUALS: Abstract data visualizations, digital interfaces, circuit patterns.
NEVER: clipart, generic stock, cartoonish elements.`,
  },
};

// ── Manual upload ─────────────────────────────────────────────────────────
app.post('/api/manual/upload', upload.single('pdf'), (req, res) => {
  const { profile } = req.body;
  if (!req.file) return res.status(400).json({ error: 'Nenhum ficheiro enviado' });
  const dest = path.join(MANUALS_DIR, `${profile || 'marca'}.pdf`);
  fs.renameSync(req.file.path, dest);
  res.json({ success: true, message: `Manual do perfil "${profile}" guardado.` });
});

// ── Banco de fotos ────────────────────────────────────────────────────────
const PHOTOS_FILE = path.join(DATA_DIR, 'photos_meta.json');
const PHOTOS_DIR  = path.join(DATA_DIR, 'photos');
try { fs.mkdirSync(PHOTOS_DIR, { recursive: true }); } catch(e) {}
if (!fs.existsSync(PHOTOS_FILE)) fs.writeFileSync(PHOTOS_FILE, '[]');

const photoUpload = multer({
  dest: 'uploads/photos/',
  fileFilter: (req, file, cb) => { if (file.mimetype.startsWith('image/')) cb(null, true); else cb(new Error('Apenas imagens')); },
  limits: { fileSize: 20 * 1024 * 1024 },
});

app.post('/api/photos/upload', photoUpload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhum ficheiro' });
    const { profile = 'pessoal', tags = '', description = '' } = req.body;
    const ext  = path.extname(req.file.originalname) || '.jpg';
    const id   = `photo_${Date.now()}`;
    const dest = path.join(PHOTOS_DIR, `${id}${ext}`);
    fs.renameSync(req.file.path, dest);
    const b64     = fs.readFileSync(dest).toString('base64');
    const dataUrl = `data:${req.file.mimetype || 'image/jpeg'};base64,${b64}`;
    const meta = { id, profile, filename: `${id}${ext}`, originalName: req.file.originalname, tags: tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [], description, uploadedAt: new Date().toISOString(), dataUrl };
    const all = readJSON(PHOTOS_FILE); all.unshift(meta); writeJSON(PHOTOS_FILE, all);
    res.json({ success: true, photo: meta });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/photos', (req, res) => {
  const { profile, tag } = req.query;
  let all = readJSON(PHOTOS_FILE);
  if (profile) all = all.filter(p => p.profile === profile);
  if (tag)     all = all.filter(p => p.tags.includes(tag));
  res.json(all.map(({ dataUrl, ...rest }) => rest));
});

app.post('/api/photos/suggest', async (req, res) => {
  try {
    const { topic, profile = 'pessoal', limit = 3 } = req.body;
    const all = readJSON(PHOTOS_FILE).filter(p => p.profile === profile);
    if (!all.length) return res.json({ suggestions: [] });
    const photoList = all.map(p => `ID: ${p.id} | Tags: ${p.tags.join(', ')} | Descrição: ${p.description}`).join('\n');
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 512, messages: [{ role: 'user', content: `Tema: "${topic}"\nFotos:\n${photoList}\nSeleciona até ${limit} IDs. JSON: {"suggestions":["id1"]}` }] }),
    });
    const d = await r.json();
    const match  = d.content[0].text.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) : { suggestions: [] };
    const allFull = readJSON(PHOTOS_FILE);
    res.json({ suggestions: parsed.suggestions.map(id => allFull.find(p => p.id === id)).filter(Boolean) });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/photos/:id', (req, res) => {
  const photo = readJSON(PHOTOS_FILE).find(p => p.id === req.params.id);
  if (!photo) return res.status(404).json({ error: 'Não encontrada' });
  res.json(photo);
});

app.delete('/api/photos/:id', (req, res) => {
  const all   = readJSON(PHOTOS_FILE);
  const photo = all.find(p => p.id === req.params.id);
  if (!photo) return res.status(404).json({ error: 'Não encontrada' });
  const fp = path.join(PHOTOS_DIR, photo.filename);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
  writeJSON(PHOTOS_FILE, all.filter(p => p.id !== req.params.id));
  res.json({ success: true });
});

// ── Claude API ────────────────────────────────────────────────────────────
app.post('/api/claude', async (req, res) => {
  try {
    const { prompt, profile, systemExtra } = req.body;
    const brand      = BRAND_IDENTITIES[profile] || BRAND_IDENTITIES.marca;
    const manualNote = getManualText(profile);
    const systemMsg  = `Você é especialista em marketing digital e criação de conteúdo para Instagram.
Responda sempre em português do Brasil.
${brand.aestheticDNA ? `\n## Identidade da marca\n${brand.aestheticDNA}` : ''}
${brand.copyDNA ? `\n## Diretrizes de copy\n${brand.copyDNA}` : ''}
${manualNote ? `\n## Manual do cliente\n${manualNote}` : ''}
${systemExtra || ''}`;
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 4096, system: systemMsg, messages: [{ role: 'user', content: prompt }] }),
    });
    const data = await response.json();
    if (data.error) return res.status(500).json({ error: data.error.message });
    res.json({ content: data.content[0].text });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// GERAÇÃO DE IMAGENS
// ═══════════════════════════════════════════════════════════════════════════

app.post('/api/image/save-b64', (req, res) => {
  try {
    const { b64, contentId, slideIndex } = req.body;
    if (!b64) return res.status(400).json({ error: 'No b64 data' });
    const filename = `${contentId || 'img'}_slide${slideIndex || 0}_${Date.now()}.png`;
    const filepath = path.join(IMAGES_DIR, filename);
    fs.writeFileSync(filepath, Buffer.from(b64, 'base64'));
    const publicUrl = `${process.env.PUBLIC_URL || ''}/api/image/file/${filename}`;
    res.json({ success: true, url: publicUrl, filename });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/image/file/:filename', (req, res) => {
  const fp = path.join(IMAGES_DIR, req.params.filename);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
  res.sendFile(fp);
});

app.post('/api/image', async (req, res) => {
  try {
    const { prompt, size = '1024x1024' } = req.body;
    const r = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-image-1', prompt, n: 1, size, quality: 'high' }),
    });
    const data = await r.json();
    if (data.error) return res.status(500).json({ error: data.error.message });
    res.json({ url: data.data[0].url || null, b64: data.data[0].b64_json || null });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/gemini-image', async (req, res) => {
  try {
    const { prompt } = req.body;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${process.env.GEMINI_API_KEY}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instances: [{ prompt }], parameters: { sampleCount: 1 } }),
    });
    const data = await r.json();
    if (data.error) return res.status(500).json({ error: data.error.message });
    res.json({ b64: data.predictions[0].bytesBase64Encoded });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── Slide de carrossel — PROMPTS LIMPOS com identidade ANA MOUTINHO ──────
app.post('/api/image/carousel-slide', async (req, res) => {
  try {
    const { heading = '', body = '', slideNumber = 1, totalSlides = 9, funcao = '', topic = '', profile = 'marca', imagePromptHint = '', contentId = null } = req.body;

    const brand = BRAND_IDENTITIES[profile] || BRAND_IDENTITIES.marca;
    const isAna = profile === 'pessoal';

    // Para Ana: moods lo-fi; para outros: moods editorial
    const mood = brand.moods[Math.min(slideNumber - 1, brand.moods.length - 1)];
    const manualCtx = getManualText(profile);

    const h = heading.replace(/"/g, "'").replace(/—/g, '-').trim();
    const b = body.replace(/"/g, "'").replace(/—/g, '-').trim().slice(0, 140);

    const hWords       = h.split(/\s+/).filter(w => w.length > 2);
    const accentPhrase = hWords.slice(-Math.min(2, Math.ceil(hWords.length / 3))).join(' ') || hWords[hWords.length - 1] || '';

    // Cena visual
    let scene = imagePromptHint || '';
    const needsScene = ['HERO_DARK', 'HERO_LOFI', 'COLAGEM_REAL', 'SPLIT_LIGHT'].includes(mood);

    if (needsScene && !scene) {
      try {
        const scenePrompt = isAna
          ? `Art director for Ana Moutinho personal brand. Lo-fi, real, intimate aesthetic like a personal diary.
Topic: "${topic}" | Slide ${slideNumber}: "${h}"
Describe in max 12 words the PERFECT real-life background: selfie, mirror photo, desk with coffee, open book, notebook, city walk, gym, window light, everyday objects. Ultra-specific. No text. English only.`
          : `Art director for ${brand.name}. ${brand.aestheticDNA.split('\n')[0]}
Topic: "${topic}" | Slide ${slideNumber}: "${h}"
Describe in max 12 words the PERFECT background visual. No text. English only.`;

        const sr = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 80, messages: [{ role: 'user', content: scenePrompt }] }),
        });
        const sd = await sr.json();
        if (sd.content?.[0]?.text) scene = sd.content[0].text.trim().replace(/^["']|["']$/g, '');
      } catch(e) { scene = isAna ? `woman at desk with coffee, natural light, cozy home office` : `${topic}, editorial photography`; }
    }

    const slideRef = `Slide ${slideNumber} of ${totalSlides}`;
    let prompt = '';

    // ── MOODS PARA ANA MOUTINHO (lo-fi, real, diário visual) ─────────────
    if (mood === 'HERO_LOFI') {
      prompt = `You are creating ONE intimate Instagram carousel slide for Ana Moutinho personal brand. ${slideRef}.

AESTHETIC: Lo-fi, real, raw personal diary. Think: spontaneous photo with strong typography overlay. Human, imperfect, intentional.
${manualCtx}

OUTPUT: 1024×1536px portrait.

BACKGROUND: Real-life photograph. Subject: ${scene || `woman in everyday life moment, natural light, candid`}.
Slightly grainy, warm tone. Natural imperfections are GOOD. NOT a studio shot.
Dark gradient overlay on bottom 40% only.

TEXT (bottom 38%, left-aligned, 7% padding):
"${h}" — bold condensed sans-serif ~82px, color ${brand.textOnDark}.
Last 2-3 words in ${brand.accent} OR in italic serif for contrast.
${b ? `"${b}" — 20px regular, ${brand.textOnDark} 65% opacity, margin-top 12px.` : ''}

TOP-LEFT: "${brand.handle}" — ${brand.accent}, 10px, 55% opacity.
${funcao ? `"${funcao}" — ${brand.accent}, 8px uppercase.` : ''}
BOTTOM: thin 2px line ${brand.accent}, full width.

NOTHING ELSE. One real photo. One strong headline. Grain and warmth are welcome.`;

    } else if (mood === 'DIARIO_EDITORIAL') {
      prompt = `You are creating ONE intimate Instagram carousel slide for Ana Moutinho personal brand. ${slideRef}.

AESTHETIC: Editorial diary — clean off-white with strong typography. Like a printed magazine page but personal.
${manualCtx}

OUTPUT: 1024×1536px portrait. Light background, typography-forward.

BACKGROUND: ${brand.bgLight} (off-white / warm cream). Flat. Optional: very subtle paper texture at 4% opacity.

TOP-LEFT: "${brand.handle}" — ${brand.accent}, 10px, 55% opacity.
${funcao ? `"${funcao}" — ${brand.accentFem || brand.accent}, 8px uppercase, letter-spacing 2px.` : ''}

MAIN TEXT (y=16–70%, left 7%):
"${h}" — bold condensed sans ~80px, ${brand.textOnLight}, line-height 1.05.
Key phrase "${accentPhrase}" in italic serif style OR ${brand.accent} color for contrast.
${b ? `"${b}" — 20px regular, ${brand.textOnLight} 72% opacity, margin-top 18px, line-height 1.6.` : ''}

ACCENT: single thin horizontal rule (1px, ${brand.accent}, 40% opacity) between handle and heading.
BOTTOM: 2px line ${brand.accent}.

NOTHING ELSE. Warm, editorial, personal. No photographs. Typography is the design.`;

    } else if (mood === 'TYPE_CREME') {
      prompt = `You are creating ONE intimate Instagram carousel slide for Ana Moutinho personal brand. ${slideRef}.

AESTHETIC: Pure typography on warm cream. Like a handwritten note, but with design intention.
${manualCtx}

OUTPUT: 1024×1536px portrait. Cream background only.

BACKGROUND: ${brand.bgLight}. Optional: extremely subtle grain texture 3% opacity.

TOP-LEFT: "${brand.handle}" — ${brand.accent}, 10px, 50% opacity.

MAIN TEXT (y=18–78%, left 7%):
"${h}" — bold condensed sans ~90px, ${brand.textOnLight}, line-height 1.0, tight.
Words "${accentPhrase}" in italic serif — creates elegant contrast.
${b ? `"${b}" — 21px regular, ${brand.textOnLight} 70% opacity, margin-top 24px.` : ''}

DECORATIVE: optional small asterisk or dash in ${brand.accent} between headline and body.
BOTTOM: 2px ${brand.accent} line.

NO image. NO decoration beyond listed. Cream + type + one accent mark.`;

    } else if (mood === 'COLAGEM_REAL') {
      prompt = `You are creating ONE intimate Instagram carousel slide for Ana Moutinho personal brand. ${slideRef}.

AESTHETIC: Real life collage — two or four photos of everyday life moments stitched together, with a phrase overlay.
${manualCtx}

OUTPUT: 1024×1536px portrait.

LAYOUT: Grid of 2 or 4 real-life photos:
${scene || `desk with coffee cup, open notebook, woman's hands typing, natural window light`}.
Photos slightly different tones, grainy, candid. NOT posed.
White or cream thin border between photos.
Semi-transparent overlay band in center with text.

TEXT OVERLAY (center band):
"${h}" — bold sans ~60px, white or ${brand.bgLight}.
${b ? `"${b}" — 18px, white 80% opacity.` : ''}

BOTTOM: "${brand.handle}" — small, ${brand.accent}.
BOTTOM EDGE: 2px ${brand.accent} line.

REAL. CANDID. HUMAN. No studio quality. Grain is good.`;

    } else if (mood === 'FRASE_IMPACTO') {
      prompt = `You are creating ONE intimate Instagram carousel slide for Ana Moutinho personal brand. ${slideRef}.

AESTHETIC: Single powerful phrase. Dark warm background. Maximum emotional impact.
${manualCtx}

OUTPUT: 1024×1536px portrait.

BACKGROUND: ${brand.bgDark}. Warm almost-black. Optional: very faint film grain 3%.

TOP: "${funcao || 'nota'}" — ${brand.accent}, 8px uppercase, letter-spacing 3px. y=4%, left 7%.

MAIN TEXT (y=20–72%, left 7%):
"${h}" — bold condensed sans ~94px, ${brand.textOnDark}, line-height 0.95, ultra-tight.
Words "${accentPhrase}" in ${brand.accentFem || brand.accent}.
${b ? `"${b}" — 22px regular, ${brand.textOnDark} 72% opacity, margin-top 24px.` : ''}

BOTTOM: 2px ${brand.accent} line.

ONE STATEMENT. Emotional weight. No photograph. Darkness + type only.`;

    } else if (mood === 'TYPE_DARK_WARM') {
      prompt = `You are creating ONE intimate Instagram carousel slide for Ana Moutinho personal brand. ${slideRef}.

AESTHETIC: Dark warm typography slide.
${manualCtx}

OUTPUT: 1024×1536px portrait.

BACKGROUND: ${brand.bgDark}. Warm dark tone. Optional: 2% grain texture.

TOP-LEFT: "${brand.handle}" — ${brand.accent}, 10px, 55% opacity.
${funcao ? `"${funcao}" — ${brand.accent}, 8px uppercase.` : ''}

MAIN TEXT (y=20–76%, left 7%):
"${h}" — bold condensed sans ~88px, ${brand.textOnDark}, line-height 1.0.
"${accentPhrase}" in ${brand.accentFem || brand.accent}.
${b ? `"${b}" — 22px regular, ${brand.textOnDark} 68% opacity, margin-top 26px.` : ''}

ACCENT: single 36px wide × 2px tall bar in ${brand.accent}, left-aligned, below heading.
BOTTOM: 2px ${brand.accent} line.

WARM DARKNESS. Type only. No photo.`;

    } else if (mood === 'VIRADA') {
      prompt = `You are creating ONE intimate Instagram carousel slide for Ana Moutinho personal brand. ${slideRef}. PIVOT / CLIMAX SLIDE.

AESTHETIC: Emotional turning point. Dark warm with bold statement.
${manualCtx}

OUTPUT: 1024×1536px portrait.

BACKGROUND: ${brand.bgBrand}. Optional: one soft circle shape in ${brand.accent} at 5% opacity, partially cropped.

TOP: "${funcao || 'a virada'}" — ${brand.accent}, 8px uppercase, letter-spacing 3px. y=4%, left 7%.

MAIN TEXT (y=16–72%, left 7%):
"${h}" — bold condensed sans ~96px, ${brand.textOnDark}, line-height 0.95, ultra-tight.
"${accentPhrase}" in ${brand.accentFem || brand.accent}.
${b ? `"${b}" — 23px regular, ${brand.textOnDark} 76% opacity, margin-top 24px.` : ''}

BOTTOM: 2px ${brand.accent} line.

MAXIMUM EMOTIONAL IMPACT. No photograph. One statement.`;

    } else if (mood === 'CTA_INTIMO') {
      prompt = `You are creating ONE intimate Instagram carousel slide for Ana Moutinho personal brand. ${slideRef}. FINAL SLIDE — intimate CTA.

AESTHETIC: Warm, close, personal. Like a note left for a friend.
${manualCtx}

OUTPUT: 1024×1536px portrait.

BACKGROUND: ${brand.bgLight} (warm cream).

TOP-LEFT: "${brand.handle}" — ${brand.accent}, 10px, 55% opacity.

HEADLINE (y=20–44%, left 7%):
"${h}" — bold condensed sans ~72px, ${brand.textOnLight}.
"${accentPhrase}" in italic serif or ${brand.accent}.

CTA BOX (y=52–68%, centered, 88% width):
Rounded rectangle, background ${brand.bgMid || '#EDEAE4'}, border-radius 12px.
Subtle 1px border ${brand.accent} 20% opacity.
Inside — centered text:
  "${b || 'salva pra reler quando esquecer disso.'}" — 18px, ${brand.textOnLight} 75% opacity, italic.

BOTTOM: "${brand.handle}" — 12px ${brand.accent} bold. Then 2px ${brand.accent} line.

WARM. INTIMATE. Two elements only. Breathe.`;

    // ── MOODS PADRÃO (Case/Virttus) ──────────────────────────────────────
    } else if (mood === 'HERO_DARK') {
      prompt = `You are creating ONE premium Instagram slide. ${slideRef}.
${brand.aestheticDNA}
${manualCtx}
OUTPUT: 1024×1536px portrait. Dark cinematic editorial.
BACKGROUND: Full-bleed photograph. Subject: ${scene || `scene related to "${topic}"`}. Moody lighting.
Gradient overlay: transparent at top → solid ${brand.bgDark} covering bottom 45%.
TEXT (bottom 40%, left 7%): "${h}" — Inter Black ~90px, white, line-height 1.0. Last 2 words in ${brand.accent}.
${b ? `"${b}" — 22px regular, white 60% opacity, margin-top 14px.` : ''}
TOP-LEFT: "${brand.handle}" — ${brand.accent}, 11px, 60% opacity.
${funcao ? `"${funcao}" — ${brand.accent}, 9px uppercase.` : ''}
BOTTOM: 3px ${brand.accent} line.
NOTHING ELSE. One image. One headline.`;

    } else if (mood === 'EDITORIAL_LIGHT') {
      prompt = `You are creating ONE premium Instagram slide. ${slideRef}.
${brand.aestheticDNA}
${manualCtx}
OUTPUT: 1024×1536px portrait. Clean white editorial. NO photograph.
BACKGROUND: ${brand.bgLight}. Flat.
TOP-LEFT: "${brand.handle}" — ${brand.accent}, 11px, 60% opacity.
${funcao ? `"${funcao}" — ${brand.accent}, 9px uppercase.` : ''}
HEADING (y=18–58%, left 7%): "${h}" — Inter Black ~82px, ${brand.textOnLight}, line-height 1.05.
Words "${accentPhrase}" in ${brand.accent}.
${b ? `BODY: "${b}" — 21px regular, ${brand.textOnLight} 75%, margin-top 20px.` : ''}
BOTTOM: 3px ${brand.accent} line.
NOTHING ELSE. Typography only.`;

    } else if (mood === 'TYPE_LIGHT') {
      prompt = `You are creating ONE premium Instagram slide. ${slideRef}.
${brand.aestheticDNA}
${manualCtx}
OUTPUT: 1024×1536px portrait. Pure typography on light.
BACKGROUND: ${brand.bgLight}. No image.
TOP-LEFT: "${brand.handle}" — ${brand.accent}, 11px, 60% opacity.
MAIN TEXT (y=20–80%, left 7%): "${h}" — Inter Black ~88px, ${brand.textOnLight}, line-height 1.0.
"${accentPhrase}" in ${brand.accent}.
${b ? `"${b}" — 22px regular, ${brand.textOnLight} 72%, margin-top 26px.` : ''}
BOTTOM: 3px ${brand.accent} line. NO image.`;

    } else if (mood === 'TYPE_DARK') {
      prompt = `You are creating ONE premium Instagram slide. ${slideRef}.
${brand.aestheticDNA}
${manualCtx}
OUTPUT: 1024×1536px portrait. Dark typography.
BACKGROUND: ${brand.bgDark}. Flat.
TOP-LEFT: "${brand.handle}" — ${brand.accent}, 11px, 60% opacity.
MAIN TEXT (y=22–78%, left 7%): "${h}" — Inter Black ~92px, white, line-height 1.0.
"${accentPhrase}" in ${brand.accent}.
${b ? `"${b}" — 22px regular, white 68%, margin-top 28px.` : ''}
ACCENT: single 40px × 3px bar ${brand.accent}, left-aligned, below heading.
BOTTOM: 3px ${brand.accent} line. NO photo.`;

    } else if (mood === 'BRAND_PUNCH') {
      const punchBg = profile === 'marca' ? brand.bgDark : brand.bgBrand;
      prompt = `You are creating ONE premium Instagram slide. ${slideRef}. PIVOT SLIDE.
${brand.aestheticDNA}
${manualCtx}
OUTPUT: 1024×1536px portrait.
BACKGROUND: ${punchBg}. Optional: one geometric shape ${brand.accent} 5% opacity.
TOP: "${funcao || 'A VIRADA'}" — ${brand.accent}, 9px uppercase. y=4%, left 7%.
MAIN TEXT (y=18–74%, left 7%): "${h}" — Inter Black ~96px, white, line-height 0.95.
"${accentPhrase}" in ${brand.accent}.
${b ? `"${b}" — 24px regular, white 78%, margin-top 26px.` : ''}
BOTTOM: 3px ${brand.accent} line. No photos.`;

    } else if (mood === 'TABLE_LIGHT') {
      prompt = `You are creating ONE premium Instagram slide. ${slideRef}.
${brand.aestheticDNA}
${manualCtx}
OUTPUT: 1024×1536px portrait. Clean comparison table.
BACKGROUND: ${brand.bgLight}.
TOP-LEFT: "${brand.handle}" — ${brand.accent}, 11px, 60% opacity.
HEADING (y=8%, left 7%): "${h}" — Inter Black ~60px, ${brand.textOnLight}. "${accentPhrase}" in ${brand.accent}.
TABLE (y=28–78%, 6% margins. TWO columns, THREE rows max):
Left header: ${brand.bgDark} bg, white text "SEM SISTEMA", 14px bold.
Right header: ${brand.accent} bg, dark text "COM ${brand.name.toUpperCase()}", 14px bold.
Rows: white bg, 1px dividers ${brand.accent} 12% opacity. Content: contrasts for "${topic}".
BOTTOM: 3px ${brand.accent} line. No illustrations.`;

    } else if (mood === 'CTA_LIGHT') {
      const ctaWord = accentPhrase.toUpperCase() || brand.name.toUpperCase();
      prompt = `You are creating ONE premium Instagram slide. ${slideRef}. FINAL CTA.
${brand.aestheticDNA}
${manualCtx}
OUTPUT: 1024×1536px portrait. Clean white CTA.
BACKGROUND: ${brand.bgLight}.
TOP-LEFT: "${brand.handle}" — ${brand.accent}, 11px, 60% opacity.
HEADLINE (y=22–46%, left 7%): "${h}" — Inter Black ~72px, ${brand.textOnLight}. "${accentPhrase}" in ${brand.accent}.
CTA BOX (y=54–70%, centered, 88% width): rounded rect, bg #EDECE8, border-radius 12px, border 1px ${brand.accent} 20%.
Inside centered: "Comenta a palavra:" 15px gray | "${ctaWord}" 50px ${brand.accent} bold | "e recebe no DM" 14px gray.
BOTTOM: "${brand.handle}" 13px ${brand.accent}. Then 3px ${brand.accent} line. Two elements only.`;

    } else {
      // SPLIT_LIGHT fallback
      prompt = `You are creating ONE premium Instagram slide. ${slideRef}.
${brand.aestheticDNA}
${manualCtx}
OUTPUT: 1024×1536px portrait. Clean editorial.
BACKGROUND: ${brand.bgLight}.
TOP-LEFT: "${brand.handle}" — ${brand.accent}, 11px, 60% opacity.
TEXT (y=15–80%, left 7%): "${h}" — Inter Black ~74px, ${brand.textOnLight}. "${accentPhrase}" in ${brand.accent}.
${b ? `"${b}" — 21px regular, ${brand.textOnLight} 76%, margin-top 22px.` : ''}
BOTTOM: 3px ${brand.accent} line. Clean, deliberate.`;
    }

    // ── Chamar GPT Image-1 ─────────────────────────────────────────────
    const imgRes = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-image-1', prompt, n: 1, size: '1024x1536', quality: 'high' }),
    });
    const imgData = await imgRes.json();
    if (imgData.error) return res.status(500).json({ error: imgData.error.message });

    const b64out = imgData.data[0].b64_json || null;
    let   urlOut = imgData.data[0].url      || null;

    if (b64out && contentId) {
      try {
        const filename = `${contentId}_slide${slideNumber}_${Date.now()}.png`;
        const filepath = path.join(IMAGES_DIR, filename);
        fs.writeFileSync(filepath, Buffer.from(b64out, 'base64'));
        urlOut = `${process.env.PUBLIC_URL || ''}/api/image/file/${filename}`;
      } catch(e) { console.warn('Auto-save failed:', e.message); }
    }

    res.json({ url: urlOut, b64: b64out, mood, scene, promptUsed: prompt });

  } catch(err) {
    console.error('carousel-slide error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Base de conteúdos ─────────────────────────────────────────────────────
app.get('/api/content', async (req, res) => {
  const { profile, type, status } = req.query;
  try {
    let items = await loadGeneratedContent(profile);
    if (type)   items = items.filter(i => i.type   === type);
    if (status) items = items.filter(i => i.status === status);
    res.json(items);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/content/save', (req, res) => {
  const item = { id: `cnt_${Date.now()}`, createdAt: new Date().toISOString(), status: 'pendente', ...req.body };
  saveGeneratedContent(item);
  res.json({ success: true, item });
});

app.patch('/api/content/:id', (req, res) => {
  const all = readJSON(GENERATED_FILE);
  const idx = all.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Não encontrado' });
  all[idx] = { ...all[idx], ...req.body };
  writeJSON(GENERATED_FILE, all);
  if (supabase) {
    const updates = {};
    if (req.body.imageUrls) updates.image_urls = req.body.imageUrls;
    if (req.body.status)    updates.status      = req.body.status;
    if (Object.keys(updates).length) {
      supabase.from('generated_content').update(updates).eq('id', req.params.id)
        .then(({ error }) => { if (error) console.error('Supabase patch:', error.message); });
    }
  }
  res.json({ success: true, item: all[idx] });
});

// ── Instagram ─────────────────────────────────────────────────────────────
async function publishSingle(account, imageUrl, caption) {
  const { id: accountId, token } = account;
  const cr = await fetch(`https://graph.facebook.com/v19.0/${accountId}/media?image_url=${encodeURIComponent(imageUrl)}&caption=${encodeURIComponent(caption)}&access_token=${token}`, { method: 'POST' });
  const { id: containerId, error } = await cr.json();
  if (error) throw new Error(error.message);
  await new Promise(r => setTimeout(r, 5000));
  const pr = await fetch(`https://graph.facebook.com/v19.0/${accountId}/media_publish?creation_id=${containerId}&access_token=${token}`, { method: 'POST' });
  return pr.json();
}

async function publishCarousel(account, imageUrls, caption) {
  const { id: accountId, token } = account;
  const childIds = [];
  for (const url of imageUrls) {
    const r = await fetch(`https://graph.facebook.com/v19.0/${accountId}/media?image_url=${encodeURIComponent(url)}&is_carousel_item=true&access_token=${token}`, { method: 'POST' });
    const { id, error } = await r.json();
    if (error) throw new Error(error.message);
    childIds.push(id);
  }
  const cr = await fetch(`https://graph.facebook.com/v19.0/${accountId}/media?media_type=CAROUSEL&children=${childIds.join(',')}&caption=${encodeURIComponent(caption)}&access_token=${token}`, { method: 'POST' });
  const { id: carouselId, error: cerr } = await cr.json();
  if (cerr) throw new Error(cerr.message);
  await new Promise(r => setTimeout(r, 8000));
  const pr = await fetch(`https://graph.facebook.com/v19.0/${accountId}/media_publish?creation_id=${carouselId}&access_token=${token}`, { method: 'POST' });
  return pr.json();
}

app.post('/api/instagram/post', async (req, res) => {
  try {
    const { imageUrl, caption, profile, contentId } = req.body;
    const result = await publishSingle(getAccount(profile), imageUrl, caption);
    if (result.error) return res.status(500).json({ error: result.error.message });
    if (contentId) updateContentStatus(contentId, 'publicado', { publishedAt: new Date().toISOString(), instagramId: result.id });
    res.json({ success: true, id: result.id });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/instagram/carousel', async (req, res) => {
  try {
    const { imageUrls, caption, profile, contentId } = req.body;
    const result = await publishCarousel(getAccount(profile), imageUrls, caption);
    if (result.error) return res.status(500).json({ error: result.error.message });
    if (contentId) updateContentStatus(contentId, 'publicado', { publishedAt: new Date().toISOString(), instagramId: result.id });
    res.json({ success: true, id: result.id });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/instagram/schedule', (req, res) => {
  try {
    const { scheduledAt, contentId, ...rest } = req.body;
    const posts   = readJSON(SCHEDULED_FILE);
    const newPost = { id: `sch_${Date.now()}`, contentId, scheduledAt, status: 'pending', ...rest };
    posts.push(newPost);
    writeJSON(SCHEDULED_FILE, posts);
    if (contentId) updateContentStatus(contentId, 'agendado', { scheduledAt, scheduleId: newPost.id });
    res.json({ success: true, scheduledPost: newPost });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/instagram/scheduled', (req, res) => { res.json(readJSON(SCHEDULED_FILE)); });
app.delete('/api/instagram/scheduled/:id', (req, res) => {
  writeJSON(SCHEDULED_FILE, readJSON(SCHEDULED_FILE).filter(p => p.id !== req.params.id));
  res.json({ success: true });
});

setInterval(async () => {
  const posts = readJSON(SCHEDULED_FILE);
  const now   = new Date();
  let changed = false;
  for (const post of posts) {
    if (post.status !== 'pending') continue;
    if (new Date(post.scheduledAt) > now) continue;
    try {
      const account = getAccount(post.profile);
      let result;
      if (post.type === 'carousel' || post.type === 'carrossel') {
        result = await publishCarousel(account, post.imageUrls, post.caption);
      } else {
        result = await publishSingle(account, post.imageUrl || post.imageUrls?.[0], post.caption);
      }
      post.status      = result.error ? 'error' : 'published';
      post.publishedAt = new Date().toISOString();
      post.instagramId = result.id;
      if (post.contentId) updateContentStatus(post.contentId, 'publicado', { publishedAt: post.publishedAt, instagramId: result.id });
      changed = true;
    } catch(err) { post.status = 'error'; post.error = err.message; changed = true; }
  }
  if (changed) writeJSON(SCHEDULED_FILE, posts);
}, 60_000);

// ── Calendário — FIX: persistência correta no Supabase ───────────────────
app.post('/api/calendar/generate', async (req, res) => {
  try {
    const { month, year, profile, postsPerDay = 2 } = req.body;
    const manualNote  = getManualText(profile);
    const brand       = BRAND_IDENTITIES[profile] || BRAND_IDENTITIES.marca;
    const account     = getAccount(profile);
    const daysInMonth = new Date(year, month, 0).getDate();
    const BLOCK       = 10;
    const allDays     = [];

    for (let blockStart = 1; blockStart <= daysInMonth; blockStart += BLOCK) {
      const blockEnd = Math.min(blockStart + BLOCK - 1, daysInMonth);

      // Prompt adaptado por perfil
      const brandContext = profile === 'pessoal'
        ? `PERFIL: Ana Moutinho (@analuisa.moutinho) — marca pessoal "Ana mais real".
IDENTIDADE: diário visual inteligente. Mulher construindo a vida com intenção. Real, estratégica, humana.
PILARES: construção pessoal, leitura de comportamento, estratégia de vida, estética de vida real, marca pessoal.
TOM: reflexivo, direto, íntimo, levemente provocativo. NUNCA motivacional genérico, coach, LinkedIn.
${brand.copyDNA || ''}`
        : `PERFIL: ${account.name} (${account.handle})
${brand.aestheticDNA?.split('\n')[0] || ''}`;

      const blockPrompt = `Você é o estrategista de conteúdo criando o calendário editorial para ${account.name} — ${month}/${year}.

${brandContext}
${manualNote ? `DIRETRIZES ADICIONAIS:\n${manualNote}` : ''}

TIPOS DE POST:
- "tendencia": Análise de tendência/fenômeno cultural/comportamento
- "case": Case de sucesso ou fracasso — com ângulo específico
- "educativo": Framework, método, conceito com nome
- "comparacao": Antes/depois, certo/errado — alto alcance
- "lista": Lista de insights — fácil de consumir
- "prova_social": Resultado real — bom para conversão
- "oferta": Produto/serviço envolto em valor — máximo 1x/semana

REGRA DO TOPIC — deve ser:
✅ ESPECÍFICO — nomear fenômeno, padrão de comportamento ou dado concreto
✅ COM ÂNGULO — não o tema, mas a observação sobre ele
❌ PROIBIDO: "dicas de marketing", "como crescer", frases genéricas sem tensão

HORÁRIOS: 09:00, 12:00, 18:00

Responde APENAS com JSON válido:
{
  "days": [
    { "day": ${blockStart}, "posts": [{ "time": "09:00", "type": "tendencia", "topic": "tema específico com ângulo" }] }
  ]
}
Inclui TODOS os dias de ${blockStart} a ${blockEnd}.`;

      const blockRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 3000, messages: [{ role: 'user', content: blockPrompt }] }),
      });
      const blockData = await blockRes.json();
      if (blockData.error) throw new Error(blockData.error.message);
      let blockText = blockData.content[0].text.trim();
      const bm = blockText.match(/\{[\s\S]*\}/);
      if (bm) blockText = bm[0];
      allDays.push(...(JSON.parse(blockText).days || []));
    }

    const generated = readJSON(GENERATED_FILE).filter(g => g.profile === profile);
    const calendarDays = allDays.map(dayEntry => ({
      ...dayEntry,
      posts: (dayEntry.posts || []).map(post => {
        const match = generated.find(g => g.calendarDay === dayEntry.day && g.calendarMonth === month && g.calendarYear === year);
        return {
          ...post,
          date:        `${year}-${String(month).padStart(2,'0')}-${String(dayEntry.day).padStart(2,'0')}`,
          contentId:   match?.id     || null,
          status:      match?.status || 'pendente',
          scheduledAt: match?.scheduledAt || null,
        };
      }),
    }));

    // Salvar localmente
    writeJSON(CALENDAR_FILE, { profile, month, year, calendar: calendarDays, savedAt: new Date().toISOString() });

    // Salvar no Supabase (coluna correta: 'data' como JSONB ou text)
    if (supabase) {
      await supabase.from('calendars').upsert({
        id:         `${profile}_${year}_${month}`,
        profile,
        month:      parseInt(month),
        year:       parseInt(year),
        data:       JSON.stringify(calendarDays),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });
    }

    res.json({ calendar: calendarDays });
  } catch(err) {
    console.error('Calendar error:', err);
    res.status(500).json({ error: err.message });
  }
});

// FIX: rota saved com query correta e fallback robusto
app.get('/api/calendar/saved', async (req, res) => {
  try {
    const { profile, month, year } = req.query;

    // 1. Tentar Supabase
    if (supabase) {
      const { data, error } = await supabase
        .from('calendars')
        .select('data, updated_at')
        .eq('id', `${profile}_${year}_${month}`)
        .single();

      if (!error && data?.data) {
        const calendar = typeof data.data === 'string' ? JSON.parse(data.data) : data.data;
        return res.json({ found: true, calendar, savedAt: data.updated_at });
      }
    }

    // 2. Fallback: arquivo local
    const saved = readJSON(CALENDAR_FILE);
    if (
      saved?.profile === profile &&
      String(saved.month) === String(month) &&
      String(saved.year)  === String(year) &&
      saved.calendar?.length
    ) {
      return res.json({ found: true, calendar: saved.calendar, savedAt: saved.savedAt });
    }

    res.json({ found: false });
  } catch(e) {
    console.error('calendar/saved error:', e);
    res.json({ found: false });
  }
});

// ── Gerar + Salvar carrossel ──────────────────────────────────────────────
app.post('/api/carousel/generate-and-save', async (req, res) => {
  try {
    const { topic, blocks, profile, calendarDay, calendarMonth, calendarYear, caption, hashtags, contentMachineType } = req.body;
    const manualNote = getManualText(profile);
    const brand      = BRAND_IDENTITIES[profile] || BRAND_IDENTITIES.marca;
    const account    = getAccount(profile);
    const mode       = blocks ? 'blocks' : 'topic';

    const isAna = profile === 'pessoal';

    const systemPrompt = isAna
      ? `Você é o gerador de carrosseis da Ana Moutinho — marca pessoal "Ana mais real".

${brand.copyDNA || ''}
${brand.aestheticDNA || ''}

REGRAS ABSOLUTAS:
- Retornar APENAS JSON válido, sem markdown.
- Nunca inventar fatos ou dados.
- Nunca travessão (—).
- Proibido: "Descubra", "Saiba", "Aprenda", "seja sua melhor versão", "mulher de alta performance".`
      : `Você é o gerador de carrosseis da BrandsDecoded — padrão mais alto de copy para Instagram.

PRINCÍPIOS:
1. O Instagram é plataforma de DESCOBERTA. Cada carrossel funciona para quem NUNCA viu o perfil.
2. Funil interno: capa → tração → avanço → CTA.

CONTRATO DA CAPA:
Slide 1 (hook): 14-18 palavras. Afirmação provocativa + dois-pontos + pergunta. NUNCA começar com Descubra/Saiba.
Slide 2 (sub-hook): 8-12 palavras. Aprofunda o slide 1.

PROIBIDO: Travessão (—), frases genéricas com cara de IA, inventar fatos.
Retornar APENAS JSON válido, sem markdown.`;

    let prompt;

    if (mode === 'blocks') {
      prompt = `Perfil: ${account.name} (${account.handle})
${manualNote ? 'Diretrizes: ' + manualNote : ''}

Converte estes blocos em slides (1 bloco = 1 slide, preservar texto original):
${blocks}

JSON:
{
  "title": "título interno",
  "slideCount": <n>,
  "slides": [{ "slideNumber": 1, "heading": "...", "body": "...", "imagePrompt": "cena em inglês, sem texto" }],
  "caption": "legenda completa com emojis e CTA",
  "hashtags": "#tag1 #tag2"
}`;
    } else {
      const tipoInstrucoes = {
        tendencia:    isAna ? `TIPO: Análise de comportamento/tendência. Capa nomeia um padrão que a pessoa reconhece. Slides 2-3: tensão e observação. Slides 4-6: aprofundamento com exemplos reais. Slide 7: virada. Slide 8: CTA leve.`
                            : `TIPO: ANÁLISE DE TENDÊNCIA. Capa como fenômeno. Slides 3-7: implicações. Slides 8-9: o que muda.`,
        case:         `TIPO: CASE. Capa como fenômeno cultural. Contexto → ponto de virada → resultados → lição.`,
        educativo:    isAna ? `TIPO: Estratégia de vida / framework pessoal. Capa promete método com nome próprio. Slides: um passo por slide com exemplo concreto e íntimo.`
                            : `TIPO: EDUCATIVO. Capa promete método com nome. Slides: um passo por slide.`,
        comparacao:   `TIPO: COMPARAÇÃO. Capa ativa contraste. Lado A → virada → Lado B.`,
        lista:        `TIPO: LISTA. Capa com número e promessa real. Um item por slide.`,
        prova_social: `TIPO: PROVA SOCIAL. Capa foca no resultado. Antes → processo → números → lição.`,
        oferta:       `TIPO: OFERTA. Capa ativa desejo. Problema → solução → para quem → prova → o que inclui.`,
      };

      prompt = `Perfil: ${account.name} (${account.handle})
${manualNote ? 'Diretrizes: ' + manualNote + '\n' : ''}
Tema central: "${topic}"

${contentMachineType && tipoInstrucoes[contentMachineType] ? tipoInstrucoes[contentMachineType] : tipoInstrucoes.tendencia}

Total: ${isAna ? '7-8' : '10'} slides.

JSON:
{
  "title": "título interno",
  "slideCount": ${isAna ? 8 : 10},
  "slides": [
    { "slideNumber": 1, "heading": "hook", "body": "", "imagePrompt": "cena em inglês, sem texto" }
  ],
  "caption": "legenda completa com emojis e CTA",
  "hashtags": "#hashtag1 #hashtag2"
}`;
    }

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 8192, system: systemPrompt, messages: [{ role: 'user', content: prompt }] }),
    });
    const d = await r.json();
    if (d.error) return res.status(500).json({ error: d.error.message });

    let text = d.content[0].text.trim();
    const mj = text.match(/\{[\s\S]*\}/);
    if (mj) text = mj[0];
    const carouselData = JSON.parse(text);

    const item = saveGeneratedContent({
      id: `cnt_${Date.now()}`,
      createdAt: new Date().toISOString(),
      status: 'pendente',
      type: 'carrossel',
      mode, profile,
      topic: topic || `Carrossel ${carouselData.slideCount} slides`,
      caption: caption || carouselData.caption,
      hashtags: hashtags || carouselData.hashtags,
      contentMachineType: contentMachineType || null,
      carouselData,
      calendarDay:   calendarDay   || null,
      calendarMonth: calendarMonth || null,
      calendarYear:  calendarYear  || null,
      imageUrls: [],
    });

    res.json({ success: true, contentId: item.id, ...carouselData });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── Content Machine ───────────────────────────────────────────────────────
app.post('/api/content-machine/generate', async (req, res) => {
  try {
    const { tipo, tema, profile } = req.body;
    if (!tipo || !tema) return res.status(400).json({ error: 'Faltam campos: tipo e tema.' });

    const manualNote = getManualText(profile);
    const brand      = BRAND_IDENTITIES[profile] || BRAND_IDENTITIES.marca;
    const account    = getAccount(profile);
    const isAna      = profile === 'pessoal';

    const tipoLabels = { tendencia:'Análise de Tendência', case:'Case de Sucesso', educativo:'Educativo / Framework', comparacao:'Comparação / Antes & Depois', lista:'Lista Valiosa', prova_social:'Prova Social', oferta:'Oferta', dump:'Dump / Bastidores' };

    const systemPrompt = isAna
      ? `Você é o gerador de carrosseis da Ana Moutinho — marca pessoal "Ana mais real".

${brand.copyDNA || ''}
${brand.aestheticDNA || ''}

ESTRUTURA DE SLIDES:
textos 1-2 = gancho e tensão (capa)
textos 3,7,11,14 = observações/viradas (11-15 palavras)
textos 4,5,8,9,12,13,15,16 = desenvolvimento íntimo (25-32 palavras)
textos 6,10 = transições reflexivas (22-26 palavras)
texto 17 = fechamento memorável (26-30 palavras)
texto 18 = CTA leve fixo

CTA FIXO (texto 18):
"salva pra reler quando esquecer disso. e me diz nos comentários se isso fez sentido pra você."

Retornar APENAS JSON válido, sem markdown.`
      : `Você é o gerador oficial de carrosseis de alta performance da BrandsDecoded.

REGRAS: Nunca inventar fatos. Proibido travessão (—). Sem "Descubra/Saiba/Conheça". Sem 2ª pessoa nos slides de desenvolvimento.

CONTRATO DA CAPA:
Slide 1 (hook): 14-18 palavras. Afirmação provocativa + dois-pontos + pergunta.
Slide 2 (sub-hook): 8-12 palavras.

ASSINATURA FIXA (texto 18):
Gostou desse conteúdo? Aproveite para seguir nosso perfil. E caso queira saber sobre o nosso acompanhamento, comente "CASE" que nossa equipe te chama.

Retornar APENAS JSON válido, sem markdown.`;

    const tipoInstrucoes = {
      tendencia:    isAna ? 'Capa nomeia um padrão de comportamento. Desenvolvimento: observação → tensão → aprofundamento → virada pessoal.' : 'Capa como fenômeno. Por que acontece. Implicações. O que muda.',
      case:         'Capa como fenômeno cultural. Contexto. Ponto de virada. Resultados verificáveis. Lição.',
      educativo:    isAna ? 'Capa promete estratégia de vida com nome próprio. Slides: um passo por slide, íntimo e concreto.' : 'Capa promete método com nome. Slides: um passo por slide com exemplo.',
      comparacao:   'Capa ativa contraste. Lado A. Virada. Lado B.',
      lista:        'Capa com número e promessa. Um item por slide.',
      prova_social: 'Capa foca resultado. Antes. Processo. Números. Lição.',
      oferta:       'Capa ativa desejo. Problema. Solução. Para quem. Prova. O que inclui.',
      dump:         isAna ? 'Capa humaniza e cria identificação. Momentos reais com narrativa. Reflexão. Conexão com processo pessoal.' : 'Capa humaniza. Momentos com narrativa. Reflexão. Conexão com missão.',
    };

    const userPrompt = `Tipo: ${tipoLabels[tipo] || tipo}
Perfil: ${account.name} (${account.handle})
${manualNote ? `Diretrizes: ${manualNote}` : ''}
Tema: "${tema}"

${tipoInstrucoes[tipo] || tipoInstrucoes.tendencia}

JSON:
{
  "tipo": "${tipo}",
  "tipo_label": "${tipoLabels[tipo] || tipo}",
  "tema": "${tema}",
  "profile": "${profile}",
  "slides": [
    { "slide": 1, "funcao": "CAPA", "textos": [
        { "posicao": 1, "tipo": "hook",     "texto": "..." },
        { "posicao": 2, "tipo": "sub-hook", "texto": "..." }
    ]},
    { "slide": 2, "funcao": "TENSÃO", "textos": [
        { "posicao": 3, "tipo": "titulo",    "texto": "..." },
        { "posicao": 4, "tipo": "paragrafo", "texto": "..." }
    ]},
    { "slide": 13, "funcao": "CTA", "textos": [
        { "posicao": 18, "tipo": "cta", "texto": "${isAna ? 'salva pra reler quando esquecer disso. e me diz nos comentários se isso fez sentido pra você.' : 'Gostou desse conteúdo? Aproveite para seguir nosso perfil. E caso queira saber sobre o nosso acompanhamento, comente \\"CASE\\" que nossa equipe te chama.'}" }
    ]}
  ]
}`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o', temperature: 1.0, max_tokens: 4500, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }] }),
    });
    const data = await response.json();
    if (data.error) return res.status(500).json({ error: data.error.message });

    let text = data.choices[0].message.content.trim().replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(text);

    const slidesNorm = (parsed.slides || []).map(s => {
      const txs = s.textos || [];
      return { slideNumber: s.slide, funcao: s.funcao || '', heading: txs[0]?.texto || '', body: txs[1]?.texto || '', textos: txs };
    });

    const item = saveGeneratedContent({
      id: `cnt_${Date.now()}`,
      createdAt: new Date().toISOString(),
      status: 'pendente', type: 'carrossel',
      contentMachineType: tipo,
      contentMachineTypeLabel: tipoLabels[tipo] || tipo,
      profile, topic: tema, imageUrls: [],
      carouselData: { title: tema, slideCount: slidesNorm.length, slides: slidesNorm, caption: '', hashtags: '' },
    });

    res.json({ success: true, contentId: item.id, ...parsed, slidesNormalizados: slidesNorm });
  } catch(err) {
    console.error('Content Machine error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Health ────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => { res.json({ status: 'ok', ts: new Date().toISOString() }); });

app.use(express.static('public'));
app.use('/api', (req, res) => { res.status(404).json({ error: `Rota não encontrada: ${req.method} ${req.originalUrl}` }); });
app.get('*', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });
app.listen(PORT, () => console.log(`🚀 Máquina de Conteúdo na porta ${PORT}`));
