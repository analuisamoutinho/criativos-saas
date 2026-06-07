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
    console.log('✅ Supabase conectado — dados persistentes entre deploys');
  } else {
    console.log('');
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║  ⚠️  AVISO: Supabase não configurado                         ║');
    console.log('║  Os dados (biblioteca, calendário, posts) serão apagados     ║');
    console.log('║  a cada novo deploy no Railway.                              ║');
    console.log('║                                                              ║');
    console.log('║  Para persistência, define no Railway:                       ║');
    console.log('║    SUPABASE_URL       → Project URL do Supabase              ║');
    console.log('║    SUPABASE_SERVICE_KEY → service_role key do Supabase       ║');
    console.log('║                                                              ║');
    console.log('║  Schema das tabelas: supabase-schema.sql                     ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('');
  }
} catch(e) {
  console.log('⚠️  Supabase não instalado — usando ficheiros locais');
}

// Verificar tabelas do Supabase no arranque
async function checkSupabaseTables() {
  if (!supabase) return;
  try {
    const { error: e1 } = await supabase.from('generated_content').select('id').limit(1);
    const { error: e2 } = await supabase.from('calendars').select('id').limit(1);
    if (e1 || e2) {
      console.log('');
      console.log('╔══════════════════════════════════════════════════════════════╗');
      console.log('║  ❌  Tabelas do Supabase não encontradas                     ║');
      console.log('║  Corre o ficheiro supabase-schema.sql no Supabase Dashboard  ║');
      console.log('║  SQL Editor → colar o conteúdo → Run                        ║');
      console.log('╚══════════════════════════════════════════════════════════════╝');
      console.log('');
    } else {
      console.log('✅ Tabelas Supabase verificadas — biblioteca e calendário persistentes');
    }
  } catch(e) {
    console.warn('Aviso ao verificar tabelas Supabase:', e.message);
  }
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
// METODOLOGIAS DE CONTEÚDO
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
ESTRUTURA DE CONTEÚDO VIRAL (3 pilares obrigatórios):
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
  lofi: {
    id: 'lofi', emoji: '🎥', label: 'Lo-Fi (câmera ligada)',
    instrucao: 'Script para vídeo lo-fi direto ao ponto. Gancho nos primeiros 3 segundos, história que sustenta, conclusão com tese clara.',
  },
  carrossel: {
    id: 'carrossel', emoji: '📋', label: 'Carrossel',
    instrucao: 'Slide 1: gancho provocativo que nomeia dor ou desejo. Slides do meio: profundidade real. Slide final: conclusão + CTA leve e íntimo.',
  },
  video_curto: {
    id: 'video_curto', emoji: '⚡', label: 'Vídeo Curto (até 13s)',
    instrucao: 'Uma única sacada impactante. Sem introdução. Direto ao ponto e corte.',
  },
  video_medio: {
    id: 'video_medio', emoji: '🎬', label: 'Vídeo Médio (até 1min)',
    instrucao: 'Gancho (0-5s) → desenvolvimento que conecta (5-50s) → conclusão com tese (50-60s).',
  },
  frase: {
    id: 'frase', emoji: '✍️', label: 'Frase de Impacto',
    instrucao: 'Uma verdade concentrada em 2-3 linhas. Sem explicação — a frase precisa ressoar sozinha.',
  },
  dump: {
    id: 'dump', emoji: '📸', label: 'Dump / Bastidores',
    instrucao: 'Momentos reais com narrativa. Humaniza, cria relacionamento.',
  },
  bastidores: {
    id: 'bastidores', emoji: '🎬', label: 'Bastidores',
    instrucao: 'Mostra o processo real, não o resultado polido. O que acontece antes, durante, os erros, as decisões.',
  },
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
  tendencia: {
    id: 'tendencia', emoji: '📡', label: 'Análise de Tendência', categoria: 'Awareness',
    instrucao: 'Capa nomeia o fenômeno como declaração. Desenvolvimento: por que acontece, implicações estratégicas, o que muda.',
  },
  case: {
    id: 'case', emoji: '🏆', label: 'Case de Sucesso', categoria: 'Awareness',
    instrucao: 'Capa como fenômeno cultural. Contexto de mercado. Ponto de virada decisivo. Resultados mensuráveis.',
  },
  educativo: {
    id: 'educativo', emoji: '📚', label: 'Educativo / Framework', categoria: 'Autoridade',
    instrucao: 'Capa promete método com nome próprio. Um passo por slide, com exemplo concreto em cada.',
  },
  comparacao: {
    id: 'comparacao', emoji: '⚖️', label: 'Comparação / Antes & Depois', categoria: 'Alcance',
    instrucao: 'Capa ativa contraste com dado ou afirmação. Lado A detalhado. Virada com análise. Lado B com resultado.',
  },
  lista: {
    id: 'lista', emoji: '📋', label: 'Lista Valiosa', categoria: 'Alcance',
    instrucao: 'Capa com número e promessa específica. Um item por slide com profundidade real.',
  },
  prova_social: {
    id: 'prova_social', emoji: '🌟', label: 'Prova Social', categoria: 'Conversão',
    instrucao: 'Capa foca no resultado concreto. Antes com contexto real. Processo decisivo. Números e métricas.',
  },
  oferta: {
    id: 'oferta', emoji: '🎯', label: 'Oferta', categoria: 'Conversão',
    instrucao: 'Capa ativa desejo, não produto. Problema real. Solução única. Para quem é. Prova de valor. CTA específico.',
  },
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
    return `Você é o gerador de conteúdo da ${account.name} — marca pessoal seguindo a Metodologia RR (Sistema de Conteúdo Viral).

${METODOLOGIA_RR.filosofia}
${METODOLOGIA_RR.estruturaViral}
${brand.copyDNA || ''}
${manualNote ? `\nDIRETRIZES DO PERFIL:\n${manualNote}` : ''}

REGRAS OBRIGATÓRIAS:
- Retornar APENAS JSON válido, sem markdown
- NUNCA usar travessão (—) nem hífen no meio de frases
- NUNCA usar: ${METODOLOGIA_RR.tonsProibidos.join(', ')}
- Máximo 4 hashtags na legenda (nunca mais do que isso)
- Hashtags específicas ao nicho, não genéricas
- Tom: ${METODOLOGIA_RR.tonsPermitidos.join(', ')}
- CTA: íntimo e leve — nunca comercial forçado`;
  }

  return `Você é o gerador de carrosseis da BrandsDecoded — padrão mais alto de copy corporativa para Instagram.

${METODOLOGIA_BRANDSDECODED.filosofia}
${METODOLOGIA_BRANDSDECODED.estrutura}
${manualNote ? `\nDIRETRIZES DO PERFIL:\n${manualNote}` : ''}

REGRAS OBRIGATÓRIAS:
- Slide 1: hook de 14-18 palavras, afirmação provocativa que nomeia fenômeno real
- NUNCA usar travessão (—) nem hífen no meio de frases
- NUNCA usar: ${METODOLOGIA_BRANDSDECODED.tonsProibidos.join(', ')}
- Máximo 4 hashtags na legenda
- Hashtags específicas ao nicho
- ASSINATURA FIXA no último slide: "Gostou desse conteúdo? Aproveite para seguir nosso perfil. E caso queira saber sobre o nosso acompanhamento, comente 'CASE' que nossa equipe te chama."
- Retornar APENAS JSON válido, sem markdown`;
}

