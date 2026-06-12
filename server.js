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
const PROFILES_FILE  = path.join(DATA_DIR, 'profiles_manual.json');
const USER_SETTINGS_FILE  = path.join(DATA_DIR, 'user_settings.json');

try { fs.mkdirSync('uploads/',        { recursive: true }); } catch(e) {}
try { fs.mkdirSync(MANUALS_DIR,       { recursive: true }); } catch(e) {}
try { fs.mkdirSync(IMAGES_DIR,        { recursive: true }); } catch(e) {}
try { fs.mkdirSync('uploads/photos/', { recursive: true }); } catch(e) {}

// ── Quality helpers ───────────────────────────────────────────────────────
// CORRIGIDO: adicionado 'high' e 'auto' que a gpt-image-1 aceita
const VALID_QUALITIES = ['low', 'medium', 'high', 'auto'];
const DEFAULT_QUALITY = 'medium';
function resolveQuality(q) { return VALID_QUALITIES.includes(q) ? q : DEFAULT_QUALITY; }

// ── User Settings ─────────────────────────────────────────────────────────
function loadUserSettings() {
  try {
    if (!fs.existsSync(USER_SETTINGS_FILE)) {
      const def = { image_quality: DEFAULT_QUALITY };
      fs.writeFileSync(USER_SETTINGS_FILE, JSON.stringify(def, null, 2));
      return def;
    }
    return JSON.parse(fs.readFileSync(USER_SETTINGS_FILE, 'utf-8'));
  } catch(e) { return { image_quality: DEFAULT_QUALITY }; }
}
function saveUserSettings(settings) {
  try {
    const merged = { ...loadUserSettings(), ...settings };
    fs.writeFileSync(USER_SETTINGS_FILE, JSON.stringify(merged, null, 2));
    return merged;
  } catch(e) { console.error('saveUserSettings:', e.message); return settings; }
}
app.get('/api/user-settings', (req, res) => { res.json(loadUserSettings()); });
app.patch('/api/user-settings', (req, res) => {
  try {
    const updates = {};
    if (req.body.image_quality !== undefined) updates.image_quality = req.body.image_quality;
    if (updates.image_quality && !VALID_QUALITIES.includes(updates.image_quality))
      return res.status(400).json({ error: 'image_quality deve ser: ' + VALID_QUALITIES.join(' | ') });
    res.json({ success: true, settings: saveUserSettings(updates) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Supabase ──────────────────────────────────────────────────────────────
let supabase = null;
try {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
    const { createClient } = require('@supabase/supabase-js');
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    console.log('✅ Supabase conectado — dados persistentes entre deploys');
  } else {
    console.log('');
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║  ⚠️  AVISO: Supabase não configurado                         ║');
    console.log('║  Os dados (biblioteca, calendário, posts) serão apagados     ║');
    console.log('║  a cada novo deploy no Railway.                              ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('');
  }
} catch(e) {
  console.log('⚠️  Supabase não instalado — usando ficheiros locais');
}

async function checkSupabaseTables() {
  if (!supabase) return;
  try {
    const { error: e1 } = await supabase.from('generated_content').select('id').limit(1);
    const { error: e2 } = await supabase.from('calendars').select('id').limit(1);
    if (e1 || e2) {
      console.log('❌ Tabelas Supabase não encontradas — corre supabase-schema.sql');
    } else {
      console.log('✅ Tabelas Supabase verificadas');
    }
  } catch(e) { console.warn('Aviso ao verificar tabelas Supabase:', e.message); }
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

// ═══════════════════════════════════════════════════════════════════════════
// METODOLOGIAS DE CONTEÚDOM
// ═══════════════════════════════════════════════════════════════════════════

const METODOLOGIA_RR = {
  nome: 'Metodologia RR — Sistema de Conteúdo Viral',
  filosofia: `
FILOSOFIA BASE (Metodologia RR):
- Conteúdo não é venda, é transformação. Produza com intenção genuína, não para vender.
- Sirva antes de cobrar. Gere tanto valor que quando cobrar pareça barato.
- Autenticidade supera produção. Pessoas conectam com pessoas, não com personagens polidos.
- Profundidade acima de brevidade. Um conteúdo de 5min que conecta vale mais que 10 de 7 segundos.
- Você não é um profissional de 10 segundos — não se comporte como um.
`,
  estruturaViral: `
ESTRUTURA DE CONTEÚDOM VIRAL (3 pilares obrigatórios):
1. GANCHO (primeiros 3 segundos / primeiro slide): toca na DOR ou DESEJO real.
2. HISTÓRIA (desenvolvimento): conecta com o gancho e manteia interesse.
3. CONCLUSÃO / TESE: sem conclusão, o conteúdo é tirado de contexto.
4. TEMA ESPECÍFICO: cite seu público pelo nome, profissão, situação.
`,
  formatos: `
FORMATOS DISPONÍVEIS PARA MARCA PESSOAL (Metodologia RR):
- LO-FI (câmera ligada, fala direta): maior ROI para quem tem oratória.
- CARROSSEL: ideal para quem comunica bem por texto.
- VÍDEO CURTO (até 13s): exige sacada impactante em poucos segundos.
- VÍDEO MÉDIO (até 1min): equilibra alcance e profundidade.
- FRASE (estilo Twitter): para quem impacta com poucas palavras.
`,
  tonsProibidos: ['motivacional genérico', 'guru', 'coach', 'desbloqueie', 'seja sua melhor versão', 'transforme sua vida', 'fórmula secreta', 'método infalível', 'próximo nível'],
  tonsPermitidos: ['íntimo', 'direto', 'reflexivo', 'provocativo', 'autêntico', 'observador', 'vulnerável sem ser fraco', 'real', 'honesto'],
  tiposConteudo: ['lofi', 'carrossel', 'video_curto', 'video_medio', 'frase', 'dump', 'bastidores'],
};

const TIPOS_RR = {
  lofi: { id: 'lofi', emoji: '🎥', label: 'Lo-Fi (câmera ligada)', instrucao: 'Script para vídeo lo-fi direto ao ponto.' },
  carrossel: { id: 'carrossel', emoji: '📋', label: 'Carrossel', instrucao: 'Slide 1: gancho provocativo. Slides do meio: profundidade real. Slide final: conclusão + CTA leve.' },
  video_curto: { id: 'video_curto', emoji: '⚡', label: 'Vídeo Curto (até 13s)', instrucao: 'Uma única sacada impactante. Sem introdução. Direto ao ponto.' },
  video_medio: { id: 'video_medio', emoji: '🎬', label: 'Vídeo Médio (até 1min)', instrucao: 'Gancho (0-5s) → desenvolvimento (5-50s) → conclusão (50-60s).' },
  frase: { id: 'frase', emoji: '✍️', label: 'Frase de Impacto', instrucao: 'Uma verdade concentrada em 2-3 linhas.' },
  dump: { id: 'dump', emoji: '📸', label: 'Dump / Bastidores', instrucao: 'Momentos reais com narrativa.' },
  bastidores: { id: 'bastidores', emoji: '🎬', label: 'Bastidores', instrucao: 'Mostra o processo real, não o resultado polido.' },
};

const METODOLOGIA_BRANDSDECODED = {
  nome: 'BrandsDecoded — Padrão Premium de Copy Corporativa',
  filosofia: `
FILOSOFIA BASE (BrandsDecoded):
- Autoridade por profundidade, não por hype. Dados, frameworks, análises concretas.
- Hook de 14-18 palavras que nomeia um comportamento ou padrão real de mercado.
- Cada slide precisa ser tão bom que o leitor manda para alguém.
- Nunca inventar fatos. Nunca usar buzzwords sem substância.
`,
  estrutura: `
ESTRUTURA BRANDSDECODED:
- Slide 1: hook como afirmação provocativa que nomeia fenômeno real (14-18 palavras)
- Slides 2-N: dados, frameworks, exemplos verificáveis — profundidade estratégica
- Slide final: CTA direto com assinatura da marca
`,
  tonsProibidos: ['descubra', 'saiba como', 'conheça', 'transforme', 'incrível', 'revolucionário', 'disruptivo', 'mudando o jogo', 'next-level', 'fórmula', 'segredo'],
  tonsPermitidos: ['estratégico', 'analítico', 'direto', 'premium', 'autoridade', 'preciso', 'fundamentado', 'b2b'],
  tiposConteudo: ['tendencia', 'case', 'educativo', 'comparacao', 'lista', 'prova_social', 'oferta'],
};

const TIPOS_BRANDSDECODED = {
  tendencia: { id: 'tendencia', emoji: '📡', label: 'Análise de Tendência', categoria: 'Awareness', instrucao: 'Capa nomeia o fenômeno como declaração.' },
  case: { id: 'case', emoji: '🏆', label: 'Case de Sucesso', categoria: 'Awareness', instrucao: 'Capa como fenômeno cultural. Resultados mensuráveis.' },
  educativo: { id: 'educativo', emoji: '📚', label: 'Educativo / Framework', categoria: 'Autoridade', instrucao: 'Capa promete método com nome próprio.' },
  comparacao: { id: 'comparacao', emoji: '⚖️', label: 'Comparação / Antes & Depois', categoria: 'Alcance', instrucao: 'Capa ativa contraste com dado ou afirmação.' },
  lista: { id: 'lista', emoji: '📋', label: 'Lista Valiosa', categoria: 'Alcance', instrucao: 'Capa com número e promessa específica.' },
  prova_social: { id: 'prova_social', emoji: '🌟', label: 'Prova Social', categoria: 'Conversão', instrucao: 'Capa foca no resultado concreto.' },
  oferta: { id: 'oferta', emoji: '🎯', label: 'Oferta', categoria: 'Conversão', instrucao: 'Capa ativa desejo, não produto.' },
};

function getMetodologia(profile) {
  const profiles = loadProfiles();
  const p = profiles[profile];
  const tipoBrand = p?.tipo || 'corporativa';
  if (tipoBrand === 'pessoal') {
    return { metodologia: METODOLOGIA_RR, tipos: TIPOS_RR, isRR: true };
  }
  return { metodologia: METODOLOGIA_BRANDSDECODED, tipos: TIPOS_BRANDSDECODED, isRR: false };
}

function buildSystemPromptCarrossel(profile, metodologia, isRR) {
  const brand   = BRAND_IDENTITIES[profile] || BRAND_IDENTITIES.marca;
  const account = getAccount(profile);
  const manualNote = getManualText(profile);

  if (isRR) {
    return `Você é o gerador de conteúdo da ${account.name} — marca pessoal seguindo a Metodologia RR.

${METODOLOGIA_RR.filosofia}
${METODOLOGIA_RR.estruturaViral}
${brand.copyDNA || ''}
${manualNote ? `\nDIRETRIZES DO PERFIL:\n${manualNote}` : ''}

REGRAS OBRIGATÓRIAS:
- Retornar APENAS JSON valido, sem markdown. O array "slides" DEVE ter entre 7 e 10 objetos. Cada slide DEVE ter "textos" como array
- NUNCA usar travessão (—) nem hífen no meio de frases
- NUNCA usar: ${METODOLOGIA_RR.tonsProibidos.join(', ')}
- Máximo 4 hashtags na legenda
- Tom: ${METODOLOGIA_RR.tonsPermitidos.join(', ')}`;
  }

  return `Você é o gerador de carrosseis da BrandsDecoded — padrão mais alto de copy corporativa para Instagram.

${METODOLOGIA_BRANDSDECODED.filosofia}
${METODOLOGIA_BRANDSDECODED.estrutura}
${manualNote ? `\nDIRETRIZES DO PERFIL:\n${manualNote}` : ''}

REGRAS OBRIGATÓRIAS:
- Slide 1: hook de 14-18 palavras
- NUNCA usar travessão (—) nem hífen no meio de frases
- NUNCA usar: ${METODOLOGIA_BRANDSDECODED.tonsProibidos.join(', ')}
- Máximo 4 hashtags
- ASSINATURA FIXA no último slide: "Gostou desse conteúdo? Aproveite para seguir nosso perfil. E caso queira saber sobre o nosso acompanhamento, comente 'CASE' que nossa equipe te chama."
- Retornar APENAS JSON valido, sem markdown. O array "slides" DEVE ter entre 7 e 10 objetos. Cada slide DEVE ter "textos" como array`;
}

function buildSystemPromptContentMachine(profile, tipo, metodologia, isRR) {
  const brand   = BRAND_IDENTITIES[profile] || BRAND_IDENTITIES.marca;
  const account = getAccount(profile);
  const manualNote = getManualText(profile);
  const tipoInfo = isRR ? (TIPOS_RR[tipo] || TIPOS_RR.carrossel) : (TIPOS_BRANDSDECODED[tipo] || TIPOS_BRANDSDECODED.educativo);

  if (isRR) {
    return `Você é o gerador de conteúdo da ${account.name} — marca pessoal, Metodologia RR.

${METODOLOGIA_RR.filosofia}
${METODOLOGIA_RR.estruturaViral}
${brand.copyDNA || ''}
${manualNote ? `\nDIRETRIZES DO PERFIL:\n${manualNote}` : ''}

FORMATO ATUAL: ${tipoInfo.emoji} ${tipoInfo.label}
INSTRUÇÃO ESPECÍFICA: ${tipoInfo.instrucao}

REGRAS:
- NUNCA usar: ${METODOLOGIA_RR.tonsProibidos.join(', ')}
- Tom: ${METODOLOGIA_RR.tonsPermitidos.join(', ')}
- Retornar APENAS JSON valido, sem markdown. O array "slides" DEVE ter entre 7 e 10 objetos. Cada slide DEVE ter "textos" como array`;
  }

  return `Você é o gerador oficial de conteúdo de alta performance da BrandsDecoded para ${account.name}.

${METODOLOGIA_BRANDSDECODED.filosofia}
${METODOLOGIA_BRANDSDECODED.estrutura}
${manualNote ? `\nDIRETRIZES DO PERFIL:\n${manualNote}` : ''}

TIPO ATUAL: ${tipoInfo.emoji} ${tipoInfo.label} (${tipoInfo.categoria})
INSTRUÇÃO ESPECÍFICA: ${tipoInfo.instrucao}

REGRAS:
- Nunca inventar fatos
- NUNCA usar travessão (—) nem hífen no meio de frases
- NUNCA usar: ${METODOLOGIA_BRANDSDECODED.tonsProibidos.join(', ')}
- Máximo 4 hashtags
- ASSINATURA FIXA: "Gostou desse conteúdo? Aproveite para seguir nosso perfil. E caso queira saber sobre o nosso acompanhamento, comente 'CASE' que nossa equipe te chama."
- Retornar APENAS JSON valido, sem markdown. O array "slides" DEVE ter entre 7 e 10 objetos. Cada slide DEVE ter "textos" como array`;
}

// ═══════════════════════════════════════════════════════════════════════════
// PERFIS
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_PROFILES = {
  marca: {
    profileId: 'marca', tipo: 'corporativa', nome: 'Case Aceleradora',
    handle: '@caseaceleradora', niche: 'Aceleração de negócios digitais, B2B, growth hacking',
    bio: 'Aceleramos negócios digitais com estratégia, dados e criatividade.',
    tom: 'Autoritário, estratégico, direto. Premium B2B. Sem hype.',
    proibidos: ['Descubra', 'Transforme sua vida', 'Saiba como', 'Riqueza', 'Fórmula secreta'],
    pilares: ['Estratégia de negócio', 'Cases de sucesso', 'Tendências de mercado', 'Frameworks de growth'],
    publicoAlvo: 'Fundadores, CEOs e diretores de empresas digitais em fase de escala',
    cta: 'Comente "CASE" que nossa equipe te chama.',
    referencias: ['Monocle', 'FT Weekend', 'McKinsey Digital', 'The Economist'],
    tiposConteudo: ['tendencia', 'case', 'educativo', 'comparacao', 'lista', 'prova_social', 'oferta'],
    observacoes: '', pdfUploadedAt: null, updatedAt: null,
  },
  pessoal: {
    profileId: 'pessoal', tipo: 'pessoal', nome: 'Ana Moutinho',
    handle: '@analuisa.moutinho', niche: 'Marca pessoal, construção de vida intencional, estratégia pessoal',
    bio: 'Construindo a própria vida com intenção. Sem fórmulas, sem guru.',
    tom: 'Reflexivo, íntimo, direto, levemente provocativo. Nunca motivacional.',
    proibidos: ['Desbloqueie', 'Seja sua melhor versão', 'Transforme', 'Coach', 'Mentoria', 'Sucesso', 'Fórmula'],
    pilares: ['Construção pessoal', 'Estratégia de vida', 'Estética de vida real', 'Marca pessoal inteligente'],
    publicoAlvo: 'Mulheres 25-38 anos construindo identidade profissional e vida própria',
    cta: 'Salva pra reler quando esquecer disso. Me diz nos comentários se fez sentido.',
    referencias: ['Sofia Coppola', 'Lana Del Rey visual universe', 'Lo-fi diary aesthetic', 'Candid editorial'],
    tiposConteudo: ['lofi', 'carrossel', 'video_curto', 'video_medio', 'frase', 'dump', 'bastidores'],
    observacoes: 'Não é coach, não é guru.',
    pdfUploadedAt: null, updatedAt: null,
  },
  virttus: {
    profileId: 'virttus', tipo: 'corporativa', nome: 'Virttus',
    handle: '@virttus', niche: 'Tech B2B, transformação digital, precision software',
    bio: 'Tecnologia de precisão para empresas que não aceitam mediano.',
    tom: 'Técnico, forward-looking, preciso. B2B premium. Sem buzzwords vazios.',
    proibidos: ['Incrível', 'Revolucionário', 'Disruptivo', 'Mudando o jogo', 'Next-level'],
    pilares: ['Tecnologia e inovação', 'Casos de uso B2B', 'Data & Analytics', 'Transformação digital'],
    publicoAlvo: 'CTOs, gerentes de TI e diretores de operações em médias e grandes empresas',
    cta: 'Quer saber como aplicar isso? Nos chame no direct.',
    referencias: ['Bloomberg Businessweek', 'Wired', 'MIT Tech Review'],
    tiposConteudo: ['tendencia', 'case', 'educativo', 'comparacao', 'lista', 'oferta'],
    observacoes: '', pdfUploadedAt: null, updatedAt: null,
  },
};

function loadProfiles() {
  try {
    if (!fs.existsSync(PROFILES_FILE)) {
      fs.writeFileSync(PROFILES_FILE, JSON.stringify(DEFAULT_PROFILES, null, 2));
      return { ...DEFAULT_PROFILES };
    }
    const raw = JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf-8'));
    const merged = {};
    for (const key of Object.keys(DEFAULT_PROFILES)) {
      merged[key] = { ...DEFAULT_PROFILES[key], ...(raw[key] || {}) };
    }
    for (const key of Object.keys(raw)) {
      if (!merged[key]) merged[key] = raw[key];
    }
    return merged;
  } catch(e) {
    console.error('loadProfiles:', e.message);
    return { ...DEFAULT_PROFILES };
  }
}

function saveProfiles(profiles) {
  try { fs.writeFileSync(PROFILES_FILE, JSON.stringify(profiles, null, 2)); }
  catch(e) { console.error('saveProfiles:', e.message); }
}

function getProfileManualContext(profileId) {
  const profiles = loadProfiles();
  const p = profiles[profileId];
  if (!p) return '';
  return [
    `TIPO DE MARCA: ${p.tipo === 'pessoal' ? 'Marca Pessoal (Metodologia RR)' : 'Marca Corporativa (BrandsDecoded)'}`,
    p.niche        ? `NICHO: ${p.niche}`                      : '',
    p.publicoAlvo  ? `PÚBLICO-ALVO: ${p.publicoAlvo}`        : '',
    p.tom          ? `TOM DE VOZ: ${p.tom}`                   : '',
    p.pilares?.length    ? `PILARES DE CONTEÚDOM: ${p.pilares.join(', ')}` : '',
    p.proibidos?.length  ? `TERMOS PROIBIDOS: ${p.proibidos.join(', ')}` : '',
    p.cta          ? `CTA PADRÃO DO PERFIL: ${p.cta}`         : '',
    p.observacoes  ? `CONTEXTO ADICIONAL: ${p.observacoes}`   : '',
  ].filter(Boolean).join('\n');
}

app.get('/api/tipos-conteudo', (req, res) => {
  const { profile } = req.query;
  const { isRR, tipos } = getMetodologia(profile || 'marca');
  res.json({
    metodologia: isRR ? 'rr' : 'brandsdecoded',
    tipos: Object.values(tipos).map(t => ({
      id: t.id, emoji: t.emoji, label: t.label,
      categoria: t.categoria || (isRR ? 'Marca Pessoal' : 'Corporativo'),
      desc: t.instrucao?.split('.')[0] || '',
    })),
  });
});

app.get('/api/profiles', (req, res) => { res.json(loadProfiles()); });

app.get('/api/profiles/:id', (req, res) => {
  const p = loadProfiles()[req.params.id];
  if (!p) return res.status(404).json({ error: 'Perfil não encontrado' });
  res.json(p);
});

app.patch('/api/profiles/:id', (req, res) => {
  try {
    const profiles = loadProfiles();
    if (!profiles[req.params.id]) return res.status(404).json({ error: 'Perfil não encontrado' });
    profiles[req.params.id] = {
      ...profiles[req.params.id], ...req.body,
      profileId: req.params.id, updatedAt: new Date().toISOString(),
    };
    saveProfiles(profiles);
    res.json({ success: true, profile: profiles[req.params.id] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/profiles', (req, res) => {
  try {
    const profiles = loadProfiles();
    const id = req.body.profileId || `profile_${Date.now()}`;
    if (profiles[id]) return res.status(409).json({ error: 'ID já existe' });
    profiles[id] = { ...DEFAULT_PROFILES.marca, ...req.body, profileId: id, updatedAt: new Date().toISOString() };
    saveProfiles(profiles);
    res.json({ success: true, profile: profiles[id] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

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

// NOVO: atualiza imageUrls de um conteúdo já existente
function updateContentImages(id, imageUrls) {
  const all = readJSON(GENERATED_FILE);
  const idx = all.findIndex(i => i.id === id);
  if (idx !== -1) {
    all[idx].imageUrls = imageUrls;
    writeJSON(GENERATED_FILE, all);
  }
  if (supabase) {
    supabase.from('generated_content')
      .update({ image_urls: imageUrls })
      .eq('id', id)
      .then(({ error }) => { if (error) console.error('Supabase updateImages:', error.message); });
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
  marca:   { id: process.env.INSTAGRAM_ACCOUNT_ID_MARCA,   token: process.env.INSTAGRAM_TOKEN_MARCA   || process.env.INSTAGRAM_ACCESS_TOKEN, name: 'Case Aceleradora', handle: '@caseaceleradora'   },
  pessoal: { id: process.env.INSTAGRAM_ACCOUNT_ID_PESSOAL, token: process.env.INSTAGRAM_TOKEN_PESSOAL || process.env.INSTAGRAM_ACCESS_TOKEN, name: 'Ana Moutinho',     handle: '@analuisa.moutinho' },
  virttus: { id: process.env.INSTAGRAM_ACCOUNT_ID_VIRTTUS, token: process.env.INSTAGRAM_TOKEN_VIRTTUS || process.env.INSTAGRAM_ACCESS_TOKEN, name: 'Virttus',          handle: '@virttus'           },
};
function getAccount(profile) { return ACCOUNTS[profile] || ACCOUNTS.marca; }

function getManualText(profile) {
  const profileContext = getProfileManualContext(profile);
  const pdfPath = path.join(MANUALS_DIR, `${profile || 'marca'}.pdf`);
  const pdfNote = fs.existsSync(pdfPath)
    ? '[Manual PDF do cliente carregado — aplicar diretrizes visuais e de identidade do documento]'
    : '';
  return [profileContext, pdfNote].filter(Boolean).join('\n\n');
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
ESTÉTICA: real, crua, íntima, sofisticada, levemente granulada. Luz natural, fotos espontâneas.
PALETA: off-white/creme (#FAF8F5), preto suave, marrom café (#8B7355), rosa queimado (#C17B6F).
TOM: reflexivo, direto, levemente provocativo, íntimo, inteligente.
NUNCA: motivacional raso, tom de guru, coach, LinkedIn.`,
    copyDNA:`COPY PARA ANA MOUTINHO (Metodologia RR):
1. HOOK: afirmação provocativa que nomeia algo que a pessoa sente mas não sabe nomear.
2. ESTRUTURA: gancho (3 segundos) → história real → conclusão com tese clara.
3. TOM: íntimo e observador. Direto. PROIBIDO: "desbloqueie", "seja sua melhor versão", "sucesso".`,
  },
  virttus: {
    accent:'#00D4AA',accentAlt:'#7B2FFF',bgDark:'#050B18',bgLight:'#F0F4FF',bgBrand:'#0A1628',
    textOnDark:'#FFFFFF',textOnLight:'#050B18',handle:'@virttus',name:'Virttus',
    moods:['HERO_DARK','TYPE_DARK','EDITORIAL_LIGHT','HERO_DARK','TABLE_LIGHT','TYPE_DARK','EDITORIAL_LIGHT','BRAND_PUNCH','CTA_LIGHT'],
    aestheticDNA:`Tech B2B precision design. Sharp, forward-looking, data-driven.
TYPOGRAPHY: Geometric tech sans-serif, precise and clean, weight 700-900.
VISUALS: Abstract data visualizations, digital interfaces, circuit patterns.
NEVER: clipart, generic tech stock, cartoonish elements.`,
  
  },
};

// ── Manual upload ─────────────────────────────────────────────────────────
app.post('/api/manual/upload', upload.single('pdf'), (req, res) => {
  const { profile } = req.body;
  if (!req.file) return res.status(400).json({ error: 'Nenhum ficheiro enviado' });
  const dest = path.join(MANUALS_DIR, `${profile || 'marca'}.pdf`);
  fs.renameSync(req.file.path, dest);
  const profiles = loadProfiles();
  if (profiles[profile]) {
    profiles[profile].pdfUploadedAt = new Date().toISOString();(profiles);
  }
  res.json({ success: true, message: `Manual do perfil "${profile}" guardado.` });
});

// ── Banco de fotos ────────────────────────────────────────────────────────
// Persistência: Supabase Storage (bucket 'photos') + tabela 'photos_meta'
// Fallback: disco local /tmp/photos (Railway efêmero — apenas durante sessão)

const PHOTOS_FILE = path.join(DATA_DIR, 'photos_meta.json');
const PHOTOS_DIR  = path.join(DATA_DIR, 'photos');
try { fs.mkdirSync(PHOTOS_DIR, { recursive: true }); } catch(e) {}
if (!fs.existsSync(PHOTOS_FILE)) fs.writeFileSync(PHOTOS_FILE, '[]');

// Salva foto no Supabase Storage e retorna URL pública
async function savePhotoToStorage(buffer, filename, mimetype) {
  if (supabase) {
    try {
      const { error } = await supabase.storage
        .from('photos')
        .upload(filename, buffer, { contentType: mimetype || 'image/jpeg', upsert: true });
      if (!error) {
        const { data } = supabase.storage.from('photos').getPublicUrl(filename);
        if (data?.publicUrl) return { url: data.publicUrl, storage: 'supabase' };
      }
    } catch(e) { console.warn('[photos] Supabase Storage:', e.message); }
  }
  // Fallback: disco local
  const fp = path.join(PHOTOS_DIR, filename);
  fs.writeFileSync(fp, buffer);
  return { url: null, storage: 'local' };
}

// Lê metadados das fotos — Supabase primeiro, fallback JSON local
async function loadPhotosMeta(profile) {
  if (supabase) {
    try {
      let q = supabase.from('photos_meta').select('*').order('uploaded_at', { ascending: false });
      if (profile) q = q.eq('profile', profile);
      const { data, error } = await q;
      if (!error && data?.length) return data.map(r => ({
        id: r.id, profile: r.profile, filename: r.filename,
        originalName: r.original_name, tags: r.tags || [],
        description: r.description || '', uploadedAt: r.uploaded_at,
        publicUrl: r.public_url || null,
      }));
    } catch(e) { console.warn('[photos] loadPhotosMeta Supabase:', e.message); }
  }
  const all = readJSON(PHOTOS_FILE);
  return profile ? all.filter(p => p.profile === profile) : all;
}

async function savePhotoMeta(meta) {
  // Salva local
  const all = readJSON(PHOTOS_FILE);
  all.unshift(meta);
  writeJSON(PHOTOS_FILE, all);
  // Salva no Supabase
  if (supabase) {
    supabase.from('photos_meta').upsert({
      id: meta.id, profile: meta.profile, filename: meta.filename,
      original_name: meta.originalName, tags: meta.tags || [],
      description: meta.description || '', uploaded_at: meta.uploadedAt,
      public_url: meta.publicUrl || null,
      data_url: meta.dataUrl || null,
    }, { onConflict: 'id' }).then(({ error }) => {
      if (error) console.error('[photos] upsert:', error.message);
    });
  }
}

const photoUpload = multer({
  dest: 'uploads/photos/',
  fileFilter: (req, file, cb) => { if (file.mimetype.startsWith('image/')) cb(null, true); else cb(new Error('Apenas imagens')); },
  limits: { fileSize: 20 * 1024 * 1024 },
});

app.post('/api/photos/upload', photoUpload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhum ficheiro' });
    const { profile = 'pessoal', tags = '', description = '' } = req.body;
    const ext      = path.extname(req.file.originalname) || '.jpg';
    const id       = 'photo_' + Date.now();
    const filename = id + ext;
    const buffer   = fs.readFileSync(req.file.path);
    const b64      = buffer.toString('base64');
    const dataUrl  = 'data:' + (req.file.mimetype || 'image/jpeg') + ';base64,' + b64;

    // Tenta salvar no Supabase Storage
    const { url: publicUrl, storage } = await savePhotoToStorage(buffer, filename, req.file.mimetype);

    // Limpa arquivo temporário
    try { fs.unlinkSync(req.file.path); } catch(e) {}

    const meta = {
      id, profile, filename, originalName: req.file.originalname,
      tags: tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      description, uploadedAt: new Date().toISOString(),
      publicUrl, dataUrl,
    };
    await savePhotoMeta(meta);
    res.json({ success: true, photo: meta, storage });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/photos', async (req, res) => {
  try {
    const { profile, tag } = req.query;
    let all = await loadPhotosMeta(profile);
    if (tag) all = all.filter(p => (p.tags || []).includes(tag));
    // Não retorna dataUrl na listagem (pesado)
    res.json(all.map(({ dataUrl, ...rest }) => rest));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/photos/suggest', async (req, res) => {
  try {
    const { topic, profile = 'pessoal', limit = 3 } = req.body;
    const all = await loadPhotosMeta(profile);
    if (!all.length) return res.json({ suggestions: [] });
    const photoList = all.map(p => 'ID: ' + p.id + ' | Tags: ' + (p.tags || []).join(', ') + ' | Descrição: ' + (p.description || '')).join('\n');
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 512, messages: [{ role: 'user', content: 'Tema: "' + topic + '"\nFotos:\n' + photoList + '\nSeleciona até ' + limit + ' IDs. JSON: {"suggestions":["id1"]}' }] }),
    });
    const d = await r.json();
    const match  = d.content[0].text.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) : { suggestions: [] };
    // Para cada ID sugerido, busca com dataUrl
    const allFull = await Promise.all(parsed.suggestions.slice(0, limit).map(async id => {
      // Tenta Supabase
      if (supabase) {
        const { data } = await supabase.from('photos_meta').select('*').eq('id', id).single();
        if (data) return { ...data, tags: data.tags || [], description: data.description || '', dataUrl: data.data_url };
      }
      return readJSON(PHOTOS_FILE).find(p => p.id === id);
    }));
    res.json({ suggestions: allFull.filter(Boolean) });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/photos/:id', async (req, res) => {
  try {
    if (supabase) {
      const { data, error } = await supabase.from('photos_meta').select('*').eq('id', req.params.id).single();
      if (!error && data) return res.json({ ...data, tags: data.tags || [], dataUrl: data.data_url });
    }
    const photo = readJSON(PHOTOS_FILE).find(p => p.id === req.params.id);
    if (!photo) return res.status(404).json({ error: 'Não encontrada' });
    res.json(photo);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/photos/:id', async (req, res) => {
  try {
    if (supabase) {
      const { data } = await supabase.from('photos_meta').select('filename').eq('id', req.params.id).single();
      if (data?.filename) {
        await supabase.storage.from('photos').remove([data.filename]);
        await supabase.from('photos_meta').delete().eq('id', req.params.id);
      }
    }
    const all   = readJSON(PHOTOS_FILE);
    const photo = all.find(p => p.id === req.params.id);
    if (photo) {
      const fp = path.join(PHOTOS_DIR, photo.filename);
      if (fs.existsSync(fp)) try { fs.unlinkSync(fp); } catch(e) {}
      writeJSON(PHOTOS_FILE, all.filter(p => p.id !== req.params.id));
    }
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── Google Photos ─────────────────────────────────────────────────────────
// Tokens persistidos no Supabase (tabela oauth_tokens) — não somem no Railway

async function loadGPhotoTokens() {
  if (supabase) {
    try {
      const { data, error } = await supabase.from('oauth_tokens').select('*').eq('service', 'gphotos');
      if (!error && data?.length) {
        const result = {};
        data.forEach(r => { result[r.user_id] = { access_token: r.access_token, refresh_token: r.refresh_token, expires_at: r.expires_at ? new Date(r.expires_at).getTime() : 0, connected_at: r.connected_at }; });
        return result;
      }
    } catch(e) { console.warn('[gphotos] loadTokens Supabase:', e.message); }
  }
  // Fallback local
  try {
    const fp = path.join(DATA_DIR, 'gphotos_tokens.json');
    if (!fs.existsSync(fp)) return {};
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch(e) { return {}; }
}

async function saveGPhotoToken(userId, tokenData) {
  // Salva local
  try {
    const fp = path.join(DATA_DIR, 'gphotos_tokens.json');
    const all = (() => { try { return JSON.parse(fs.readFileSync(fp,'utf8')); } catch(e) { return {}; } })();
    all[userId] = tokenData;
    fs.writeFileSync(fp, JSON.stringify(all, null, 2));
  } catch(e) {}
  // Salva no Supabase
  if (supabase) {
    try {
      await supabase.from('oauth_tokens').upsert({
        user_id: userId, service: 'gphotos',
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: tokenData.expires_at ? new Date(tokenData.expires_at).toISOString() : null,
        connected_at: tokenData.connected_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,service' });
    } catch(e) { console.warn('[gphotos] saveToken Supabase:', e.message); }
  }
}

async function deleteGPhotoToken(userId) {
  try {
    const fp = path.join(DATA_DIR, 'gphotos_tokens.json');
    const all = (() => { try { return JSON.parse(fs.readFileSync(fp,'utf8')); } catch(e) { return {}; } })();
    delete all[userId];
    fs.writeFileSync(fp, JSON.stringify(all, null, 2));
  } catch(e) {}
  if (supabase) {
    try { await supabase.from('oauth_tokens').delete().eq('user_id', userId).eq('service', 'gphotos'); } catch(e) {}
  }
}

async function refreshGPhotoToken(userId) {
  const tokens = await loadGPhotoTokens();
  const userTokens = tokens[userId];
  if (!userTokens?.refresh_token) return null;
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, refresh_token: userTokens.refresh_token, grant_type: 'refresh_token' }).toString()
    });
    const d = await r.json();
    if (d.access_token) {
      const updated = { ...userTokens, access_token: d.access_token, expires_at: Date.now() + (d.expires_in * 1000) };
      await saveGPhotoToken(userId, updated);
      return d.access_token;
    }
    console.warn('[gphotos] refresh falhou:', JSON.stringify(d));
    return null;
  } catch(e) { console.error('[gphotos] refresh error:', e.message); return null; }
}

async function getGPhotoAccessToken(userId) {
  const tokens = await loadGPhotoTokens();
  const t = tokens[userId];
  if (!t) return null;
  if (t.expires_at && Date.now() < t.expires_at - 60000) return t.access_token;
  return await refreshGPhotoToken(userId);
}

app.get('/api/gphotos/auth', (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return res.status(500).json({ error: 'GOOGLE_CLIENT_ID não configurado' });
  const redirectUri = (process.env.PUBLIC_URL || '').replace(/\/$/, '') + '/api/gphotos/callback';
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'https://www.googleapis.com/auth/photoslibrary.readonly', access_type: 'offline', prompt: 'consent', state: req.query.userId || 'default' });
  res.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + params.toString());
});

app.get('/api/gphotos/callback', async (req, res) => {
  const { code, state: userId } = req.query;
  if (!code) return res.redirect('/?gphotos_error=no_code');
  const redirectUri = (process.env.PUBLIC_URL || '').replace(/\/$/, '') + '/api/gphotos/callback';
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, code, redirect_uri: redirectUri, grant_type: 'authorization_code' }).toString()
    });
    const d = await r.json();
    if (!d.access_token) { console.error('[gphotos] callback error:', JSON.stringify(d)); throw new Error(d.error_description || JSON.stringify(d)); }
    await saveGPhotoToken(userId || 'default', { access_token: d.access_token, refresh_token: d.refresh_token || null, expires_at: Date.now() + ((d.expires_in || 3600) * 1000), connected_at: new Date().toISOString() });
    res.redirect('/?gphotos_connected=1');
  } catch(e) { res.redirect('/?gphotos_error=' + encodeURIComponent(e.message)); }
});

app.get('/api/gphotos/status', async (req, res) => {
  const userId = req.query.userId || 'default';
  const tokens = await loadGPhotoTokens();
  const t = tokens[userId];
  res.json({ connected: !!t, connectedAt: t?.connected_at || null, hasRefreshToken: !!(t?.refresh_token) });
});

app.delete('/api/gphotos/disconnect', async (req, res) => {
  const userId = req.query.userId || 'default';
  await deleteGPhotoToken(userId);
  res.json({ success: true });
});

app.get('/api/gphotos/albums', async (req, res) => {
  const userId = req.query.userId || 'default';
  const accessToken = await getGPhotoAccessToken(userId);
  if (!accessToken) return res.status(401).json({ error: 'Não autenticado. Conecte o Google Fotos primeiro.' });
  try {
    const r = await fetch('https://photoslibrary.googleapis.com/v1/albums?pageSize=50', { headers: { 'Authorization': 'Bearer ' + accessToken } });
    const d = await r.json();
    if (d.error) return res.status(400).json({ error: d.error.message });
    res.json({ albums: d.albums || [] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/gphotos/suggest', async (req, res) => {
  const { tema, slideIndex, totalSlides, userId = 'default', albumId, limit = 5 } = req.body;
  const accessToken = await getGPhotoAccessToken(userId);
  if (!accessToken) return res.status(401).json({ error: 'Não autenticado. Conecte o Google Fotos primeiro.' });
  try {
    let photosUrl = 'https://photoslibrary.googleapis.com/v1/mediaItems?pageSize=100';
    let fetchOptions = { headers: { 'Authorization': 'Bearer ' + accessToken } };
    if (albumId) {
      photosUrl = 'https://photoslibrary.googleapis.com/v1/mediaItems:search';
      fetchOptions = { method: 'POST', headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ albumId, pageSize: 100 }) };
    }
    const r = await fetch(photosUrl, fetchOptions);
    const d = await r.json();
    if (d.error) return res.status(400).json({ error: d.error.message });
    const items = d.mediaItems || [];
    if (!items.length) return res.json({ suggestions: [], message: 'Nenhuma foto encontrada' });
    const photoList = items.slice(0, 50).map((p, i) => (i+1) + '. ID:' + p.id + ' | ' + (p.filename||'') + ' | ' + (p.description||'')).join('\n');
    const aiPrompt = 'Tema: "' + tema + '"\nSlide ' + (slideIndex+1) + ' de ' + totalSlides + '\n\nFotos:\n' + photoList + '\n\nSeleciona ' + limit + ' IDs mais adequados. JSON: {"ids":["id1","id2"]}';
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 256, messages: [{ role: 'user', content: aiPrompt }] }) });
    const aiData = await aiRes.json();
    const aiTxt = aiData.content?.[0]?.text?.trim() || '{"ids":[]}';
    const m = aiTxt.match(/\{[\s\S]*\}/);
    const parsed = m ? JSON.parse(m[0]) : { ids: [] };
    const selected = (parsed.ids || []).slice(0, limit).map(id => {
      const item = items.find(p => p.id === id);
      if (!item) return null;
      return { id: item.id, filename: item.filename, description: item.description || '', previewUrl: item.baseUrl + '=w1200', slideUrl: item.baseUrl + '=w1024-h1365-c' };
    }).filter(Boolean);
    res.json({ suggestions: selected, total: items.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/gphotos/photo/:id', async (req, res) => {
  const userId = req.query.userId || 'default';
  const accessToken = await getGPhotoAccessToken(userId);
  if (!accessToken) return res.status(401).json({ error: 'Não autenticado' });
  try {
    const r = await fetch('https://photoslibrary.googleapis.com/v1/mediaItems/' + req.params.id, { headers: { 'Authorization': 'Bearer ' + accessToken } });
    const d = await r.json();
    if (!d.baseUrl) return res.status(404).json({ error: 'Foto não encontrada' });
    res.json({ id: d.id, previewUrl: d.baseUrl + '=w800', slideUrl: d.baseUrl + '=w1024-h1365-c', filename: d.filename, description: d.description || '' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.use(express.static('public'));
app.use('/api', (req, res) => { res.status(404).json({ error: `Rota não encontrada: ${req.method} ${req.originalUrl}` }); });
app.get('*', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });
app.listen(PORT, () => {
  console.log(`🚀 Máquina de Conteúdo na porta ${PORT} | quality default: ${DEFAULT_QUALITY} | valid: ${VALID_QUALITIES.join(', ')}`);
  checkSupabaseTables();
});
