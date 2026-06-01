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
  marca: {
    accent:'#C8A020',accentAlt:'#FFFFFF',bgDark:'#0A0A0A',bgLight:'#F5F4F0',bgBrand:'#0A0A0A',
    textOnDark:'#FFFFFF',textOnLight:'#0A0A0A',handle:'@caseaceleradora',name:'CASE',
    moods:['HERO_DARK','EDITORIAL_LIGHT','TYPE_LIGHT','SPLIT_LIGHT','TABLE_LIGHT','TYPE_DARK','EDITORIAL_LIGHT','BRAND_PUNCH','CTA_LIGHT'],
    aestheticDNA:`Premium B2B editorial design. Think The Economist meets McKinsey Digital.
TYPOGRAPHY: Geometric sans-serif, weight 700-900, clean and authoritative.
NEVER: hype graphics, rockets, cartoonish elements, neon colors.
ALWAYS: structure, clarity, strategic intelligence, data-driven precision.
PHOTOGRAPHY: executive boardroom, architectural details, desaturated editorial tones.`,
  },
  pessoal: {
    accent:'#8B7355',accentAlt:'#C4A882',accentFem:'#C17B6F',bgDark:'#1A1612',bgLight:'#FAF8F5',
    bgMid:'#EDEAE4',bgBrand:'#2C2420',textOnDark:'#F5F2EE',textOnLight:'#1A1612',
    handle:'@analuisa.moutinho',name:'Ana Moutinho',
    moods:['HERO_LOFI','DIARIO_EDITORIAL','TYPE_CREME','COLAGEM_REAL','FRASE_IMPACTO','TYPE_DARK_WARM','DIARIO_EDITORIAL','VIRADA','CTA_INTIMO'],
    aestheticDNA:`IDENTIDADE: "Ana mais real" — diário visual inteligente de uma mulher construindo a própria vida com intenção.
SENSAÇÃO DESEJADA: ela observa o mundo de um jeito diferente, não está tentando parecer perfeita.
PERSONALIDADE: realista, observadora, estratégica, feminina sem ser frágil.
ESTÉTICA: real, crua, íntima, sofisticada, levemente granulada. Luz natural, fotos espontâneas.
PALETA: off-white/creme (#FAF8F5), preto suave, marrom café (#8B7355), rosa queimado (#C17B6F).
TOM: reflexivo, direto, levemente provocativo, íntimo, inteligente.
NUNCA: motivacional raso, tom de guru, coach, LinkedIn.`,
    copyDNA:`COPY PARA ANA MOUTINHO:
1. HOOK: afirmação provocativa que nomeia algo que a pessoa sente mas não sabe nomear.
2. TOM: íntimo e observador. PROIBIDO: "desbloqueie", "seja sua melhor versão", "sucesso".
3. ESTRUTURA 7-8 slides: gancho → tensão → observação → exemplo → virada → frase memorável → CTA leve.`,
  },
  virttus: {
    accent:'#00D4AA',accentAlt:'#7B2FFF',bgDark:'#050B18',bgLight:'#F0F4FF',bgBrand:'#0A1628',
    textOnDark:'#FFFFFF',textOnLight:'#050B18',handle:'@virttus',name:'Virttus',
    moods:['HERO_DARK','TYPE_DARK','EDITORIAL_LIGHT','HERO_DARK','TABLE_LIGHT','TYPE_DARK','EDITORIAL_LIGHT','BRAND_PUNCH','CTA_LIGHT'],
    aestheticDNA:`Tech B2B precision design. Sharp, forward-looking, data-driven.
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
// GERAÇÃO DE IMAGENS — VERSÃO COM DIRETOR DE ARTE IA
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

// ── Slide de carrossel — VERSÃO COM DIRETOR DE ARTE IA ────────────────────
// Fluxo: Claude Haiku (direção de arte ~150 palavras) → GPT Image (só foto) → retorna foto + designMeta
app.post('/api/image/carousel-slide', async (req, res) => {
  try {
    const {
      heading = '', body = '',
      slideNumber = 1, totalSlides = 9,
      funcao = '', topic = '',
      profile = 'marca',
      imagePromptHint = '',
      contentId = null
    } = req.body;

    const brand = BRAND_IDENTITIES[profile] || BRAND_IDENTITIES.marca;
    const isAna = profile === 'pessoal';
    const mood  = brand.moods[Math.min(slideNumber - 1, brand.moods.length - 1)];

    const h = heading.replace(/"/g, "'").replace(/—/g, '-').trim();
    const b = body.replace(/"/g, "'").replace(/—/g, '-').trim().slice(0, 180);

    // ── Etapa 1: Diretor de Arte IA (Claude Haiku ~150 palavras) ─────────
    const needsPhoto = ['HERO_DARK','HERO_LOFI','COLAGEM_REAL','SPLIT_LIGHT','EDITORIAL_LIGHT','DIARIO_EDITORIAL'].includes(mood);

    let artDirection = imagePromptHint || '';

    if (needsPhoto) {
      const visualDNA = isAna
        ? `VISUAL DNA — Ana Moutinho "Ana mais real":
Aesthetic: lo-fi diary, intimate, real. Not polished, not corporate.
Feel: like a photo from her iPhone, warm grain, honest moment.
References: Sofia Coppola films, Lana Del Rey visuals, candid editorial.
Avoid: studio lighting, stock photo feel, fake smiles, perfect setup.`
        : profile === 'virttus'
        ? `VISUAL DNA — Virttus tech B2B precision, forward-looking, sharp.
References: Bloomberg Businessweek, Wired magazine. Clean architecture, digital abstraction.
Avoid: generic tech stock, blue gradients, cliché office scenes.`
        : `VISUAL DNA — Case Aceleradora premium B2B editorial.
References: Monocle, FT Weekend, Harvard Business Review covers.
Aesthetic: quiet luxury, strategic intelligence, executive authority.
Avoid: startup hustle, motivational clichés, busy distracting backgrounds.`;

      const slideCtx = funcao === 'CAPA' || slideNumber === 1
        ? 'COVER SLIDE — maximum cinematic impact, strong single focal point, hero image quality.'
        : funcao === 'CTA' || slideNumber === totalSlides
        ? 'CLOSING SLIDE — warmer, intimate feel, invites connection.'
        : `Slide ${slideNumber}/${totalSlides} — clean, uncluttered supporting visual.`;

      const artPrompt = `You are a world-class art director for premium Instagram editorial content.

${visualDNA}

TOPIC: "${topic}"
SLIDE HEADING: "${h}"
${slideCtx}

Direct the BACKGROUND PHOTOGRAPH ONLY. This image will have typography overlaid by our design system.
CRITICAL: No text, no typography, no logos, no graphic elements in the image.

Describe precisely (max 150 words):
- SUBJECT: who/what, their action or emotional state
- ENVIRONMENT: specific location, architecture or nature
- LIGHTING: quality, direction, color temperature, time of day
- LENS & FRAMING: focal length feel, crop, angle, depth of field
- COLOR PALETTE: dominant tones, accent colors, warmth/coolness
- EMOTIONAL TONE: mood and psychological impact
- PHOTOGRAPHIC STYLE: specific magazine or photographer reference

Output ONLY the photographic direction. No preamble, no labels.`;

      try {
        const sr = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 280,
            messages: [{ role: 'user', content: artPrompt }]
          }),
        });
        const sd = await sr.json();
        if (sd.content?.[0]?.text) {
          artDirection = sd.content[0].text.trim();
          console.log(`[ArtDir] Slide ${slideNumber}: ${artDirection.slice(0, 80)}...`);
        }
      } catch(e) {
        console.warn('Art direction fallback:', e.message);
        artDirection = isAna
          ? 'Young woman at her desk by a large window, early morning soft diffused light, coffee cup nearby, candid moment of quiet reflection, warm golden hour tones, shallow depth of field, 35mm film aesthetic, slightly grainy texture, intimate and real, lo-fi diary feel'
          : 'Executive standing by floor-to-ceiling glass window overlooking city skyline at dusk, dramatic raking side light, desaturated editorial tones, architectural precision and clean lines, Monocle magazine aesthetic, sharp focus on subject';
      }
    }

    // ── Etapa 2: GPT Image gera APENAS a fotografia limpa ────────────────
    let photoPrompt = '';

    if (needsPhoto && artDirection) {
      photoPrompt = `${artDirection}

CRITICAL REQUIREMENTS:
- Absolutely NO text, words, letters, numbers, or typography anywhere in the image
- NO logos, watermarks, or graphic overlays of any kind
- NO UI elements, frames, borders, or design elements
- This is pure photography intended as a background layer — clean and uncluttered
- Ultra high quality, ${mood.includes('LOFI') ? 'authentic film grain, lo-fi aesthetic' : 'luxury magazine editorial quality'}
- Portrait orientation composition, 2:3 aspect ratio`;
    } else {
      // Slides tipográficos puros — gera fundo textural limpo
      const bgMap = {
        TYPE_LIGHT:     `Minimalist flat surface. Warm off-white tone like ${brand.bgLight}. Very subtle paper or linen texture, barely perceptible. Completely clean, no objects, no shadows, no text.`,
        TYPE_CREME:     `Warm cream minimalist background. Soft beige tone. Very subtle organic texture. Pure clean surface, no elements whatsoever.`,
        TYPE_DARK:      `Deep dark background. Rich near-black tone like ${brand.bgDark}. Very subtle film grain texture. Pure surface, completely clean.`,
        TYPE_DARK_WARM: `Dark warm background. Deep espresso tone. Subtle film grain. Pure photographic dark surface, no objects.`,
        BRAND_PUNCH:    `Abstract dark background. Deep near-black tone. Very subtle diagonal light reflection or bokeh. No text, no logos, purely atmospheric.`,
        VIRADA:         `Dark dramatic abstract background. Deep shadow photography. Moody atmospheric light leak at edge. Completely clean, no text, no elements.`,
        TABLE_LIGHT:    `Clean light background. Flat warm white surface. Subtle paper texture. No elements, pure minimal surface.`,
        CTA_LIGHT:      `Warm light background. Soft cream tones. Gentle organic texture. Pure clean inviting surface.`,
        CTA_INTIMO:     `Warm intimate light background. Soft beige and cream. Gentle grain. Cozy and quiet surface.`,
        FRASE_IMPACTO:  `Dramatic dark background. Deep shadows. Cinematic darkness with one subtle edge of light. No text, no elements.`,
        SPLIT_LIGHT:    `Clean minimal light background. Soft warm white. Barely visible texture. Pure surface.`,
        COLAGEM_REAL:   `Warm cream background. Soft natural light. Subtle organic texture. Clean and quiet.`,
      };
      photoPrompt = (bgMap[mood] || `Clean ${brand.bgLight} minimal background surface. Subtle texture. No text, no elements.`);
      photoPrompt += '\n\nCRITICAL: Absolutely NO text, typography, letters, numbers, or graphic elements anywhere in the image.';
    }

    console.log(`[Slide ${slideNumber}] mood=${mood} needsPhoto=${needsPhoto} promptLen=${photoPrompt.length}`);

    // ── Etapa 3: Chamar GPT Image ─────────────────────────────────────────
    const imgRes = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-image-1',
        prompt: photoPrompt,
        n: 1,
        size: '1024x1536',
        quality: 'high',
      }),
    });

    const imgData = await imgRes.json();
    if (imgData.error) return res.status(500).json({ error: imgData.error.message });

    const b64out = imgData.data[0].b64_json || null;
    let   urlOut = imgData.data[0].url      || null;

    // Salvar imagem localmente e retornar URL persistente
    if (b64out && contentId) {
      try {
        const filename = `${contentId}_slide${slideNumber}_${Date.now()}.png`;
        const filepath = path.join(IMAGES_DIR, filename);
        fs.writeFileSync(filepath, Buffer.from(b64out, 'base64'));
        urlOut = `${process.env.PUBLIC_URL || ''}/api/image/file/${filename}`;
      } catch(e) { console.warn('Auto-save failed:', e.message); }
    }

    // Retorna foto limpa + designMeta para o frontend montar o overlay HTML/CSS
    res.json({
      url: urlOut,
      b64: b64out,
      mood,
      artDirection,
      designMeta: {
        heading: h,
        body: b,
        accent: brand.accent,
        accentAlt: brand.accentAlt || '#FFFFFF',
        bgDark: brand.bgDark,
        bgLight: brand.bgLight,
        handle: brand.handle,
        isDark: ['HERO_DARK','HERO_LOFI','TYPE_DARK','TYPE_DARK_WARM','BRAND_PUNCH','VIRADA','FRASE_IMPACTO','CTA_INTIMO'].includes(mood),
        mood,
        slideNumber,
        totalSlides,
        funcao,
      }
    });

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

// ═══════════════════════════════════════════════════════════════════════════
// CALENDÁRIO
// ═══════════════════════════════════════════════════════════════════════════

function extractJSON(text) {
  let cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) return JSON.parse(match[0]);
  return JSON.parse(cleaned);
}

function normalizeDays(parsed) {
  let days = parsed.days || parsed.calendar || parsed.data || (Array.isArray(parsed) ? parsed : null);
  if (!days) {
    const keys = Object.keys(parsed);
    for (const k of keys) {
      if (Array.isArray(parsed[k]) && parsed[k].length > 0 && parsed[k][0].day !== undefined) {
        days = parsed[k]; break;
      }
    }
  }
  return days || [];
}

app.post('/api/calendar/generate', async (req, res) => {
  try {
    const { month, year, profile, postsPerDay = 1 } = req.body;
    const manualNote  = getManualText(profile);
    const brand       = BRAND_IDENTITIES[profile] || BRAND_IDENTITIES.marca;
    const account     = getAccount(profile);
    const daysInMonth = new Date(year, month, 0).getDate();

    const BLOCK = 10;
    const allDays = [];

    for (let blockStart = 1; blockStart <= daysInMonth; blockStart += BLOCK) {
      const blockEnd    = Math.min(blockStart + BLOCK - 1, daysInMonth);
      const daysInBlock = blockEnd - blockStart + 1;

      const brandContext = profile === 'pessoal'
        ? `PERFIL: Ana Moutinho (@analuisa.moutinho) — marca pessoal "Ana mais real".
PILARES: construção pessoal, estratégia de vida, estética de vida real, marca pessoal.
TOM: reflexivo, direto, íntimo. NUNCA motivacional genérico.`
        : `PERFIL: ${account.name} (${account.handle})
NICHO: ${brand.aestheticDNA?.split('\n')[0] || 'marketing e negócios'}`;

      const exampleDay   = blockStart;
      const examplePosts = postsPerDay === 1
        ? `[{"time":"09:00","type":"educativo","topic":"Por que 90% das empresas falham no onboarding de clientes"}]`
        : `[{"time":"09:00","type":"educativo","topic":"Por que 90% das empresas falham no onboarding"},{"time":"18:00","type":"tendencia","topic":"O novo comportamento do consumidor pós-IA em 2026"}]`;

      const blockPrompt = `Você é estrategista de conteúdo para Instagram. Crie o calendário editorial para ${account.name} — ${month}/${year}.

${brandContext}
${manualNote ? `DIRETRIZES ADICIONAIS: ${manualNote}` : ''}

TIPOS DISPONÍVEIS: tendencia | case | educativo | comparacao | lista | prova_social | oferta

REGRAS DO TOPIC (CRÍTICO):
✅ Específico com ângulo único: "Por que o LinkedIn brasileiro cresceu 40% com conteúdo de vulnerabilidade"
✅ Nomeia comportamento ou padrão: "O paradoxo do perfeccionismo que paralisa empreendedores"
❌ PROIBIDO genérico: "dicas de marketing", "como crescer no Instagram", "estratégias de negócio"

HORÁRIOS: use 09:00 para manhã e 18:00 para tarde/noite.

RESPONDA APENAS COM JSON VÁLIDO, SEM MARKDOWN, SEM TEXTO ANTES OU DEPOIS.

Formato EXATO (siga este modelo):
{
  "days": [
    {"day": ${exampleDay}, "posts": ${examplePosts}},
    {"day": ${exampleDay + 1}, "posts": ${examplePosts}}
  ]
}

Gere TODOS os dias de ${blockStart} a ${blockEnd} (total: ${daysInBlock} dias, ${postsPerDay} post(s) por dia).
Cada dia DEVE ter exactamente ${postsPerDay} post(s) com topic específico e com ângulo único.`;

      console.log(`[Calendar] Gerando bloco dias ${blockStart}–${blockEnd} para ${profile}/${month}/${year}`);

      const blockRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 4000, messages: [{ role: 'user', content: blockPrompt }] }),
      });

      const blockData = await blockRes.json();
      if (blockData.error) throw new Error(`Claude API: ${blockData.error.message}`);

      const rawText = blockData.content[0].text.trim();
      console.log(`[Calendar] Bloco ${blockStart}–${blockEnd} raw (primeiros 200 chars):`, rawText.slice(0, 200));

      let blockDays = [];
      try {
        const parsed = extractJSON(rawText);
        blockDays    = normalizeDays(parsed);
        console.log(`[Calendar] Bloco ${blockStart}–${blockEnd} parseado: ${blockDays.length} dias`);
        if (blockDays.length > 0) console.log(`[Calendar] Amostra dia ${blockDays[0].day}:`, JSON.stringify(blockDays[0]));
      } catch (parseErr) {
        console.error(`[Calendar] Erro ao parsear bloco ${blockStart}–${blockEnd}:`, parseErr.message);
        for (let d = blockStart; d <= blockEnd; d++) blockDays.push({ day: d, posts: [] });
      }

      allDays.push(...blockDays);
    }

    const generated = readJSON(GENERATED_FILE).filter(g => g.profile === profile);

    const calendarDays = allDays.map(dayEntry => {
      const dayNum = Number(dayEntry.day);
      const posts  = Array.isArray(dayEntry.posts) ? dayEntry.posts : [];
      return {
        day:   dayNum,
        posts: posts.map(post => {
          const topic = (post.topic || post.tema || '').trim();
          const type  = post.type || post.tipo || 'educativo';
          const time  = post.time || post.horario || '09:00';
          const match = generated.find(g => g.calendarDay === dayNum && g.calendarMonth === month && g.calendarYear === year);
          return { time, type, topic, date: `${year}-${String(month).padStart(2,'0')}-${String(dayNum).padStart(2,'0')}`, contentId: match?.id || null, status: match?.status || 'pendente', scheduledAt: match?.scheduledAt || null };
        }),
      };
    });

    const totalPosts = calendarDays.reduce((acc, d) => acc + d.posts.length, 0);
    console.log(`[Calendar] Total: ${calendarDays.length} dias, ${totalPosts} posts gerados`);
    if (totalPosts === 0) throw new Error('A IA retornou calendário sem posts. Tenta novamente.');

    writeJSON(CALENDAR_FILE, { profile, month, year, calendar: calendarDays, savedAt: new Date().toISOString() });

    if (supabase) {
      await supabase.from('calendars').upsert({
        id: `${profile}_${year}_${month}`, profile, month: parseInt(month), year: parseInt(year),
        data: JSON.stringify(calendarDays), updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });
    }

    res.json({ calendar: calendarDays });
  } catch(err) {
    console.error('[Calendar] Erro geral:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/calendar/saved', async (req, res) => {
  try {
    const { profile, month, year } = req.query;
    if (supabase) {
      const { data, error } = await supabase.from('calendars').select('data, updated_at').eq('id', `${profile}_${year}_${month}`).single();
      if (!error && data?.data) {
        const calendar = typeof data.data === 'string' ? JSON.parse(data.data) : data.data;
        return res.json({ found: true, calendar, savedAt: data.updated_at });
      }
    }
    const saved = readJSON(CALENDAR_FILE);
    if (saved?.profile === profile && String(saved.month) === String(month) && String(saved.year) === String(year) && saved.calendar?.length) {
      return res.json({ found: true, calendar: saved.calendar, savedAt: saved.savedAt });
    }
    res.json({ found: false });
  } catch(e) { console.error('calendar/saved error:', e); res.json({ found: false }); }
});

// ── Gerar + Salvar carrossel ──────────────────────────────────────────────
app.post('/api/carousel/generate-and-save', async (req, res) => {
  try {
    const { topic, blocks, profile, calendarDay, calendarMonth, calendarYear, caption, hashtags, contentMachineType } = req.body;
    const manualNote = getManualText(profile);
    const brand      = BRAND_IDENTITIES[profile] || BRAND_IDENTITIES.marca;
    const account    = getAccount(profile);
    const mode       = blocks ? 'blocks' : 'topic';
    const isAna      = profile === 'pessoal';

    const systemPrompt = isAna
      ? `Você é o gerador de carrosseis da Ana Moutinho — marca pessoal "Ana mais real".
${brand.copyDNA || ''}
REGRAS: Retornar APENAS JSON válido, sem markdown. Nunca travessão (—). Proibido: "Descubra", "Seja sua melhor versão".`
      : `Você é o gerador de carrosseis da BrandsDecoded — padrão mais alto de copy para Instagram.
PRINCÍPIOS: Slide 1 hook (14-18 palavras), afirmação provocativa. Proibido: travessão (—), frases genéricas.
Retornar APENAS JSON válido, sem markdown.`;

    let prompt;
    if (mode === 'blocks') {
      prompt = `Perfil: ${account.name} (${account.handle})
${manualNote ? 'Diretrizes: ' + manualNote : ''}
Converte estes blocos em slides (1 bloco = 1 slide):
${blocks}
JSON: {"title":"...","slideCount":N,"slides":[{"slideNumber":1,"heading":"...","body":"...","imagePrompt":"scene in english"}],"caption":"...","hashtags":"#tag1 #tag2"}`;
    } else {
      prompt = `Perfil: ${account.name} (${account.handle})
${manualNote ? 'Diretrizes: ' + manualNote + '\n' : ''}
Tema: "${topic}"
Total: ${isAna ? '7-8' : '10'} slides.
JSON: {"title":"...","slideCount":${isAna ? 8 : 10},"slides":[{"slideNumber":1,"heading":"hook","body":"","imagePrompt":"scene in english"}],"caption":"legenda completa com emojis e CTA","hashtags":"#hashtag1 #hashtag2"}`;
    }

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 8192, system: systemPrompt, messages: [{ role: 'user', content: prompt }] }),
    });
    const d = await r.json();
    if (d.error) return res.status(500).json({ error: d.error.message });

    const carouselData = extractJSON(d.content[0].text.trim());

    const item = saveGeneratedContent({
      id: `cnt_${Date.now()}`, createdAt: new Date().toISOString(), status: 'pendente',
      type: 'carrossel', mode, profile,
      topic: topic || `Carrossel ${carouselData.slideCount} slides`,
      caption: caption || carouselData.caption, hashtags: hashtags || carouselData.hashtags,
      contentMachineType: contentMachineType || null, carouselData,
      calendarDay: calendarDay || null, calendarMonth: calendarMonth || null, calendarYear: calendarYear || null,
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
CTA FIXO (último texto): "salva pra reler quando esquecer disso. e me diz nos comentários se isso fez sentido pra você."
Retornar APENAS JSON válido, sem markdown.`
      : `Você é o gerador oficial de carrosseis de alta performance da BrandsDecoded.
REGRAS: Nunca inventar fatos. Proibido travessão (—). Sem "Descubra/Saiba/Conheça".
ASSINATURA FIXA: "Gostou desse conteúdo? Aproveite para seguir nosso perfil. E caso queira saber sobre o nosso acompanhamento, comente 'CASE' que nossa equipe te chama."
Retornar APENAS JSON válido, sem markdown.`;

    const tipoInstrucoes = {
      tendencia: isAna ? 'Capa nomeia padrão de comportamento. Desenvolvimento: observação → tensão → aprofundamento → virada.' : 'Capa como fenômeno. Por que acontece. Implicações. O que muda.',
      case: 'Capa como fenômeno cultural. Contexto. Ponto de virada. Resultados. Lição.',
      educativo: isAna ? 'Capa promete estratégia de vida com nome. Slides: um passo por slide, íntimo e concreto.' : 'Capa promete método com nome. Slides: um passo por slide com exemplo.',
      comparacao: 'Capa ativa contraste. Lado A. Virada. Lado B.',
      lista: 'Capa com número e promessa. Um item por slide.',
      prova_social: 'Capa foca resultado. Antes. Processo. Números. Lição.',
      oferta: 'Capa ativa desejo. Problema. Solução. Para quem. Prova. O que inclui.',
      dump: isAna ? 'Capa humaniza. Momentos reais com narrativa. Reflexão. Conexão com processo pessoal.' : 'Capa humaniza. Momentos com narrativa. Reflexão. Conexão com missão.',
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
    {"slide":1,"funcao":"CAPA","textos":[{"posicao":1,"tipo":"hook","texto":"..."},{"posicao":2,"tipo":"sub-hook","texto":"..."}]},
    {"slide":2,"funcao":"TENSÃO","textos":[{"posicao":3,"tipo":"titulo","texto":"..."},{"posicao":4,"tipo":"paragrafo","texto":"..."}]},
    {"slide":13,"funcao":"CTA","textos":[{"posicao":18,"tipo":"cta","texto":"${isAna ? 'salva pra reler quando esquecer disso.' : 'Gostou? Comente CASE que nossa equipe te chama.'}"}]}
  ]
}`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o', temperature: 1.0, max_tokens: 4500, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }] }),
    });
    const data = await response.json();
    if (data.error) return res.status(500).json({ error: data.error.message });

    const parsed = extractJSON(data.choices[0].message.content.trim());

    const slidesNorm = (parsed.slides || []).map(s => {
      const txs = s.textos || [];
      return { slideNumber: s.slide, funcao: s.funcao || '', heading: txs[0]?.texto || '', body: txs[1]?.texto || '', textos: txs };
    });

    const item = saveGeneratedContent({
      id: `cnt_${Date.now()}`, createdAt: new Date().toISOString(), status: 'pendente', type: 'carrossel',
      contentMachineType: tipo, contentMachineTypeLabel: tipoLabels[tipo] || tipo,
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