function buildSystemPromptContentMachine(profile, tipo, metodologia, isRR) {
  const brand   = BRAND_IDENTITIES[profile] || BRAND_IDENTITIES.marca;
  const account = getAccount(profile);
  const manualNote = getManualText(profile);

  if (isRR) {
    const tipoInfo = TIPOS_RR[tipo] || TIPOS_RR.carrossel;
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
- CTA FIXO (último texto): "${account.handle === '@analuisa.moutinho' ? 'salva pra reler quando esquecer disso. e me diz nos comentários se isso fez sentido pra você.' : 'salva esse conteúdo e me conta nos comentários o que mais fez sentido pra você.'}"
- Retornar APENAS JSON válido, sem markdown`;
  }

  const tipoInfo = TIPOS_BRANDSDECODED[tipo] || TIPOS_BRANDSDECODED.educativo;
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
- Retornar APENAS JSON válido, sem markdown`;
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
    observacoes: 'Não é coach, não é guru. É uma mulher que observa o mundo de jeito diferente.',
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
    p.pilares?.length    ? `PILARES DE CONTEÚDO: ${p.pilares.join(', ')}`       : '',
    p.proibidos?.length  ? `TERMOS PROIBIDOS (nunca usar): ${p.proibidos.join(', ')}` : '',
    p.cta          ? `CTA PADRÃO DO PERFIL: ${p.cta}`         : '',
    p.observacoes  ? `CONTEXTO ADICIONAL: ${p.observacoes}`   : '',
  ].filter(Boolean).join('\n');
}

// ── Endpoint: listar tipos por metodologia ────────────────────────────────
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
3. TOM: íntimo e observador. Direto. PROIBIDO: "desbloqueie", "seja sua melhor versão", "sucesso".
4. PROFUNDIDADE > BREVIDADE: conteúdo que conecta de verdade vale mais que 10 superficiais.
5. AUTENTICIDADE: pessoas conectam com pessoas, não com personagens.`,
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
    profiles[profile].pdfUploadedAt = new Date().toISOString();
    saveProfiles(profiles);
  }
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
    const { isRR }   = getMetodologia(profile);
    const metaInfo   = isRR ? METODOLOGIA_RR.filosofia : METODOLOGIA_BRANDSDECODED.filosofia;
    const systemMsg  = `Você é especialista em marketing digital e criação de conteúdo para Instagram.
