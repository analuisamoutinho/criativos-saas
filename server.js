const express = require('express');
const cors    = require('cors');
const multer  = require('multer');
const fs      = require('fs');
const path    = require('path');
const os      = require('os');
const fetch   = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// ── Storage ───────────────────────────────────────────────────────────────
const upload = multer({ dest: 'uploads/' });

const DATA_DIR      = fs.existsSync('/tmp') ? '/tmp' : '.';
const SCHEDULED_FILE = path.join(DATA_DIR, 'scheduled_posts.json');
const GENERATED_FILE = path.join(DATA_DIR, 'generated_content.json');
const CALENDAR_FILE  = path.join(DATA_DIR, 'calendar_data.json');
const MANUALS_DIR    = path.join(DATA_DIR, 'manuals');
const IMAGES_DIR     = path.join(DATA_DIR, 'carousel_images');

try { fs.mkdirSync('uploads/',         { recursive: true }); } catch(e) {}
try { fs.mkdirSync(MANUALS_DIR,        { recursive: true }); } catch(e) {}
try { fs.mkdirSync(IMAGES_DIR,         { recursive: true }); } catch(e) {}
try { fs.mkdirSync('uploads/photos/',  { recursive: true }); } catch(e) {}

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
  console.log('⚠️  @supabase/supabase-js não instalado — usando ficheiros locais');
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
    supabase.from('generated_content').update({ status, ...extra }).eq('id', id)
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
// IDENTIDADES VISUAIS POR PERFIL
// ═══════════════════════════════════════════════════════════════════════════
const BRAND_IDENTITIES = {
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
    moods: [
      'HERO_DARK', 'EDITORIAL_LIGHT', 'TYPE_LIGHT', 'SPLIT_LIGHT',
      'TABLE_LIGHT', 'TYPE_DARK', 'EDITORIAL_LIGHT', 'BRAND_PUNCH', 'CTA_LIGHT',
    ],
    aestheticDNA: `Premium B2B editorial design. Think The Economist cover meets McKinsey Digital report.
TYPOGRAPHY: Geometric sans-serif (Inter or Neue Haas Grotesk equivalent), weight 700-900 for headings. Clean, structured, authoritative.
NEVER: hype graphics, rockets, explosions, cartoonish elements, neon colors, aggressive design, excessive decoration.
ALWAYS convey: structure, clarity, strategic intelligence, premium quality, data-driven thinking, architectural precision.
PHOTOGRAPHY when used: executive boardroom, data screens, architectural details, precise editorial composition. Desaturated or cool tones.
GRAPHIC ELEMENTS: clean grid lines, data column motifs (tall thin rectangles suggesting bar charts), subtle ascending line patterns.`,
  },
  pessoal: {
    accent:      '#E4007C',
    accentAlt:   '#FF6B35',
    bgDark:      '#0D0D0D',
    bgLight:     '#FFFFFF',
    bgBrand:     '#3B0F4C',
    textOnDark:  '#FFFFFF',
    textOnLight: '#111111',
    handle:      '@analuisa.moutinho',
    name:        'Ana Moutinho',
    moods: [
      'HERO_DARK', 'EDITORIAL_LIGHT', 'TYPE_LIGHT', 'HERO_DARK',
      'TABLE_LIGHT', 'TYPE_DARK', 'EDITORIAL_LIGHT', 'BRAND_PUNCH', 'CTA_LIGHT',
    ],
    aestheticDNA: `Personal brand editorial design. Warm, human, authentic energy.
TYPOGRAPHY: Modern humanist sans-serif, bold weight 700-900, approachable and dynamic.
PHOTOGRAPHY: Real authentic moments, warm tones, human connection, lifestyle editorial feel.
GRAPHIC ELEMENTS: clean bold layouts, magenta accent lines, strong contrast between type and image.`,
  },
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
    moods: [
      'HERO_DARK', 'TYPE_DARK', 'EDITORIAL_LIGHT', 'HERO_DARK',
      'TABLE_LIGHT', 'TYPE_DARK', 'EDITORIAL_LIGHT', 'BRAND_PUNCH', 'CTA_LIGHT',
    ],
    aestheticDNA: `Tech B2B precision design. Sharp, forward-looking, data-driven.
TYPOGRAPHY: Geometric tech sans-serif, precise and clean, weight 700-900.
VISUALS: Abstract data visualizations, digital interfaces, circuit-inspired patterns, tech product renders.
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
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Apenas imagens'));
  },
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
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', max_tokens: 512,
        messages: [{ role: 'user', content: `Tema: "${topic}"\nFotos:\n${photoList}\nSeleciona até ${limit} IDs. JSON: {"suggestions":["id1"]}` }],
      }),
    });
    const d    = await r.json();
    const text = d.content[0].text;
    const match  = text.match(/\{[\s\S]*\}/);
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
  let all   = readJSON(PHOTOS_FILE);
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
    const manualNote = getManualText(profile);
    const systemMsg  = `Você é especialista em marketing digital e criação de conteúdo para Instagram.