Responda sempre em português do Brasil.
${metaInfo}
${brand.aestheticDNA ? `\n## Identidade da marca\n${brand.aestheticDNA}` : ''}
${brand.copyDNA ? `\n## Diretrizes de copy\n${brand.copyDNA}` : ''}
${manualNote ? `\n## Manual do perfil\n${manualNote}` : ''}
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

app.post('/api/image/carousel-slide', async (req, res) => {
  try {
    const {
      heading = '', body = '',
      slideNumber = 1, totalSlides = 9,
      funcao = '', topic = '',
      profile = 'marca',
      imagePromptHint = '',
      designStyleHint = '',
      contentId = null
    } = req.body;

    const brand = BRAND_IDENTITIES[profile] || BRAND_IDENTITIES.marca;
    const isAna = profile === 'pessoal';
    const mood  = brand.moods[Math.min(slideNumber - 1, brand.moods.length - 1)];

    const h = heading.replace(/"/g, "'").replace(/—/g, '-').replace(/–/g, '-').trim();
    const b = body.replace(/"/g, "'").replace(/—/g, '-').replace(/–/g, '-').trim().slice(0, 180);

    const needsPhoto = ['HERO_DARK','HERO_LOFI','COLAGEM_REAL','SPLIT_LIGHT','EDITORIAL_LIGHT','DIARIO_EDITORIAL'].includes(mood);

    let artDirection = imagePromptHint || '';

    if (needsPhoto) {
      const visualDNA = isAna
        ? `VISUAL DNA — Ana Moutinho "Ana mais real" (Lo-Fi, autêntico, real):
Aesthetic: lo-fi diary, intimate, real. Not polished, not corporate.
Feel: like a photo from her iPhone, warm grain, honest moment.
References: Sofia Coppola films, Lana Del Rey visuals, candid editorial.
Avoid: studio lighting, stock photo feel, fake smiles, perfect setup.`
        : profile === 'virttus'
        ? `VISUAL DNA — Virttus tech B2B precision, forward-looking, sharp.
References: Bloomberg Businessweek, Wired magazine. Clean architecture, digital abstraction.
Avoid: generic tech stock, blue gradients, cliché office scenes.`
        : `VISUAL DNA — Case Aceleradora premium B2B editorial (BrandsDecoded).
References: Monocle, FT Weekend, Harvard Business Review covers.
Aesthetic: quiet luxury, strategic intelligence, executive authority.
Avoid: startup hustle, motivational clichés, busy distracting backgrounds.`;

      const slideCtx = funcao === 'CAPA' || slideNumber === 1
        ? 'COVER SLIDE — maximum cinematic impact, strong single focal point, hero image quality.'
        : funcao === 'CTA' || slideNumber === totalSlides
        ? 'CLOSING SLIDE — warmer, intimate feel, invites connection.'
        : `Slide ${slideNumber}/${totalSlides} — clean, uncluttered supporting visual.`;

      const styleLayer = designStyleHint
        ? `\nSELECTED VISUAL STYLE (highest priority): ${designStyleHint}`
        : '';

      const artPrompt = `You are a world-class art director for premium Instagram editorial content.

${visualDNA}${styleLayer}

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
          headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 280, messages: [{ role: 'user', content: artPrompt }] }),
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

    const imgRes = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-image-1', prompt: photoPrompt, n: 1, size: '1024x1536', quality: 'high' }),
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

    res.json({
      url: urlOut, b64: b64out, mood, artDirection,
      designMeta: {
        heading: h, body: b,
        accent: brand.accent, accentAlt: brand.accentAlt || '#FFFFFF',
        bgDark: brand.bgDark, bgLight: brand.bgLight,
        handle: brand.handle, isDark: ['HERO_DARK','HERO_LOFI','TYPE_DARK','TYPE_DARK_WARM','BRAND_PUNCH','VIRADA','FRASE_IMPACTO','CTA_INTIMO'].includes(mood),
        mood, slideNumber, totalSlides, funcao,
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
    const { isRR, tipos } = getMetodologia(profile);
    const manualNote  = getManualText(profile);
    const account     = getAccount(profile);
    const daysInMonth = new Date(year, month, 0).getDate();

    const tiposDisponiveis = Object.values(tipos).map(t => t.id).join(' | ');
    const tiposLabels = Object.values(tipos).map(t => `${t.id} (${t.label})`).join(', ');

    const BLOCK = 10;
    const allDays = [];

    for (let blockStart = 1; blockStart <= daysInMonth; blockStart += BLOCK) {
      const blockEnd    = Math.min(blockStart + BLOCK - 1, daysInMonth);
      const daysInBlock = blockEnd - blockStart + 1;

      const brandContext = isRR
        ? `PERFIL: ${account.name} (${account.handle}) — MARCA PESSOAL, Metodologia RR.
FILOSOFIA: conteúdo como transformação, autenticidade, profundidade > brevidade.
FORMATOS RR: lofi (câmera ligada), carrossel, video_curto, video_medio, frase, dump, bastidores.`
        : `PERFIL: ${account.name} (${account.handle}) — MARCA CORPORATIVA, BrandsDecoded.
TIPOS: ${tiposLabels}`;

      const examplePosts = postsPerDay === 1
        ? isRR
          ? `[{"time":"09:00","type":"lofi","topic":"Por que a maioria das pessoas sabota o próprio crescimento quando começa a dar certo"}]`
          : `[{"time":"09:00","type":"educativo","topic":"Por que 90% das empresas falham no onboarding de clientes"}]`
        : isRR
          ? `[{"time":"09:00","type":"carrossel","topic":"A mentira que o Instagram vende sobre consistência"},{"time":"18:00","type":"frase","topic":"Você não precisa de motivação, precisa de estrutura"}]`
          : `[{"time":"09:00","type":"educativo","topic":"Por que 90% das empresas falham no onboarding"},{"time":"18:00","type":"tendencia","topic":"O novo comportamento do consumidor pós-IA em 2026"}]`;

      const blockPrompt = `Você é estrategista de conteúdo para Instagram. Crie o calendário editorial para ${account.name} — ${month}/${year}.

${brandContext}
${manualNote ? `DIRETRIZES DO PERFIL:\n${manualNote}` : ''}

TIPOS DISPONÍVEIS: ${tiposDisponiveis}

REGRAS DO TOPIC (CRÍTICO):
Topics devem ser específicos com ângulo único — não genéricos como "dicas de marketing".

HORÁRIOS: use 09:00 para manhã e 18:00 para tarde/noite.

RESPONDA APENAS COM JSON VÁLIDO, SEM MARKDOWN, SEM TEXTO ANTES OU DEPOIS.

Formato EXATO:
{
  "days": [
    {"day": ${blockStart}, "posts": ${examplePosts}}
  ]
}

Gere TODOS os dias de ${blockStart} a ${blockEnd} (total: ${daysInBlock} dias, ${postsPerDay} post(s) por dia).`;

      console.log(`[Calendar] Gerando bloco dias ${blockStart}–${blockEnd} para ${profile}/${month}/${year}`);

      const blockRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 4000, messages: [{ role: 'user', content: blockPrompt }] }),
      });

      const blockData = await blockRes.json();
      if (blockData.error) throw new Error(`Claude API: ${blockData.error.message}`);

      const rawText = blockData.content[0].text.trim();
      let blockDays = [];
      try {
        const parsed = extractJSON(rawText);
        blockDays    = normalizeDays(parsed);
        if (blockDays.length > 0) console.log(`[Calendar] Bloco ${blockStart}–${blockEnd}: ${blockDays.length} dias`);
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
          const type  = post.type || post.tipo || (isRR ? 'carrossel' : 'educativo');
          const time  = post.time || post.horario || '09:00';
          const match = generated.find(g => g.calendarDay === dayNum && g.calendarMonth === month && g.calendarYear === year);
          return { time, type, topic, date: `${year}-${String(month).padStart(2,'0')}-${String(dayNum).padStart(2,'0')}`, contentId: match?.id || null, status: match?.status || 'pendente', scheduledAt: match?.scheduledAt || null };
        }),
      };
    });

    const totalPosts = calendarDays.reduce((acc, d) => acc + d.posts.length, 0);
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

// Actualizar calendário salvo (edições de posts individuais)
app.patch('/api/calendar/saved', async (req, res) => {
  try {
    const { profile, month, year, calendar } = req.body;
    if (!profile || !month || !year || !calendar) return res.status(400).json({ error: 'Faltam campos.' });
    writeJSON(CALENDAR_FILE, { profile, month, year, calendar, savedAt: new Date().toISOString() });
    if (supabase) {
      await supabase.from('calendars').upsert({
        id: `${profile}_${year}_${month}`, profile,
        month: parseInt(month), year: parseInt(year),
        data: JSON.stringify(calendar), updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });
    }
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
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
    const { isRR, metodologia } = getMetodologia(profile);
    const account = getAccount(profile);
    const mode    = blocks ? 'blocks' : 'topic';

    const systemPrompt = buildSystemPromptCarrossel(profile, metodologia, isRR);

    let prompt;
    if (mode === 'blocks') {
      prompt = `Perfil: ${account.name} (${account.handle})
Converte estes blocos em slides (1 bloco = 1 slide):
${blocks}
JSON: {"title":"...","slideCount":N,"slides":[{"slideNumber":1,"heading":"...","body":"...","imagePrompt":"scene in english"}],"caption":"legenda com emojis e CTA","hashtags":"máximo 4 hashtags específicas"}`;
    } else {
      const slideCount = isRR ? '7-8' : '10';
      prompt = `Perfil: ${account.name} (${account.handle})
Tema: "${topic}"
Total: ${slideCount} slides.
${isRR ? 'ESTRUTURA RR: Slide 1 (gancho que nomeia dor/desejo real) → slides de profundidade → conclusão com tese → CTA íntimo.' : 'ESTRUTURA BRANDSDECODED: Slide 1 (hook 14-18 palavras) → desenvolvimento estratégico → CTA com assinatura.'}
JSON: {"title":"...","slideCount":${isRR ? 8 : 10},"slides":[{"slideNumber":1,"heading":"gancho","body":"","imagePrompt":"scene in english"}],"caption":"legenda completa com emojis e CTA","hashtags":"máximo 4 hashtags específicas ao nicho"}`;
    }

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 8192, system: systemPrompt, messages: [{ role: 'user', content: prompt }] }),
    });
    const d = await r.json();
    if (d.error) return res.status(500).json({ error: d.error.message });

    const carouselData = extractJSON(d.content[0].text.trim());

    function sanitizeCopy(text) {
      if (!text) return text;
      return text
        .replace(/\s*—\s*/g, ' ')
        .replace(/\s*–\s*/g, ' ')
        .replace(/^\s*[–—]\s*/gm, '')
        .trim();
    }
    if (carouselData.slides) {
      carouselData.slides = carouselData.slides.map(s => ({
        ...s, heading: sanitizeCopy(s.heading), body: sanitizeCopy(s.body),
      }));
    }
    if (carouselData.hashtags) {
      const tags = carouselData.hashtags.match(/#\w+/g) || [];
      carouselData.hashtags = tags.slice(0, 4).join(' ');
    }

    const item = saveGeneratedContent({
      id: `cnt_${Date.now()}`, createdAt: new Date().toISOString(), status: 'pendente',
      type: 'carrossel', mode, profile,
      topic: topic || `Carrossel ${carouselData.slideCount} slides`,
      caption: caption || carouselData.caption, hashtags: hashtags || carouselData.hashtags,
      contentMachineType: contentMachineType || null, carouselData,
      calendarDay: calendarDay || null, calendarMonth: calendarMonth || null, calendarYear: calendarYear || null,
      imageUrls: [],
      metodologia: isRR ? 'rr' : 'brandsdecoded',
    });

    res.json({ success: true, contentId: item.id, ...carouselData });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── Content Machine ───────────────────────────────────────────────────────

const TIPOS_VIDEO_RR = ['lofi', 'video_curto', 'video_medio'];

function buildPromptRoteiro(tipo, tema, account, tipoInfo, manualNote, brand) {
  const ctaFixo = account.handle === '@analuisa.moutinho'
    ? 'salva pra reler quando esquecer disso. e me diz nos comentários se isso fez sentido pra você.'
    : 'salva esse conteúdo e me conta nos comentários o que mais fez sentido pra você.';

  const estruturas = {
    lofi: `ESTRUTURA LO-FI (câmera ligada, fala direta — Metodologia RR):
- GANCHO (0-3s): primeira frase dita na câmera. Toca na DOR ou DESEJO real. Sem introdução, sem "oi gente". Direto.
- DESENVOLVIMENTO (3s-fim): história ou argumento que sustenta o gancho. Tom conversacional, íntimo. Como se estivesse falando com uma pessoa só.
- CONCLUSÃO / TESE: fecha com uma afirmação clara. O que o espectador deve pensar/sentir ao terminar.
- CTA final falado: "${ctaFixo}"

REGRAS LO-FI:
- Escrever como se fala, não como se escreve. Sem pontuação formal.
- Frases curtas. Pausas marcadas com "..."
- Sem roteiro engessado — é uma guia de pontos, não texto decorado.
- Indicar onde pausar, onde olhar pra câmera, onde gesticular (entre colchetes).`,

    video_curto: `ESTRUTURA VÍDEO CURTO — até 13 segundos (Metodologia RR):
- É UMA ÚNICA SACADA. Só uma. Sem introdução, sem contexto, sem explicação.
- A sacada precisa ser tão boa que o espectador assista de novo.
- Formato: afirmação + reforço de 1 linha. Acabou.
- Contar cada segundo — 13s é pouco, cada palavra precisa valer.

REGRAS VÍDEO CURTO:
- Máximo 2-3 frases no roteiro inteiro.
- Sem CTA explícito — a sacada em si é o gancho para seguir.
- Indicar ritmo: rápido, pausa dramática, etc.`,

    video_medio: `ESTRUTURA VÍDEO MÉDIO — até 60 segundos (Metodologia RR):
- GANCHO (0-5s): primeira frase dita. Uma afirmação provocativa ou pergunta que gera tensão.
- DESENVOLVIMENTO (5-50s): 3-4 pontos curtos que constroem o argumento. Cada ponto em ~10s.
- CONCLUSÃO (50-60s): tese clara + CTA falado: "${ctaFixo}"

REGRAS VÍDEO MÉDIO:
- Contar os segundos aproximados de cada bloco (ex: [0-5s], [5-20s]).
- Tom natural, como conversa real. Sem "hoje vou falar sobre...".
- Indicar onde pausar, mudar tom, olhar direto pra câmera.`,
  };

  const systemPrompt = `Você é roteirista de conteúdo para Instagram da ${account.name} — marca pessoal, Metodologia RR.

FILOSOFIA RR:
- Conteúdo não é venda, é transformação. Autenticidade supera produção.
- Profundidade acima de brevidade. Gancho + história + conclusão com tese.
- Nunca motivacional genérico. Nunca guru. Tom íntimo, direto, real.

${brand.copyDNA || ''}
${manualNote ? `\nDIRETRIZES DO PERFIL:\n${manualNote}` : ''}

TIPO: ${tipoInfo.emoji} ${tipoInfo.label}
${estruturas[tipo] || ''}

TERMOS PROIBIDOS: motivacional genérico, guru, coach, desbloqueie, seja sua melhor versão, transforme sua vida, fórmula secreta, método infalível, próximo nível.

Retornar APENAS JSON válido, sem markdown.`;

  const userPrompt = `Perfil: ${account.name} (${account.handle})
Tema: "${tema}"
Tipo: ${tipoInfo.label}

Gere o roteiro completo em JSON:
{
  "tipo": "${tipo}",
  "tipo_label": "${tipoInfo.label}",
  "tema": "${tema}",
  "isRoteiro": true,
  "duracao_estimada": "ex: 45-55 segundos",
  "gancho": "primeira frase exata a ser dita na câmera",
  "blocos": [
    {
      "id": 1,
      "label": "GANCHO",
      "tempo": "0-5s",
      "texto": "o que falar neste bloco — como se fala, não como se escreve",
      "nota_direcao": "instrução de gravação: tom, gestos, olhar, ritmo"
    },
    {
      "id": 2,
      "label": "DESENVOLVIMENTO",
      "tempo": "5-40s",
      "texto": "...",
      "nota_direcao": "..."
    },
    {
      "id": 3,
      "label": "CONCLUSÃO",
      "tempo": "40-55s",
      "texto": "...",
      "nota_direcao": "..."
    },
    {
      "id": 4,
      "label": "CTA",
      "tempo": "55-60s",
      "texto": "${ctaFixo}",
      "nota_direcao": "falar com intimidade, não como anúncio"
    }
  ],
  "dicas_gravacao": [
    "dica específica para gravar esse vídeo bem"
  ],
  "legenda_sugerida": "legenda do post com emojis, máximo 4 hashtags específicas ao nicho"
}`;

  return { systemPrompt, userPrompt };
}

app.post('/api/content-machine/generate', async (req, res) => {
  try {
    const { tipo, tema, profile } = req.body;
    if (!tipo || !tema) return res.status(400).json({ error: 'Faltam campos: tipo e tema.' });

    const { isRR, tipos, metodologia } = getMetodologia(profile);
    const account = getAccount(profile);
    const brand   = BRAND_IDENTITIES[profile] || BRAND_IDENTITIES.marca;

    if (!tipos[tipo]) {
      return res.status(400).json({
        error: `Tipo "${tipo}" não disponível para ${isRR ? 'marca pessoal (RR)' : 'corporativa (BrandsDecoded)'}. Disponíveis: ${Object.keys(tipos).join(', ')}`,
      });
    }

    const tipoInfo   = tipos[tipo];
    const manualNote = getManualText(profile);
    const isVideo    = isRR && TIPOS_VIDEO_RR.includes(tipo);

    // ── VÍDEO: gera roteiro ───────────────────────────────────────────────
    if (isVideo) {
      const { systemPrompt, userPrompt } = buildPromptRoteiro(tipo, tema, account, tipoInfo, manualNote, brand);

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o', temperature: 1.0, max_tokens: 3000,
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        }),
      });
      const data = await response.json();
      if (data.error) return res.status(500).json({ error: data.error.message });

      const parsed = extractJSON(data.choices[0].message.content.trim());

      const item = saveGeneratedContent({
        id: `cnt_${Date.now()}`, createdAt: new Date().toISOString(), status: 'pendente',
        type: 'reels', contentMachineType: tipo,
        contentMachineTypeLabel: tipoInfo.label,
        profile, topic: tema, imageUrls: [],
        metodologia: 'rr', isRoteiro: true,
        roteiroData: parsed,
      });

      return res.json({ success: true, contentId: item.id, isRoteiro: true, ...parsed });
    }

    // ── TEXTO (carrossel, frase, dump, bastidores): gera slides ──────────
    const tiposRRLabels = { lofi:'Lo-Fi (câmera ligada)', carrossel:'Carrossel', video_curto:'Vídeo Curto (até 13s)', video_medio:'Vídeo Médio (até 1min)', frase:'Frase de Impacto', dump:'Dump / Bastidores', bastidores:'Bastidores' };
    const tiposBDLabels = { tendencia:'Análise de Tendência', case:'Case de Sucesso', educativo:'Educativo / Framework', comparacao:'Comparação / Antes & Depois', lista:'Lista Valiosa', prova_social:'Prova Social', oferta:'Oferta' };
    const tipoLabel     = isRR ? (tiposRRLabels[tipo] || tipo) : (tiposBDLabels[tipo] || tipo);
    const systemPrompt  = buildSystemPromptContentMachine(profile, tipo, metodologia, isRR);

    const ctaFixo = account.handle === '@analuisa.moutinho'
      ? 'salva pra reler quando esquecer disso.'
      : 'Gostou? Comente CASE que nossa equipe te chama.';

    const instrucaoEstrutura = isRR
      ? `INSTRUÇÃO ESPECÍFICA DO FORMATO:\n${tipoInfo.instrucao}\n\nESTRUTURA VIRAL RR:\n1. Slide CAPA: gancho que toca na dor ou desejo real.\n2. Slides DESENVOLVIMENTO: profundidade real.\n3. Slide CONCLUSÃO: tese clara que fecha.\n4. CTA FINAL: íntimo e leve.`
      : `INSTRUÇÃO ESPECÍFICA DO TIPO:\n${tipoInfo.instrucao}\n\nESTRUTURA BRANDSDECODED:\n1. Slide CAPA: hook de 14-18 palavras.\n2. Slides MEIO: dados, frameworks, exemplos.\n3. Slide FINAL: CTA com assinatura da marca.`;

    const userPrompt = `Tipo de conteúdo: ${tipoLabel}
Perfil: ${account.name} (${account.handle})
Tema: "${tema}"

${instrucaoEstrutura}

JSON:
{
  "tipo": "${tipo}",
  "tipo_label": "${tipoLabel}",
  "tema": "${tema}",
  "profile": "${profile}",
  "metodologia": "${isRR ? 'rr' : 'brandsdecoded'}",
  "isRoteiro": false,
  "slides": [
    {"slide":1,"funcao":"CAPA","textos":[{"posicao":1,"tipo":"hook","texto":"..."},{"posicao":2,"tipo":"sub-hook","texto":"..."}]},
    {"slide":2,"funcao":"DESENVOLVIMENTO","textos":[{"posicao":3,"tipo":"titulo","texto":"..."},{"posicao":4,"tipo":"paragrafo","texto":"..."}]},
    {"slide":8,"funcao":"CTA","textos":[{"posicao":15,"tipo":"cta","texto":"${ctaFixo}"}]}
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
      contentMachineType: tipo, contentMachineTypeLabel: tipoLabel,
      profile, topic: tema, imageUrls: [],
      metodologia: isRR ? 'rr' : 'brandsdecoded', isRoteiro: false,
      carouselData: { title: tema, slideCount: slidesNorm.length, slides: slidesNorm, caption: '', hashtags: '' },
    });

    res.json({ success: true, contentId: item.id, isRoteiro: false, ...parsed, slidesNormalizados: slidesNorm });
  } catch(err) {
    console.error('Content Machine error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// TENDÊNCIAS — Google Trends + Twitter/X Trends
// ═══════════════════════════════════════════════════════════════════════════

const NICHE_CONFIG = {
  marca:   'negócios, empresas, marketing digital, growth hacking, empreendedorismo, vendas B2B, liderança empresarial, startups, gestão',
  pessoal: 'marca pessoal, carreira, comportamento humano, produtividade, mulheres empreendedoras, estilo de vida, autoconhecimento, redes sociais',
  virttus: 'tecnologia, inteligência artificial, transformação digital, software B2B, dados, cibersegurança, cloud, automação empresarial',
};

const trendsCache = {};
const TRENDS_TTL  = 60 * 60 * 1000; // 1h



function parseGoogleTrendsRSS(xml) {
  const items = [];
  const itemRx = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRx.exec(xml)) !== null) {
    const block   = m[1];
    const title   = (/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/.exec(block) || /<title>([\s\S]*?)<\/title>/.exec(block) || [])[1] || '';
    const traffic = (/<ht:approx_traffic>([\s\S]*?)<\/ht:approx_traffic>/.exec(block) || [])[1] || '';
    const t = title.replace(/&amp;/g,'&').replace(/&#39;/g,"'").trim();
    if (t) items.push({ termo: t, volume: traffic.trim(), fonte: 'Google Trends' });
  }
  return items;
}

async function fetchWithTimeout(url, options = {}, timeout = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const r = await fetch(url, { ...options, signal: controller.signal });
    return r;
  } finally {
    clearTimeout(timer);
  }
}

async function getGoogleTrends() {
  try {
    const r = await fetchWithTimeout(
      'https://trends.google.com/trends/trendingsearches/daily/rss?geo=BR',
      { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' } }
    );
    const xml = await r.text();
    return parseGoogleTrendsRSS(xml).slice(0, 20);
  } catch(e) {
    console.warn('[Trends] Google Trends falhou:', e.message);
    return [];
  }
}


app.get('/api/trends', async (req, res) => {
  try {
    const { profile = 'marca', refresh } = req.query;
    const now = Date.now();

    if (refresh !== 'true' && trendsCache[profile] && (now - trendsCache[profile].ts) < TRENDS_TTL) {
      return res.json({ ...trendsCache[profile].data, cached: true });
    }

    const account = getAccount(profile);
    const nicho   = NICHE_CONFIG[profile] || NICHE_CONFIG.marca;
    const manualNote = getManualText(profile);

    const googleTrends = await getGoogleTrends();

    if (!googleTrends.length) {
      return res.json({ trends: [], updatedAt: new Date().toISOString(), warning: 'Nenhuma fonte de tendências disponível neste momento.' });
    }

    const termosList = googleTrends
      .map((t, i) => `${i + 1}. [${t.fonte}] ${t.termo}${t.volume ? ` (${t.volume})` : ''}`)
      .join('\n');

    const prompt = `Você é estrategista de conteúdo para ${account.name}.
Nicho: ${nicho}.
${manualNote ? `Contexto do perfil:\n${manualNote}\n` : ''}
Abaixo estão os termos que estão em alta agora no Google Trends e Twitter/X Brasil:

${termosList}

TAREFA:
1. Identifique os 6 termos mais relevantes para o nicho "${nicho}".
2. Para cada um, crie um card de oportunidade de pauta pronto para usar.

Critério de seleção: o termo deve ter conexão real com o nicho — direta ou por analogia estratégica. Ignore termos sem nenhuma relação.

Retorne APENAS JSON válido (sem markdown, sem texto extra):
{
  "trends": [
    {
      "termo": "o termo em alta",
      "fonte": "Google Trends | Twitter/X | Ambos",
      "volume": "ex: 50k tweets ou 200,000+ buscas",
      "relevancia": "por que esse termo é oportuno para o perfil (1 frase direta)",
      "angulo": "como transformar isso em pauta de Instagram para ${account.name} (2 frases, concreto)",
      "tipo_ideal": "carrossel | post | reels",
      "gancho": "headline já pronta para usar no post — no estilo da voz do perfil",
      "urgencia": "alta | media | baixa"
    }
  ]
}`;

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2800,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const aiData = await aiRes.json();
    if (aiData.error) throw new Error(aiData.error.message);

    const parsed = extractJSON(aiData.content[0].text.trim());

    const result = {
      trends: parsed.trends || [],
      updatedAt: new Date().toISOString(),
      fontes: { google: googleTrends.length > 0 },
    };

    trendsCache[profile] = { data: result, ts: now };
    res.json(result);

  } catch(err) {
    console.error('[Trends]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Health ────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString(), metodologias: ['rr (pessoal)', 'brandsdecoded (corporativa)'] });
});

app.use(express.static('public'));
app.use('/api', (req, res) => { res.status(404).json({ error: `Rota não encontrada: ${req.method} ${req.originalUrl}` }); });
app.get('*', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });
app.listen(PORT, () => {
  console.log(`🚀 Máquina de Conteúdo na porta ${PORT} | Metodologias: RR (pessoal) + BrandsDecoded (corporativa)`);
  checkSupabaseTables();
});