Responda sempre em português de Portugal.
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

// ── Slide de carrossel com identidade visual — PROMPTS LIMPOS ─────────────
app.post('/api/image/carousel-slide', async (req, res) => {
  try {
    const {
      heading         = '',
      body            = '',
      slideNumber     = 1,
      totalSlides     = 9,
      funcao          = '',
      topic           = '',
      profile         = 'marca',
      imagePromptHint = '',
      contentId       = null,
    } = req.body;

    const brand      = BRAND_IDENTITIES[profile] || BRAND_IDENTITIES.marca;
    const mood       = brand.moods[Math.min(slideNumber - 1, brand.moods.length - 1)];
    const manualCtx  = getManualText(profile);

    const h = heading.replace(/"/g, "'").replace(/—/g, '-').trim();
    const b = body.replace(/"/g, "'").replace(/—/g, '-').trim().slice(0, 140);

    const hWords       = h.split(/\s+/).filter(w => w.length > 2);
    const accentPhrase = hWords.length >= 3
      ? hWords.slice(-Math.min(2, Math.ceil(hWords.length / 3))).join(' ')
      : hWords[hWords.length - 1] || '';

    // Cena visual via Claude Haiku (só para slides com imagem)
    let scene        = imagePromptHint || '';
    const needsScene = ['HERO_DARK', 'SPLIT_LIGHT'].includes(mood);

    if (needsScene && !scene) {
      try {
        const sr = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001', max_tokens: 90,
            messages: [{ role: 'user', content: `Art director for ${brand.name}. ${brand.aestheticDNA.split('\n')[0]}\nTopic: "${topic}" | Slide ${slideNumber}: "${h}"\nDescribe in max 12 words the PERFECT background visual. Ultra-specific. No text. English only.` }],
          }),
        });
        const sd = await sr.json();
        if (sd.content?.[0]?.text) scene = sd.content[0].text.trim().replace(/^["']|["']$/g, '');
      } catch(e) { scene = `${topic}, editorial photography, professional lighting`; }
    }

    const slideRef  = `Slide ${slideNumber} of ${totalSlides}`;

    let prompt = '';

    if (mood === 'HERO_DARK') {
      prompt = `You are creating ONE premium Instagram slide. ${slideRef}.

${brand.aestheticDNA}
${manualCtx}

OUTPUT: 1024×1536px portrait. Dark cinematic editorial.

BACKGROUND: Full-bleed photograph. Subject: ${scene || `dramatic scene related to "${topic}"`}. Professional photography, moody lighting, deep shadows.
Gradient overlay: transparent at top, fading to solid ${brand.bgDark} covering bottom 45% of canvas.

TEXT (bottom 40%, left-aligned, 7% horizontal padding):
"${h}" — Inter Black ~90px, white, tight line-height 1.0.
Last 2 words in ${brand.accent} color.
${b ? `"${b}" — 22px regular, white 60% opacity, margin-top 14px.` : ''}

TOP-LEFT corner: "${brand.handle}" — ${brand.accent}, 11px, opacity 60%.
${funcao ? `Below handle: "${funcao}" — ${brand.accent}, 9px uppercase, letter-spacing 2px.` : ''}
BOTTOM EDGE: solid 3px line ${brand.accent}, full width.

NOTHING ELSE. No boxes. No icons. No extra shapes. No decorative frames.
One image. One headline. Absolute clarity.`;

    } else if (mood === 'EDITORIAL_LIGHT') {
      prompt = `You are creating ONE premium Instagram slide. ${slideRef}.

${brand.aestheticDNA}
${manualCtx}

OUTPUT: 1024×1536px portrait. Clean white editorial. NO photograph inside the slide.

BACKGROUND: Pure ${brand.bgLight}. Flat, clean.

LAYOUT (strict top-to-bottom):
TOP-LEFT (y=4%): "${brand.handle}" — ${brand.accent}, 11px, 60% opacity.
${funcao ? `Below: "${funcao}" — ${brand.accent}, 9px uppercase, 2px letter-spacing.` : ''}

HEADING (y=18–58%, left margin 7%):
"${h}" — Inter Black ~82px, ${brand.textOnLight}, line-height 1.05, tight tracking.
Words "${accentPhrase}" in ${brand.accent}.

${b ? `BODY (below heading, margin-top 20px): "${b}" — 21px regular, ${brand.textOnLight} 75% opacity, line-height 1.6.` : ''}

BOTTOM EDGE: 3px solid line ${brand.accent}, full width.

ABSOLUTELY NOTHING ELSE. No photographs. No contained image blocks. No decorative shapes. No icons.
White space is intentional. Typography carries the entire visual weight.`;

    } else if (mood === 'TYPE_LIGHT') {
      prompt = `You are creating ONE premium Instagram slide. ${slideRef}.

${brand.aestheticDNA}
${manualCtx}

OUTPUT: 1024×1536px portrait. Pure typography on light background.

BACKGROUND: ${brand.bgLight}. No image. Optional: single very faint vertical line (1px, ${brand.accent}, 5% opacity) as minimal decoration only.

TOP-LEFT: "${brand.handle}" — ${brand.accent}, 11px, 60% opacity.
${funcao ? `"${funcao}" — ${brand.accent}, 9px uppercase.` : ''}

MAIN TEXT (y=20–80%, left margin 7%):
"${h}" — Inter Black ~88px, ${brand.textOnLight}, line-height 1.0, letter-spacing -1px.
Words "${accentPhrase}" in ${brand.accent}.
${b ? `"${b}" — 22px regular, ${brand.textOnLight} 72% opacity, margin-top 26px.` : ''}

BOTTOM: 3px ${brand.accent} line.

NO image. NO texture. NO decoration beyond what is listed above. Typography only.`;

    } else if (mood === 'TYPE_DARK') {
      prompt = `You are creating ONE premium Instagram slide. ${slideRef}.

${brand.aestheticDNA}
${manualCtx}

OUTPUT: 1024×1536px portrait. Dark typography slide.

BACKGROUND: ${brand.bgDark}. Flat. Optional: very subtle 2% noise texture for depth. Nothing else.

TOP-LEFT: "${brand.handle}" — ${brand.accent}, 11px, 60% opacity.
${funcao ? `"${funcao}" — ${brand.accent}, 9px uppercase.` : ''}

MAIN TEXT (y=22–78%, left margin 7%):
"${h}" — Inter Black ~92px, white, line-height 1.0, letter-spacing -1px.
Words "${accentPhrase}" MUST be in ${brand.accent}.
${b ? `"${b}" — 22px regular, white 68% opacity, margin-top 28px.` : ''}

ACCENT: single horizontal bar 40px wide × 3px tall in ${brand.accent}, left-aligned, directly below heading.

BOTTOM: 3px ${brand.accent} line.

NO photograph. NO complex background. Dark background + type + one accent bar. That is all.`;

    } else if (mood === 'BRAND_PUNCH') {
      const punchBg = profile === 'marca' ? brand.bgDark : brand.bgBrand;
      prompt = `You are creating ONE premium Instagram slide. ${slideRef}. This is the PIVOT / CLIMAX slide.

${brand.aestheticDNA}
${manualCtx}

OUTPUT: 1024×1536px portrait. Bold emotional pivot slide.

BACKGROUND: ${punchBg}. Optional: one large geometric shape in ${brand.accent} at 5% opacity (circle or rectangle partially cropped at edge). Nothing more.

TOP: "${funcao || 'A VIRADA'}" — ${brand.accent}, 9px uppercase, letter-spacing 3px. y=4%, left 7%.

MAIN TEXT (y=18–74%, left 7%):
"${h}" — Inter Black ~96px, white, line-height 0.95, ultra-tight.
Words "${accentPhrase}" in ${brand.accent}.
${b ? `"${b}" — 24px regular, white 78% opacity, margin-top 26px.` : ''}

BOTTOM: 3px ${brand.accent} line.

MAXIMUM TYPOGRAPHIC IMPACT. One focal point. No photographs. No complex elements. No decoration.`;

    } else if (mood === 'TABLE_LIGHT') {
      prompt = `You are creating ONE premium Instagram slide. ${slideRef}.

${brand.aestheticDNA}
${manualCtx}

OUTPUT: 1024×1536px portrait. Clean comparison table slide.

BACKGROUND: ${brand.bgLight}. Flat white.

TOP-LEFT: "${brand.handle}" — ${brand.accent}, 11px, 60% opacity.
${funcao ? `"${funcao}" — ${brand.accent}, 9px uppercase.` : ''}

HEADING (y=8%, left 7%): "${h}" — Inter Black ~60px, ${brand.textOnLight}. Words "${accentPhrase}" in ${brand.accent}.

TABLE (y=28–78%, 6% side margins. TWO columns, THREE rows maximum):
Left column header: dark background ${brand.bgDark}, white text "SEM SISTEMA", 14px bold.
Right column header: ${brand.accent} background, dark text "COM ${brand.name.toUpperCase()}", 14px bold.
Row cells: white background, 1px dividers (${brand.accent} 12% opacity).
Content: 3 concrete contrasts for the topic "${topic}". Left = problem. Right = solution.
Cell padding: 12px. Font: 14px regular.

BOTTOM: 3px ${brand.accent} line.

NO illustrations. NO icons. NO extra UI elements. Table + heading only. Clean and clear.`;

    } else if (mood === 'CTA_LIGHT') {
      const ctaWord = accentPhrase.toUpperCase() || brand.name.toUpperCase();
      prompt = `You are creating ONE premium Instagram slide. ${slideRef}. FINAL CTA SLIDE.

${brand.aestheticDNA}
${manualCtx}

OUTPUT: 1024×1536px portrait. Clean white conversion slide.

BACKGROUND: ${brand.bgLight}. Pure white.

TOP-LEFT: "${brand.handle}" — ${brand.accent}, 11px, 60% opacity.

HEADLINE (y=22–46%, left 7%):
"${h}" — Inter Black ~72px, ${brand.textOnLight}. Words "${accentPhrase}" in ${brand.accent}.

CTA BOX (y=54–70%, centered, 88% width):
Rounded rectangle, background #EDECE8, border-radius 12px.
Subtle 1px border ${brand.accent} 20% opacity.
Inside — three lines centered:
  "Comenta a palavra:" — 15px gray
  "${ctaWord}" — 50px ${brand.accent} bold
  "e recebe no DM" — 14px gray

BOTTOM: "${brand.handle}" — 13px ${brand.accent} bold. Then 3px ${brand.accent} line.

TWO ELEMENTS ONLY: headline + CTA box. Nothing else. Breathe.`;

    } else {
      // SPLIT_LIGHT fallback
      prompt = `You are creating ONE premium Instagram slide. ${slideRef}.

${brand.aestheticDNA}
${manualCtx}

OUTPUT: 1024×1536px portrait. Clean editorial.

BACKGROUND: ${brand.bgLight}.

TOP-LEFT: "${brand.handle}" — ${brand.accent}, 11px, 60% opacity.
${funcao ? `"${funcao}" — ${brand.accent}, 9px uppercase.` : ''}

TEXT BLOCK (y=15–80%, left 7%):
"${h}" — Inter Black ~74px, ${brand.textOnLight}. Words "${accentPhrase}" in ${brand.accent}.
${b ? `"${b}" — 21px regular, ${brand.textOnLight} 76% opacity, margin-top 22px.` : ''}

BOTTOM: 3px ${brand.accent} line.

Clean, deliberate. One typographic statement. Nothing decorative.`;
    }

    // Chamar GPT Image-1
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

// ── Base de conteúdos gerados ─────────────────────────────────────────────
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

// ── Instagram — publicação ────────────────────────────────────────────────
async function publishSingle(account, imageUrl, caption) {
  const { id: accountId, token } = account;
  const containerRes = await fetch(
    `https://graph.facebook.com/v19.0/${accountId}/media?image_url=${encodeURIComponent(imageUrl)}&caption=${encodeURIComponent(caption)}&access_token=${token}`,
    { method: 'POST' }
  );
  const { id: containerId, error } = await containerRes.json();
  if (error) throw new Error(error.message);
  await new Promise(r => setTimeout(r, 5000));
  const pubRes = await fetch(
    `https://graph.facebook.com/v19.0/${accountId}/media_publish?creation_id=${containerId}&access_token=${token}`,
    { method: 'POST' }
  );
  return pubRes.json();
}

async function publishCarousel(account, imageUrls, caption) {
  const { id: accountId, token } = account;
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

// ── Agendamento ───────────────────────────────────────────────────────────
app.post('/api/instagram/schedule', (req, res) => {
  try {
    const { scheduledAt, contentId, ...rest } = req.body;
    const posts    = readJSON(SCHEDULED_FILE);
    const newPost  = { id: `sch_${Date.now()}`, contentId, scheduledAt, status: 'pending', ...rest };
    posts.push(newPost);
    writeJSON(SCHEDULED_FILE, posts);
    if (contentId) updateContentStatus(contentId, 'agendado', { scheduledAt, scheduleId: newPost.id });
    res.json({ success: true, scheduledPost: newPost });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/instagram/scheduled', (req, res) => {
  res.json(readJSON(SCHEDULED_FILE));
});

app.delete('/api/instagram/scheduled/:id', (req, res) => {
  const posts = readJSON(SCHEDULED_FILE).filter(p => p.id !== req.params.id);
  writeJSON(SCHEDULED_FILE, posts);
  res.json({ success: true });
});

setInterval(async () => {
  const posts   = readJSON(SCHEDULED_FILE);
  const now     = new Date();
  let changed   = false;
  for (const post of posts) {
    if (post.status !== 'pending') continue;
    if (new Date(post.scheduledAt) > now) continue;
    try {
      const account = getAccount(post.profile);
      let result;
      if (post.type === 'carousel' && post.imageUrls?.length > 1) {
        result = await publishCarousel(account, post.imageUrls, post.caption);
      } else {
        result = await publishSingle(account, post.imageUrl || post.imageUrls?.[0], post.caption);
      }
      post.status      = result.error ? 'error' : 'published';
      post.publishedAt = new Date().toISOString();
      post.instagramId = result.id;
      if (post.contentId) updateContentStatus(post.contentId, 'publicado', { publishedAt: post.publishedAt, instagramId: result.id });
      changed = true;
    } catch(err) {
      post.status = 'error';
      post.error  = err.message;
      changed     = true;
    }
  }
  if (changed) writeJSON(SCHEDULED_FILE, posts);
}, 60_000);

// ── Calendário editorial ──────────────────────────────────────────────────
app.post('/api/calendar/generate', async (req, res) => {
  try {
    const { month, year, profile, postsPerDay = 2 } = req.body;
    const manualNote  = getManualText(profile);
    const account     = getAccount(profile);
    const daysInMonth = new Date(year, month, 0).getDate();
    const BLOCK       = 10;
    const allDays     = [];

    for (let blockStart = 1; blockStart <= daysInMonth; blockStart += BLOCK) {
      const blockEnd = Math.min(blockStart + BLOCK - 1, daysInMonth);
      const blockPrompt = `Você é o estrategista de conteúdo criando o calendário editorial de ${account.name} (${account.handle}) para ${month}/${year}.

METODOLOGIA BRANDSDECODED — SEGUIR OBRIGATORIAMENTE:
O Instagram em 2026 é plataforma de DESCOBERTA. Todo post deve funcionar para quem NUNCA viu o perfil.
Métricas que importam: retenção, compartilhamentos, saves.

TIPOS DE POST (usar APENAS estes):
- "tendencia": Análise de Tendência — movimento cultural/mercado em alta
- "case": Case de Sucesso — história de marca/pessoa explicando o ponto de virada
- "educativo": Framework com método específico e nome
- "comparacao": Antes/depois, certo/errado — alto alcance
- "lista": Lista de insights — fácil de consumir
- "prova_social": Resultado real de cliente — bom para conversão
- "oferta": Produto/serviço envolto em valor — máximo 1x/semana

PERFIL: ${account.name} (${account.handle})
${manualNote ? 'DIRETRIZES DO CLIENTE:\n' + manualNote : ''}

DISTRIBUIÇÃO: 40% tendencia, 30% case, 15% educativo+comparacao+lista, 15% prova_social+oferta
HORÁRIOS: 09:00, 12:00, 18:00

REGRA CRÍTICA DO TOPIC — deve ser:
✅ ESPECÍFICO — nomear empresa, pessoa, fenômeno ou dado concreto
✅ COM ÂNGULO — não só o tema, mas o ponto de vista
✅ PROIBIDO: "Dicas de marketing", "Como crescer no Instagram", frases genéricas

Responde APENAS com JSON válido:
{
  "days": [
    { "day": ${blockStart}, "posts": [{ "time": "09:00", "type": "tendencia", "topic": "tema específico" }] }
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

    const calendar  = { calendar: allDays };
    const generated = readJSON(GENERATED_FILE).filter(g => g.profile === profile);
    calendar.calendar = calendar.calendar.map(dayEntry => ({
      ...dayEntry,
      posts: (dayEntry.posts || []).map(post => {
        const match = generated.find(g =>
          g.calendarDay === dayEntry.day && g.calendarMonth === month && g.calendarYear === year
        );
        return {
          ...post,
          date:        `${year}-${String(month).padStart(2,'0')}-${String(dayEntry.day).padStart(2,'0')}`,
          contentId:   match?.id     || null,
          status:      match?.status || 'pendente',
          scheduledAt: match?.scheduledAt || null,
        };
      }),
    }));

    writeJSON(CALENDAR_FILE, { profile, month, year, ...calendar });
    if (supabase) {
      supabase.from('calendars').upsert({
        id: `${profile}_${year}_${month}`, profile, month, year,
        data: JSON.stringify(calendar.calendar), updated_at: new Date().toISOString(),
      }, { onConflict: 'id' }).then(({ error }) => { if (error) console.error('Supabase calendar:', error.message); });
    }

    res.json(calendar);
  } catch(err) {
    console.error('Calendar error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/calendar/saved', async (req, res) => {
  try {
    const { profile, month, year } = req.query;
    if (supabase) {
      const { data, error } = await supabase.from('calendars')
        .select('data').eq('id', `${profile}_${year}_${month}`).single();
      if (!error && data?.data) return res.json({ found: true, calendar: JSON.parse(data.data) });
    }
    const saved = readJSON(CALENDAR_FILE);
    if (saved?.profile === profile && String(saved.month) === String(month) && String(saved.year) === String(year)) {
      return res.json({ found: true, calendar: saved.calendar });
    }
    res.json({ found: false });
  } catch(e) { res.json({ found: false }); }
});

// ── Gerar + Salvar carrossel ──────────────────────────────────────────────
app.post('/api/carousel/generate-and-save', async (req, res) => {
  try {
    const { topic, blocks, profile, calendarDay, calendarMonth, calendarYear, caption, hashtags, contentMachineType } = req.body;
    const manualNote = getManualText(profile);
    const account    = getAccount(profile);
    const mode       = blocks ? 'blocks' : 'topic';

    const systemPrompt = `Você é o gerador de carrosseis da BrandsDecoded — o padrão mais alto de copy para Instagram no Brasil.

PRINCÍPIOS FUNDAMENTAIS:
1. O Instagram é plataforma de DESCOBERTA. Cada carrossel funciona para quem NUNCA viu o perfil.
2. Carrossel não é design. É copy. O que move o dedo é a tensão narrativa.
3. Funil interno: capa para o desconhecido → tração → avanço → CTA.

CONTRATO DA CAPA (slides 1 e 2):
Slide 1 (hook): 14-18 palavras. Afirmação provocativa + dois-pontos + pergunta. NUNCA começar com Descubra/Saiba/Aprenda.
Slide 2 (sub-hook): 8-12 palavras. Aprofunda o slide 1. Não começa com conectivo.

PROIBIDO em qualquer slide:
- Travessão (—), "virou" em headline, "a ascensão de", "colapso silencioso"
- Frases genéricas com cara de IA
- Inventar fatos, números, datas ou fontes

Retornar APENAS JSON válido, sem markdown.`;

    let prompt;

    if (mode === 'blocks') {
      prompt = `Modo: BLOCOS DE TEXTO
Perfil: ${account.name} (${account.handle})
${manualNote ? 'Diretrizes: ' + manualNote : ''}

Blocos a converter (1 slide cada, preservar texto original):
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
        tendencia:    `TIPO: ANÁLISE DE TENDÊNCIA. Capa como fenômeno. Slides 3-4: por que acontece agora. Slides 5-7: implicações. Slides 8-9: o que muda.`,
        case:         `TIPO: CASE DE SUCESSO. Capa como fenômeno cultural. Slides 3-4: contexto. Slides 5-6: ponto de virada. Slides 7-8: resultados verificáveis. Slide 9: lição.`,
        educativo:    `TIPO: EDUCATIVO/FRAMEWORK. Capa promete método específico com nome. Slides 3-9: um passo por slide com exemplo concreto.`,
        comparacao:   `TIPO: COMPARAÇÃO. Capa activa contraste. Slides 3-5: Lado A. Slide 6: ponto de virada. Slides 7-9: Lado B.`,
        lista:        `TIPO: LISTA. Capa com número específico e promessa real. Slides 3-9: um item por slide.`,
        prova_social: `TIPO: PROVA SOCIAL. Capa foca no resultado. Slide 3: antes. Slides 4-6: processo. Slides 7-8: números. Slide 9: lição.`,
        oferta:       `TIPO: OFERTA. Capa activa desejo sem soar como anúncio. Slides 3-4: problema. Slides 5-6: solução. Slide 7: para quem. Slide 8: prova. Slide 9: o que inclui.`,
      };

      prompt = `Perfil: ${account.name} (${account.handle})
${manualNote ? 'Diretrizes: ' + manualNote + '\n' : ''}
Tema central: "${topic}"

${contentMachineType && tipoInstrucoes[contentMachineType] ? tipoInstrucoes[contentMachineType] : tipoInstrucoes.tendencia}

PROCESSO INTERNO: 1) Identificar fricção central 2) Gerar headline mais forte (14-18 palavras) 3) Definir espinha dorsal 4) Render com progressão narrativa.

Total: 10 slides.

JSON:
{
  "title": "título interno",
  "slideCount": 10,
  "slides": [
    { "slideNumber": 1, "heading": "hook 14-18 palavras", "body": "", "imagePrompt": "cena em inglês" },
    { "slideNumber": 2, "heading": "sub-hook 8-12 palavras", "body": "", "imagePrompt": "..." }
  ],
  "caption": "legenda completa com emojis, contexto e CTA",
  "hashtags": "#hashtag1 #hashtag2 #hashtag3"
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
    const account    = getAccount(profile);

    const tipoLabels = {
      tendencia:'Análise de Tendência', case:'Case de Sucesso',
      educativo:'Educativo / Framework', comparacao:'Comparação / Antes & Depois',
      lista:'Lista Valiosa', prova_social:'Prova Social', oferta:'Oferta', dump:'Dump / Bastidores',
    };

    const systemPrompt = `Você é o gerador oficial de carrosseis de alta performance da BrandsDecoded.

REGRAS GLOBAIS:
- Nunca inventar fatos, números, datas ou fontes.
- Proibido travessão (—) em qualquer saída.
- Proibido em headline: "quando X vira Y", "a ascensão de", "virou".
- Proibido como abertura: "Descubra", "Saiba", "Conheça".
- Sem 2ª pessoa nos slides de desenvolvimento. Apenas no CTA.
- Sempre em português do Brasil.

CONTRATO DA CAPA:
Slide 1 (hook): 14-18 palavras. Afirmação provocativa + dois-pontos + pergunta.
Slide 2 (sub-hook): 8-12 palavras. Tensionar o slide 1. Não começa com conectivo.

ESTRUTURA DE 18 TEXTOS EM 10-13 SLIDES:
textos 1-2 = capa | textos 3,7,11,14 = títulos de secção (11-15 palavras)
textos 4,5,8,9,12,13,15,16 = parágrafos (25-32 palavras)
textos 6,10 = parágrafos curtos de transição (22-26 palavras)
texto 17 = fechamento (26-30 palavras)
texto 18 = assinatura fixa

ASSINATURA FIXA (texto 18):
Gostou desse conteúdo? Aproveite para seguir nosso perfil. E caso queira saber sobre o nosso acompanhamento, comente "CASE" que nossa equipe te chama.

Retornar APENAS JSON válido, sem markdown.`;

    const tipoInstrucoes = {
      tendencia:`TIPO: ANÁLISE DE TENDÊNCIA. Capa trata como fenômeno. Slides 3-4: por que acontece. Slides 5-7: implicações. Slides 8-9: o que muda.`,
      case:`TIPO: CASE DE SUCESSO. Capa como fenômeno cultural. Slides 3-4: contexto. Slides 5-6: ponto de virada. Slides 7-8: resultados. Slide 9: lição.`,
      educativo:`TIPO: EDUCATIVO/FRAMEWORK. Capa promete método com nome. Slides 3-9: um passo por slide com exemplo.`,
      comparacao:`TIPO: COMPARAÇÃO. Capa activa contraste. Slides 3-5: Lado A. Slide 6: virada. Slides 7-9: Lado B.`,
      lista:`TIPO: LISTA. Capa com número e promessa. Slides 3-9: um item por slide.`,
      prova_social:`TIPO: PROVA SOCIAL. Capa foca resultado. Slide 3: antes. Slides 4-6: processo. Slides 7-8: números. Slide 9: lição.`,
      oferta:`TIPO: OFERTA. Capa activa desejo. Slides 3-4: problema. Slides 5-6: solução. Slide 7: para quem. Slide 8: prova. Slide 9: o que inclui.`,
      dump:`TIPO: DUMP/BASTIDORES. Capa humaniza. Slides 3-7: momentos com narrativa. Slide 8: reflexão. Slide 9: conexão com missão.`,
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
    { "slide": 2, "funcao": "TRAÇÃO", "textos": [
        { "posicao": 3, "tipo": "titulo",    "texto": "..." },
        { "posicao": 4, "tipo": "paragrafo", "texto": "..." }
    ]},
    { "slide": 13, "funcao": "ASSINATURA", "textos": [
        { "posicao": 18, "tipo": "assinatura", "texto": "Gostou desse conteúdo? Aproveite para seguir nosso perfil. E caso queira saber sobre o nosso acompanhamento, comente \\"CASE\\" que nossa equipe te chama." }
    ]}
  ]
}`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o', temperature: 1.0, max_tokens: 4500,
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
      }),
    });

    const data = await response.json();
    if (data.error) return res.status(500).json({ error: data.error.message });

    let text = data.choices[0].message.content.trim();
    text = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(text);

    const slidesNorm = (parsed.slides || []).map(s => {
      const txs = s.textos || [];
      return {
        slideNumber: s.slide, funcao: s.funcao || '',
        heading: txs[0]?.texto || '', body: txs[1]?.texto || '',
        textos: txs,
      };
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

// ── Health check ──────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

// ── Ficheiros estáticos ───────────────────────────────────────────────────
app.use(express.static('public'));

app.use('/api', (req, res) => {
  res.status(404).json({ error: `Rota não encontrada: ${req.method} ${req.originalUrl}` });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`🚀 Máquina de Conteúdo na porta ${PORT}`));
