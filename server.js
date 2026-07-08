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

// ── Image crop: 2:3 → 4:5 for Instagram feed ─────────────────────────────
// GPT-Image-1 only generates 1024×1536 (2:3). Instagram feed is 4:5 (1080×1350).
// Center-crop removes 128px from top and bottom (8.3% each side) — safe because
// all prompts instruct the model to keep content within the inner 80% safe zone.
async function cropTo45(b64png) {
  try {
    const sharp = require('sharp');
    const inputBuf = Buffer.from(b64png, 'base64');
    // 1024×1536 → center crop to 1024×1280 (4:5) → resize to 1080×1350
    const cropHeight = Math.round(1024 * 5 / 4); // 1280
    const topOffset  = Math.round((1536 - cropHeight) / 2); // 128
    const outputBuf = await sharp(inputBuf)
      .extract({ left: 0, top: topOffset, width: 1024, height: cropHeight })
      .resize(1080, 1350, { fit: 'fill', kernel: 'lanczos3' })
      .png({ compressionLevel: 8 })
      .toBuffer();
    return outputBuf.toString('base64');
  } catch (e) {
    console.warn('[cropTo45] sharp não disponível, retornando original:', e.message);
    return b64png;
  }
}

// ── Quality helpers ───────────────────────────────────────────────────────
// CORRIGIDO: adicionado 'high' e 'auto' que a gpt-image-1 aceita
const VALID_QUALITIES = ['low', 'medium', 'high', 'auto'];
const DEFAULT_QUALITY = 'high';
function resolveQuality(q) { return VALID_QUALITIES.includes(q) ? q : DEFAULT_QUALITY; }

// ── Prompt builder for carousel slide images ──────────────────────────────
// Layout-first approach: prompts describe GRAPHIC DESIGN structures, not art.
// This matches the quality standard of professional brand identity carousel mockups.
function buildCarouselPrompt({ quality, brand = {}, aestheticOverride, slideRole, heading, body, slideNumber, totalSlides, sceneHint }) {
  const isFirst = slideNumber === 1 || slideRole === 'CAPA';
  const isLast  = slideNumber === totalSlides || slideRole === 'CTA' || slideRole === 'ASSINATURA';
  const aestheticDNA = aestheticOverride || brand.aestheticDNA || 'premium editorial minimalist design';
  const brandName    = brand.name    || 'MARCA';
  const brandHandle  = brand.handle  || '';

  // ── Layout structure per slide role ──────────────────────────────────────
  let layoutStructure;
  if (isFirst) {
    layoutStructure = `VISUAL DA CAPA (FUNDO/BACKGROUND APENAS — SEM TEXTO):
— Composição fotográfica ou ilustrativa que evoca o tema: "${sceneHint || heading || ''}"
— Fundo rico com textura, profundidade e luz dramática nas cores da paleta da marca
— Elemento gráfico ou forma geométrica da marca como detalhe sutil no canto ou fundo
— Atmosfera premium, editorial, cinematográfica — como capa de revista de negócios
— IMPORTANTE: ZERO texto, zero tipografia, zero letras na imagem`;
  } else if (isLast) {
    layoutStructure = `VISUAL DE ENCERRAMENTO (FUNDO/BACKGROUND APENAS — SEM TEXTO):
— Composição clean e elegante nas cores da marca, sensação de fechamento e ação
— Fundo com gradiente suave ou textura sutil — pode ter uma forma geométrica ou símbolo da marca
— Tom convidativo, caloroso, profissional
— IMPORTANTE: ZERO texto, zero tipografia, zero letras na imagem`;
  } else {
    layoutStructure = `VISUAL DE CONTEÚDO — slide ${slideNumber} de ${totalSlides} (FUNDO/BACKGROUND APENAS — SEM TEXTO):
— Imagem temática que ilustra visualmente o conceito: "${sceneHint || heading || ''}"
— Fundo consistente com os outros slides em paleta de cores e mood
— Pode ser fotografia editorial, textura, forma abstrata ou composição geométrica
— Elemento sutil da identidade visual da marca (cor de acento, forma, detalhe)
— IMPORTANTE: ZERO texto, zero tipografia, zero letras na imagem`;
  }

  // ── Execution requirements ────────────────────────────────────────────────
  const execution = [
    `ESTE É UM VISUAL DE FUNDO (BACKGROUND) para um slide de carrossel Instagram. NÃO É uma peça gráfica com texto. O texto será adicionado por cima via CSS/HTML — NÃO inclua texto, título, legenda, hashtag, handle ou qualquer tipografia na imagem.`,
    `Qualidade visual: fotografia editorial premium ou ilustração de marca publicável. Atmosfera coerente com a identidade da marca.`,
    `Cores: estritamente da paleta da marca. Zero improvisação cromática.`,
    `Textura e profundidade: iluminação cinematográfica, sombras difusas, profundidade de campo — nunca fundo completamente liso.`,
    `Consistência de série: este background deve pertencer visivelmente ao mesmo universo visual dos outros slides.`,
    `Formato: 1024×1536px. Composição centralizada e equilibrada, funciona bem cortado para 4:5. Sem watermarks, logotipos externos ou elementos de UI.`,
    `REGRA ABSOLUTA: ZERO texto visível na imagem. Nenhuma letra, número, palavra, símbolo tipográfico. Só visual puro.`,
  ].map(l => `— ${l}`).join('\n');

  return [
    `Crie um VISUAL DE FUNDO (background image) para o slide ${slideNumber} de ${totalSlides} de um carrossel Instagram.`,
    `É uma imagem de fundo pura — sem texto, sem tipografia, sem legendas. O texto será sobreposto por CSS.`,
    '',
    `════ SISTEMA DE DESIGN E IDENTIDADE VISUAL DA MARCA ════`,
    aestheticDNA,
    '',
    `════ ESTRUTURA E LAYOUT DESTE SLIDE ════`,
    layoutStructure,
    sceneHint ? `\nCONTEXTO TEMÁTICO ADICIONAL: ${sceneHint}` : '',
    '',
    `════ REQUISITOS DE EXECUÇÃO ════`,
    execution,
  ].filter(Boolean).join('\n');
}

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
FILOSOFIA BASE (BrandsDecoded — Case Aceleradora):
- Autoridade por profundidade, não por hype. Dados reais, exemplos concretos de negócios reais.
- Hook de 14-18 palavras que nomeia um comportamento ou padrão real que o empresário vive no dia a dia.
- Cada slide precisa ser tão bom que o leitor manda para o sócio ou para o grupo do WhatsApp da empresa.
- Nunca inventar fatos. Nunca usar jargão técnico sem explicar em linguagem de negócio.
- O público é o empresário que fatura 80k+/mês — dono de delivery, e-commerce, negócio local, franquia. Ele não conhece termos de SaaS, growth hacking ou métricas de startup. Ele conhece: faturamento, margem, equipe, cliente, operação, fluxo de caixa, fornecedor, concorrente, expansão.
- NUNCA usar: SaaS, MRR, churn, growth hacking, onboarding, KPI, ROI, escalabilidade, user, B2B, lead qualificado, funil de vendas, jornada do cliente, upsell, cross-sell, framework, mindset, pivot, tração, runway. Substitua por: recorrência, perda de clientes, crescimento, integração de novos funcionários, resultado, retorno, crescimento com estrutura, cliente, empresa/negócio, venda extra, indicação, método, mentalidade, mudar de direção, crescimento inicial, caixa.
`,
  estrutura: `
ESTRUTURA BRANDSDECODED:
- Slide 1: hook como afirmação provocativa que nomeia fenômeno real que o empresário reconhece (14-18 palavras)
- Slides 2-N: exemplos reais de negócios, números concretos, situações do dia a dia — profundidade sem jargão
- Slide final: CTA direto com assinatura da marca
`,
  tonsProibidos: ['descubra', 'saiba como', 'conheça', 'transforme', 'incrível', 'revolucionário', 'disruptivo', 'mudando o jogo', 'next-level', 'fórmula', 'segredo', 'SaaS', 'growth hacking', 'MRR', 'churn', 'KPI', 'ROI', 'escalabilidade', 'onboarding', 'framework', 'mindset', 'tração', 'pivot', 'runway', 'lead qualificado'],
  tonsPermitidos: ['direto', 'estratégico', 'autoridade', 'real', 'fundamentado', 'prático', 'empresarial', 'concreto'],
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

  return `Você é o gerador de carrosseis da Case Aceleradora — conteúdo premium para empresários reais no Instagram.

${METODOLOGIA_BRANDSDECODED.filosofia}
${METODOLOGIA_BRANDSDECODED.estrutura}
${manualNote ? `\nDIRETRIZES DO PERFIL:\n${manualNote}` : ''}

PÚBLICO QUE VOCÊ ESTÁ FALANDO: Empresários que faturam 80k a 500k/mês. Donos de delivery, e-commerce, negócio local, franquia, prestação de serviço. Eles entendem de operação, equipe, cliente, fornecedor e caixa. Não entendem de jargão técnico de startup ou SaaS.

REGRAS OBRIGATÓRIAS:
- Slide 1: hook de 14-18 palavras — deve soar como algo que o dono de negócio pensa no dia a dia
- NUNCA usar travessão (—) nem hífen no meio de frases
- NUNCA usar termos técnicos de startup/SaaS: ${METODOLOGIA_BRANDSDECODED.tonsProibidos.join(', ')}
- Use exemplos de negócios reais (delivery, loja, serviço) em vez de exemplos abstratos
- Máximo 4 hashtags
- ASSINATURA FIXA no último slide: "Gostou desse conteúdo? Aproveite para seguir nosso perfil. E caso queira saber sobre o nosso acompanhamento, comente 'CASE' que nossa equipe te chama."
- Retornar APENAS JSON valido, sem markdown. O array "slides" DEVE ter entre 7 e 10 objetos. Cada slide DEVE ter "textos" como array

REGRA CRÍTICA SOBRE CONTEÚDO DOS SLIDES:
- Cada slide DEVE ter um "heading" (título curto e direto) E um "body" com 2-3 frases que desenvolvem e explicam o heading com substância real.
- NUNCA deixar "body" vazio ou com menos de 2 frases. O body é onde está o valor do conteúdo.
- O body deve conter: situação real de negócio, número concreto, exemplo prático — algo que o dono de delivery ou e-commerce reconheça como verdade da própria vida.
- Slides de conteúdo sem body são slides inúteis. Cada slide deve poder existir sozinho e fazer sentido completo.`;
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

  return `Você é o gerador oficial de conteúdo da Case Aceleradora para Instagram.

${METODOLOGIA_BRANDSDECODED.filosofia}
${METODOLOGIA_BRANDSDECODED.estrutura}
${manualNote ? `\nDIRETRIZES DO PERFIL:\n${manualNote}` : ''}

PÚBLICO: Empresários que faturam 80k a 500k/mês — donos de delivery, e-commerce, negócio local, franquia, prestação de serviço. Linguagem de quem entende de operação, equipe, cliente e caixa. Nunca linguagem de startup ou tech.

TIPO ATUAL: ${tipoInfo.emoji} ${tipoInfo.label} (${tipoInfo.categoria})
INSTRUÇÃO ESPECÍFICA: ${tipoInfo.instrucao}

REGRAS:
- Nunca inventar fatos
- NUNCA usar travessão (—) nem hífen no meio de frases
- NUNCA usar termos de startup/SaaS: ${METODOLOGIA_BRANDSDECODED.tonsProibidos.join(', ')}
- Use sempre exemplos de negócios reais (delivery, loja física, e-commerce, prestação de serviço)
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
    handle: '@caseaceleradora', niche: 'Aceleração de negócios reais: faturamento, operação, equipe e expansão — para empresários que já faturam e querem crescer com estrutura',
    bio: 'Aceleramos negócios reais com estratégia, estrutura e execução. Delivery, e-commerce, negócio local — a Case acompanha quem já fatura e quer escalar de verdade.',
    tom: 'Direto, confiante, com autoridade de quem já viu muitos negócios crescerem. Fala de igual para igual com o dono de negócio. Sem jargão técnico, sem papo de startup. Linguagem de quem entende de operação, equipe, caixa, cliente e resultado real.',
    proibidos: ['Descubra', 'Transforme sua vida', 'Saiba como', 'Riqueza', 'Fórmula secreta', 'SaaS', 'MRR', 'Churn', 'Growth hacking', 'KPI', 'ROI', 'Escalabilidade', 'Onboarding', 'Framework', 'Mindset', 'Tração', 'Pivot', 'Runway', 'Lead qualificado', 'Funil de vendas', 'Jornada do cliente', 'Upsell', 'B2B', 'B2C', 'Stakeholder', 'Disruptivo', 'Inovação disruptiva', 'Next-level'],
    pilares: [
      'Gestão de equipe e liderança real (como contratar, treinar, cobrar e reter)',
      'Operação e processos (como parar de depender só de você)',
      'Faturamento e margem (o que está comendo seu lucro e como resolver)',
      'Expansão e escala (como abrir nova unidade, novo canal ou novo produto sem quebrar)',
      'Cases reais de clientes Case (resultado concreto, antes e depois)',
      'Erros comuns de quem fatura entre 80k e 500k/mês (e como evitar)',
    ],
    publicoAlvo: 'Empresários que faturam entre 80k e 500k/mês — donos de delivery, restaurante, e-commerce, negócio local, franquia, loja física ou prestação de serviço. Pessoas que entendem de negócio real: dia a dia de operação, equipe, fornecedor, cliente difícil, fluxo de caixa. Não conhecem jargão de startup ou SaaS.',
    cta: 'Comente "CASE" que nossa equipe te chama.',
    referencias: ['Negócios reais brasileiros', 'Empreendedores de sucesso sem jargão', 'Linguagem de Exame/Pequenas Empresas Grandes Negócios', 'Exemplos práticos de delivery, e-commerce e franquia'],
    tiposConteudo: ['tendencia', 'case', 'educativo', 'comparacao', 'lista', 'prova_social', 'oferta'],
    observacoes: 'A Case Aceleradora fala com donos de negócio que já faturam e querem crescer com estrutura. O público não é de tech, não é de startup. É o dono de delivery que abre às 10h e fecha à meia-noite, o dono de e-commerce que vende 500 pedidos por mês, o prestador de serviço que tem 10 funcionários e não sabe como crescer sem perder o controle. Todo conteúdo precisa soar como conselho de quem já viu isso funcionar — não como teoria de consultor. Use exemplos de negócios reais: "a padaria que triplicou o ticket médio", "o delivery que parou de perder funcionários", "a loja que abriu a segunda unidade sem se endividar". Evite qualquer termo técnico sem explicação imediata em linguagem do dia a dia de empresa.',
    pdfUploadedAt: null, updatedAt: null,
  },
  pessoal: {
    profileId: 'pessoal', tipo: 'pessoal', nome: 'Ana Moutinho',
    handle: '@analuisa.moutinho',
    niche: 'Marca pessoal, desenvolvimento humano, virtudes, vida ordenada, construção de longo prazo — contada por quem ainda está aprendendo, não por quem já chegou',
    bio: 'Ainda estou descobrindo como construir uma vida mais ordenada, virtuosa e significativa. Compartilho o que aprendo enquanto aprendo.',
    sobreMim: `Sou uma mulher movida por sentido, profundidade e construção. Não me interesso por uma vida apenas bonita por fora — gosto do que tem raiz, ordem, permanência e verdade. Tenho um olhar atento para os detalhes do cotidiano, porque acredito que a vida real se revela nas pequenas escolhas: na forma como trabalhamos, cuidamos da casa, honramos nossos vínculos, organizamos a rotina e permanecemos fiéis ao que importa.

Meu conteúdo nasce desse lugar — e ainda está sendo construído junto comigo. Falo sobre amadurecimento, rotina, fé, beleza, trabalho, autocuidado e construção de futuro. Não como performance e nem como chegada. Como caminho. Um caminho que estou trilhando agora, com tudo o que isso implica de dúvida, recomeço e aprendizado em tempo real.

Tenho sensibilidade para perceber o invisível por trás das situações comuns. Gosto de transformar experiências em reflexão, caos em linguagem, desejo em direção. Minha comunicação une firmeza e delicadeza: acolhe, mas não acomoda; inspira, mas não ilude.

Acredito que uma vida bonita não é uma vida perfeita. É uma vida com alicerce. E é isso que estou aprendendo a construir.

ESSÊNCIA DA MARCA:
Construção com profundidade — de rotina, de casa interior, de fé, de saúde, de trabalho, de presença, de relações, de beleza e de futuro. Sem pressa vazia, sem superficialidade.

MENSAGEM CENTRAL: A vida que você deseja precisa de alicerce, não apenas de desejo.

ATENÇÃO CRÍTICA: Este "sobre mim" descreve uma direção e um conjunto de valores — não uma chegada. A Ana ainda está construindo tudo isso. O conteúdo deve soar como o diário de quem tem clareza sobre o que quer mas ainda está aprendendo a viver à altura disso, não como o depoimento de quem já resolveu.`,
    tom: 'Reflexivo, íntimo, honesto sobre as próprias contradições. Fala como alguém que está no meio do processo — não como quem chegou do outro lado. Levemente provocativo, mas sem didatismo. Nunca guru, nunca coach, nunca superior. A voz é de companheira de caminhada: "eu também estou tentando entender isso". Usa primeira pessoa real: duvida, erra, recomeça, ri de si mesma às vezes.',
    proibidos: ['Desbloqueie', 'Seja sua melhor versão', 'Transforme sua vida', 'Coach', 'Mentoria', 'Sucesso', 'Fórmula', 'Método infalível', 'Próximo nível', 'Descubra', 'Segredo', 'Aprendi que', 'A verdade é que', 'O segredo é simples', 'Você precisa', 'Faça assim', 'É simples assim'],
    pilares: [
      'Vida ordenada e sistemas pessoais (o que estou tentando montar e o que ainda não funciona)',
      'Virtudes e formação de caráter (prudência, coragem, temperança, disciplina — o que li, o que tentei, onde falho)',
      'Corrida e autoaperfeiçoamento físico (o processo real, não o resultado polido)',
      'Leitura e filosofia prática (o que faz sentido pra mim, o que ainda não entendo)',
      'Bastidores do negócio e da vida intencional (as dúvidas reais, não só as vitórias)',
      'Falhas, correções e recomeços — contados com honestidade, não com moralismo',
    ],
    publicoAlvo: 'Homens e mulheres 25-38 anos que também estão tentando construir uma vida com mais ordem e intenção — e se sentem sozinhos nisso. Não buscam guru nem fórmula. Buscam alguém que também está no meio do processo e fala sobre isso com honestidade.',
    cta: 'Me conta nos comentários se você também sente isso. Salva pra quando precisar lembrar.',
    referencias: ['Sofia Coppola', 'Filosofia aristotélica e virtudes clássicas', 'Lo-fi diary aesthetic', 'Candid editorial', 'Estética minimalista clara — off-white, creme, marrom café, tons quentes neutros'],
    tiposConteudo: ['lofi', 'carrossel', 'video_curto', 'video_medio', 'frase', 'dump', 'bastidores'],
    observacoes: 'Ana está no processo de construir a vida que quer — não chegou lá. Esse é o ponto central. O conteúdo deve soar como diário aberto de alguém que está tentando, errando e aprendendo em tempo real — não como lição de quem já resolveu. Temas recorrentes: ordem na vida, planejamento, rotinas, sistemas, leitura, corrida de rua, autoaperfeiçoamento. Conflitos internos REAIS que aparecem no conteúdo: perfeccionismo vs ação, muitos interesses simultâneos, dificuldade de constância, cansaço, recomeço. A IA deve usar linguagem de quem ainda está aprendendo: "estou tentando", "não sei ainda", "errei nisso", "percebi que", "ainda não consigo", "voltei a fazer". NUNCA posicionar a Ana como referência acabada. Ela é referência pelo processo honesto, não pela chegada. Estética: elegância, minimalismo, sofisticação, tons profundos. Sem pasteis.',
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
    p.sobreMim     ? `IDENTIDADE PESSOAL (quem é Ana, como ela se descreve):\n${p.sobreMim}` : '',
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
    accent:'#B8864B',accentAlt:'#4A2E1F',bgDark:'#1E120D',bgLight:'#F4E6D4',bgBrand:'#F4E6D4',
    bgMid:'#E9D2B6',bgNude:'#D9B794',bronze:'#B8864B',marrom:'#4A2E1F',
    textOnDark:'#F4E6D4',textOnLight:'#1E120D',handle:'@caseaceleradora',name:'CASE',
    moods:['EDITORIAL_LIGHT','TYPE_LIGHT','EDITORIAL_LIGHT','TYPE_LIGHT','SPLIT_LIGHT','EDITORIAL_LIGHT','TYPE_LIGHT','BRAND_PUNCH','CTA_LIGHT'],
    aestheticDNA:`IDENTIDADE VISUAL: CASE Aceleradora — "Guia de Identidade Visual baseado no Quadro da Marca do Milhão."

CONCEITO CENTRAL: expansão com propósito. Sofisticada, estratégica, guiada por direção clara, liderança e construção de impérios duradouros. Cada elemento comunica conquista, visão e legado.

PALETA CROMÁTICA OBRIGATÓRIA:
— Fundo primário dominante: areia claro #F4E6D4 (ocupa 60-70% da composição)
— Fundo secundário: bege atlas #E9D2B6 (usado em blocos, divisórias e segundos planos)
— Acento nobre: bronze dourado #B8864B — usado com moderação máxima, apenas em detalhes, linhas finas, bordas e elementos gráficos pontuais. Nunca como fundo.
— Texto principal e elementos de autoridade: marrom profundo #4A2E1F
— Texto secundário e sombras: preto café #1E120D com 60-80% de opacidade
— Cor de contraste para destaques: bege nude #D9B794
— PROIBIDO: preto puro, azul, verde, roxo, neon, cinza frio, branco puro como fundo principal

TIPOGRAFIA — REGRAS ABSOLUTAS:
— Títulos: fonte geométrica sans-serif, peso 800-900, caixa alta (ALL CAPS) ou small caps elegante
— Subtítulos: mesmo typeface, peso 500-600, caixa baixa
— Corpo de texto: fonte complementar humanista, peso 400, generosamente espaçado
— Letter-spacing para títulos: levemente aberto (+0.05em a +0.1em) — sensação monumental
— Sem serifas, sem scripts, sem fontes decorativas

ELEMENTOS GRÁFICOS CARACTERÍSTICOS (usar com moderação e elegância):
— Rosa-dos-ventos ou bússola como símbolo central — representando direção e estratégia
— Fragmentos de mapa-mundi ou mapas cartográficos em manchas suaves e transparentes no fundo
— Grid cartográfico com linhas finíssimas em bronze #B8864B a 15-25% de opacidade
— Bordas finas em bronze — retângulos, enquadramentos, separadores
— Sombras suaves e difusas que criam profundidade sem dramatismo
— Micro-textura de papel de algodão ou linho no fundo

DIREÇÃO DE COMPOSIÇÃO:
— Composição simétrica e centralizada como regra principal
— Amplo espaço respiro (breathing room) em torno dos elementos
— Hierarquia visual absolutamente clara: título > subtítulo > elemento gráfico > corpo
— Luz suave direcional de cima, criando sutis gradientes de claro para ligeiramente mais escuro
— Fundo com textura sutil de papel ou pergaminho — nunca completamente liso

SENSAÇÃO E ATMOSFERA:
— Premium, institucional, atemporal, monumental
— Como a capa de um livro de estratégia de um empresário visionário
— Como o material de comunicação de uma empresa de private equity sofisticada
— Transmite: direção clara, conquista calculada, estratégia refinada, expansão com propósito, legado

TOM VISUAL: estratégico · sofisticado · monumental · direcional · premium · institucional · cartográfico

PROIBIDO ABSOLUTAMENTE: fundos escuros dominantes, neon, cores saturadas ou vibrantes, elementos cartoon ou ilustrativo amador, estética motivacional raso, foguetes, emojis gráficos, gradientes coloridos, confete, estrelas decorativas.

════ DIREÇÃO FOTOGRÁFICA / VISUAL DE FUNDO ════
Quando a imagem gerada for um BACKGROUND FOTOGRÁFICO ou visual de fundo, seguir obrigatoriamente:

PALETA VISUAL DA FOTOGRAFIA:
— Tom geral: quente, dourado, âmbar — como luz de fim de tarde entrando por janelas altas
— Superfícies: madeira clara, couro natural, papel envelhecido, linho, pedra clara, mármore bege
— Iluminação: natural, difusa, lateral — sombras suaves, nenhuma luz dramática fria ou azulada
— Cores proibidas na fotografia: azul, roxo, verde, cinza frio, preto como dominante

OBJETOS E AMBIENTES PERMITIDOS:
— Mesas de trabalho com materiais premium (couro, papel kraft, caneta dourada, cadernos abertos)
— Espaços arquitetônicos com luz natural: escritórios com janelas grandes, varandas, salas de reunião com madeira
— Detalhes de negócio: contratos, gráficos impressos, calculadoras analógicas, relógios
— Elementos cartográficos físicos: atlas aberto, bússola de latão, mapas em papel envelhecido
— Café em xícara branca/nude, reuniões focadas (sem rostos dominantes), aperto de mão elegante

ESTILO FOTOGRÁFICO:
— Editorial de negócios high-end — como revista Forbes ou Harvard Business Review
— Profundidade de campo suave (fundo levemente desfocado) com objeto principal nítido
— Grão sutil de filme — nunca digital hiper-saturado
— NUNCA: stock photo genérico, suits escuros com fundo cinza, estúdio artificial, iluminação de flash

ATMOSFERA: como a sala de um empresário visionário — conquista silenciosa, estratégia e legado`,
  },
  pessoal: {
    accent:'#8B7355',accentAlt:'#C4A882',accentFem:'#C17B6F',bgDark:'#3D3530',bgLight:'#FAF8F5',
    bgMid:'#EDEAE4',bgBrand:'#F5F2EE',textOnDark:'#F5F2EE',textOnLight:'#2C2420',
    handle:'@analuisa.moutinho',name:'Ana Moutinho',
    moods:['DIARIO_EDITORIAL','TYPE_CREME','COLAGEM_REAL','FRASE_IMPACTO','HERO_LOFI','DIARIO_EDITORIAL','TYPE_CREME','VIRADA','CTA_INTIMO'],
    aestheticDNA:`IDENTIDADE: "Ana mais real" — diário visual inteligente de alguém construindo a própria vida com intenção, disciplina e profundidade. Não é influencer. É pensadora.

CONCEITO VISUAL: editorial minimalista intimista. Como as páginas de um livro bonito encontradas com a estética de um feed de fotógrafo documental europeu. Sofisticação sem ostentação. Profundidade sem heaviness.

PALETA CROMÁTICA OBRIGATÓRIA:
— Fundo primário dominante: off-white creme #FAF8F5 (ocupa 65-75% da composição) — nunca branco puro, nunca cinza frio
— Fundo secundário: bege claro aconchegante #EDEAE4
— Acento principal: marrom café aquecido #8B7355 — para bordas finas, linhas divisórias, detalhes pontuais
— Acento feminino pontual: rosa queimado terracota #C17B6F — apenas em detalhes muito sutis, como sublinhados ou pequenos elementos gráficos
— Texto principal: marrom escuro quente #2C2420
— Texto secundário: marrom médio #8B7355
— NUNCA: preto puro, fundos escuros, azul, verde, cinza frio, branco clínico

TIPOGRAFIA — REGRAS ABSOLUTAS:
— Títulos: serifada editorial ou sans-serif geométrica leve, peso 300-400 para frases longas ou 700-800 para statements de impacto curtos
— Frases de impacto: letra grande, ocupando boa parte da composição, quase sem margens — editorial, não de blog
— Subtítulos e legendas: sans-serif clean em peso 400, espaçamento generoso
— Nunca fontes decorativas, scripts cursivos exagerados ou tipografias de coach/LinkedIn

ATMOSFERA E LUZ:
— Luz natural difusa, como entrada de janela em dia nublado ou manhã tranquila
— Granulação fotográfica sutil sobre qualquer elemento fotográfico (grain de filme analógico leve)
— Profundidade com sombras muito suaves e translúcidas — nunca sombra dura
— Textura de fundo: papel aquarela, linho fine art, ou papel de algodão — nunca digital liso

ELEMENTOS GRÁFICOS (usar com extrema contenção):
— Linhas finíssimas horizontais em marrom #8B7355 como separadores
— Formas geométricas simples — retângulos de borda fina como enquadramentos
— Manchas de cor muito suaves e translúcidas como elementos de fundo
— NUNCA: ícones decorativos, florinhas, estrelas, ornamentos, stickers, clip art

DIREÇÃO DE COMPOSIÇÃO:
— Layout editorial com respiração ampla — muito espaço vazio intencional
— Regra dos terços para posicionamento do texto principal
— Assimetria elegante — não tudo centralizado (exceto frases de impacto)
— Como a página de um livro do Penguin Classics ou editorial da Vogue Portugal
— Sensação: você está lendo algo que vale a pena ler

SENSAÇÃO E ATMOSFERA:
— Real sem ser crua. Sofisticada sem ser fria. Íntima sem ser vulgar.
— Como um ensaio fotográfico de alguém muito bem-resolvida sendo vista em seu habitat natural
— Transmite: inteligência, intencionalidade, disciplina, profundidade, vida real construída com propósito

TOM VISUAL: editorial · intimista · arejado · granulado · creme · terracota suave · pensativo · direto

PROIBIDO ABSOLUTAMENTE: fundos escuros, preto, neon, gradientes coloridos, elementos decorativos infantis, estética de coach, LinkedIn, motivacional, citações com fontes script floreadas, fotos de banco de imagens com sorriso forçado, emojis gráficos.`,
    copyDNA:`COPY PARA ANA MOUTINHO (Metodologia RR):
IDENTIDADE CENTRAL: Construindo uma vida mais ordenada, virtuosa e significativa, enquanto constroi negocios que crescem de forma solida e sustentavel.
1. HOOK: afirmacao que nomeia algo que a pessoa sente mas nao sabe nomear. Toca em dor ou desejo real ligado a: ordem, virtude, autoaperfeicoamento, corrida, leitura, carater, coerencia.
2. TOM: reflexivo + direto + provocativo. Mistura como fazer com por que fazer com vale a pena fazer.
3. ESTRUTURA: gancho -> historia real ou observacao -> conclusao com tese clara -> CTA intimo.
4. TEMAS PERMITIDOS: planejamento, rotinas, sistemas, metas, disciplina, coragem, prudencia, temperanca, corrida de rua, leitura de livros, virtudes aristotelicas, ordem pessoal, bastidores reais, falhas e aprendizados, construcao de longo prazo, legado, fundacao, constancia.
5. PROIBIDO: desbloqueie, seja sua melhor versao, sucesso, qualquer tom de guru ou coach.
6. CONFLITOS REAIS QUE CONECTAM: perfeccionismo vs acao, excesso de interesses, dificuldade de constancia, querer excelencia sem paralisar.`,
  },
  virttus: {
    accent:'#00D4AA',accentAlt:'#7B2FFF',bgDark:'#050B18',bgLight:'#F0F4FF',bgBrand:'#0A1628',
    textOnDark:'#FFFFFF',textOnLight:'#050B18',handle:'@virttus',name:'Virttus',
    moods:['HERO_DARK','TYPE_DARK','EDITORIAL_LIGHT','HERO_DARK','TABLE_LIGHT','TYPE_DARK','EDITORIAL_LIGHT','BRAND_PUNCH','CTA_LIGHT'],
    aestheticDNA:`IDENTIDADE VISUAL: Virttus — tecnologia premium com foco em desenvolvimento humano, performance e liderança consciente.

CONCEITO: A linguagem visual de uma empresa de tecnologia que transforma potencial humano em resultado real. Sofisticada, clara e confiável — como as melhores marcas SaaS do mercado.

PALETA CROMÁTICA OBRIGATÓRIA:
— Fundo primário dominante: branco-azulado sofisticado #F0F4FF ou branco #FFFFFF (ocupa 65-75% da composição — SIM, fundos claros dominam os slides de conteúdo)
— Fundo alternativo profundo: azul noturno #001B3A para slides de capa ou de impacto máximo
— Acento primário vivo: azul-roxo elétrico #2563EB ou roxo Virttus #7C3AED — para títulos em fundos claros, bordas e destaques
— Acento secundário: ciano-turquesa #00D4AA — apenas em elementos de destaque pontual, ícones, CTAs
— Gradiente assinatura da marca: roxo #7C3AED → azul #2563EB (horizontal ou diagonal em 45°) — usado em barras, bordas, títulos de destaque e elementos gráficos
— Texto sobre fundo claro: azul profundo #001B3A (peso 700+) e cinza médio #647488 (peso 400)
— Texto sobre fundo escuro: branco #FFFFFF
— NUNCA: marrom, bege, laranja, dourado, verde natural

TIPOGRAFIA — REGRAS ABSOLUTAS:
— Títulos principais: sans-serif geométrica clean (Inter, SORA, Space Grotesk), peso 700-900, caixa alta ou mista
— O NOME "Virttus" quando aparecer: logo ou texto em azul-roxo #2563EB, bold, com ícone/símbolo da marca ao lado
— Subtítulos e labels: peso 500-600, espaçamento levemente aberto, hierarquia clara
— Corpo e listas: peso 400, muito legível, espaçamento 1.6x
— Métricas e números de destaque: peso 800, tamanho grande, cor de acento

ELEMENTOS GRÁFICOS CARACTERÍSTICOS (usar com inteligência, não acumular):
— Ícone/logo da Virttus: forma em "V" geométrica estilizada ou símbolo próprio em roxo/azul gradiente
— Cards com cantos arredondados (border-radius generoso) em fundo branco com sombra suave — SaaS premium
— Ícones de linha fina (outline icons) para ilustrar bullets e features — clean, moderno
— Gradiente roxo→azul em barras horizontais, separadores ou acentos de destaque
— Curvas/ondas suaves em azul claro a 15% de opacidade como elemento de fundo
— Glow suave roxo ou ciano em elementos gráficos centrais (não exagerar)
— Mockups de dispositivos (smartphone, tablet) em slides de aplicação prática

DIREÇÃO DE COMPOSIÇÃO:
— Layout limpo, muito respiro visual, grid rigoroso — como Notion, Linear ou Figma redesigned
— Fundo claro e sofisticado com elementos que respiram — nunca saturado ou cheio
— Hierarquia rigorosa: identidade da marca → título da seção → conteúdo → apoio
— Elementos de profundidade: sombras suaves de card (box-shadow elegante), não sombras duras
— Sensação premium de produto SaaS B2B de excelência

SENSAÇÃO E ATMOSFERA:
— Como a página de um produto SaaS premiado por design
— Confiança sem frieza. Tecnologia com humanidade.
— Transmite: liderança, performance, evolução, clareza e sofisticação limpa

TOM VISUAL: clean · claro · premium · SaaS · gradiente roxo-azul · confiável · humano · estratégico

PROIBIDO ABSOLUTAMENTE: fundos escuros dominantes (exceto slide de capa), clipart, ícones genéricos pixelados, elementos cartoon, cores quentes (marrom/laranja/dourado/bege), gradientes arco-íris kitsch, robôs humanoides clichê, estoque fotográfico genérico.`,
  
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

app.get('/api/gphotos/token', async (req, res) => {
  const userId = req.query.userId || 'default';
  try {
    const token = await getGPhotoAccessToken(userId);
    if (!token) return res.status(401).json({ error: 'Não autenticado' });
    res.json({ access_token: token });
  } catch(e) { res.status(500).json({ error: e.message }); }
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

// Proxy server-side para imagens do Google Fotos — evita CORS no canvas do frontend.
// Também aceita URLs temporárias do Google Photos como ?url=...
app.get('/api/gphotos/proxy-image', async (req, res) => {
  const userId = req.query.userId || 'default';
  const photoUrl = req.query.url;
  if (!photoUrl) return res.status(400).json({ error: 'url obrigatório' });
  // Validação mínima — só permite domínios Google Fotos
  if (!photoUrl.startsWith('https://lh3.googleusercontent.com') &&
      !photoUrl.startsWith('https://photos.google.com') &&
      !photoUrl.startsWith('https://googleusercontent.com')) {
    return res.status(403).json({ error: 'Domínio não permitido' });
  }
  const accessToken = await getGPhotoAccessToken(userId);
  if (!accessToken) return res.status(401).json({ error: 'Não autenticado' });
  try {
    const imgRes = await fetch(photoUrl, { headers: { 'Authorization': 'Bearer ' + accessToken } });
    if (!imgRes.ok) return res.status(imgRes.status).json({ error: 'Falha ao buscar imagem' });
    const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    res.set('Content-Type', contentType);
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cache-Control', 'private, max-age=300');
    res.send(buffer);
  } catch(e) { res.status(500).json({ error: e.message }); }
});


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

// Gera calendário MENSAL
app.post('/api/calendar/generate', async (req, res) => {
  try {
    const { month, year, profile, postsPerDay = 1 } = req.body;
    const { isRR, tipos } = getMetodologia(profile);
    const manualNote  = getManualText(profile);
    const account     = getAccount(profile);
    const daysInMonth = new Date(year, month, 0).getDate();
    const tiposDisponiveis = Object.values(tipos).map(t => t.id).join(' | ');
    const tiposLabels = Object.values(tipos).map(t => t.id + ' (' + t.label + ')').join(', ');

    // Busca tendências em tempo real para todos os perfis (pessoal e corporativo)
    const trendTopics = await getTrendsForCalendar(profile);
    const trendBlock = trendTopics.length
      ? (isRR
          ? '\nTENDÊNCIAS EM ALTA AGORA (encaixe 1-2 destes temas ao longo do mês, adaptando à voz da marca pessoal — pode virar carrossel, frase, lofi ou vídeo):\n' + trendTopics.map((t, i) => (i + 1) + '. ' + t.gancho + ' [termo: ' + t.termo + ']').join('\n') + '\n'
          : '\nTENDÊNCIAS EM ALTA AGORA (use como tópicos do tipo "tendencia" distribuídos ao longo do mês):\n' + trendTopics.map((t, i) => (i + 1) + '. ' + t.gancho + ' [termo: ' + t.termo + ']').join('\n') + '\n')
      : '';

    const proporcaoBlock = isRR
      ? '\nPROPORÇÃO RECOMENDADA Metodologia RR (distribuir ao longo do mês):\n- 30% carrossel (educação e profundidade)\n- 20% lofi ou video (conexão direta com a câmera)\n- 20% aproveitando as TENDÊNCIAS listadas acima quando disponíveis, adaptadas ao tom da marca\n- 15% frase (verdade concentrada, alto alcance)\n- 15% dump ou bastidores (autenticidade e relacionamento)\n'
      : '\nPROPORÇÃO RECOMENDADA BrandsDecoded (distribuir ao longo do mês):\n- 35% educativo (conteúdo de autoridade, ensina algo prático)\n- 20% tendencia (use os tópicos de tendência listados acima quando disponíveis)\n- 15% case (resultado real de cliente ou negócio)\n- 15% lista (conteúdo de alcance, shareável)\n- 10% comparacao (antes/depois, certo/errado)\n- 5% prova_social ou oferta\n';

    const BLOCK = 10;
    const allDays = [];
    for (let blockStart = 1; blockStart <= daysInMonth; blockStart += BLOCK) {
      const blockEnd = Math.min(blockStart + BLOCK - 1, daysInMonth);
      const daysInBlock = blockEnd - blockStart + 1;
      const brandContext = isRR
        ? 'PERFIL: ' + account.name + ' (' + account.handle + ') — MARCA PESSOAL, Metodologia RR.'
        : 'PERFIL: ' + account.name + ' (' + account.handle + ') — MARCA CORPORATIVA, BrandsDecoded.\nTIPOS: ' + tiposLabels;
      const examplePosts = postsPerDay === 1
        ? (isRR ? '[{"time":"09:00","type":"lofi","topic":"Por que a maioria das pessoas sabota o próprio crescimento"}]' : '[{"time":"09:00","type":"educativo","topic":"Por que 90% das empresas param de crescer quando o dono para de aparecer"}]')
        : (isRR ? '[{"time":"09:00","type":"carrossel","topic":"A mentira que o Instagram vende sobre consistência"},{"time":"18:00","type":"frase","topic":"Você não precisa de motivação, precisa de estrutura"}]' : '[{"time":"09:00","type":"educativo","topic":"O erro que faz donos de negócio trabalharem mais e faturarem menos"},{"time":"18:00","type":"tendencia","topic":"O que está mudando no comportamento do consumidor brasileiro em 2026"}]');
      const blockPrompt = 'Você é estrategista de conteúdo para Instagram. Crie o calendário editorial para ' + account.name + ' — ' + month + '/' + year + '.\n\n' + brandContext + '\n' + (manualNote ? 'DIRETRIZES DO PERFIL:\n' + manualNote + '\n\n' : '') + trendBlock + proporcaoBlock + 'TIPOS DISPONÍVEIS: ' + tiposDisponiveis + '\n\nREGRAS DO TOPIC: Topics devem ser específicos, com ângulo concreto e linguagem de dono de negócio real (sem jargão técnico).\nHORÁRIOS: use 09:00 para manhã e 18:00 para tarde/noite.\n\nRESPONDA APENAS COM JSON VÁLIDO, SEM MARKDOWN.\n\nFormato EXATO:\n{\n  "days": [\n    {"day": ' + blockStart + ', "posts": ' + examplePosts + '}\n  ]\n}\n\nGere TODOS os dias de ' + blockStart + ' a ' + blockEnd + ' (total: ' + daysInBlock + ' dias, ' + postsPerDay + ' post(s) por dia).';
      const blockRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 4000, messages: [{ role: 'user', content: blockPrompt }] }),
      });
      const blockData = await blockRes.json();
      if (blockData.error) throw new Error('Claude API: ' + blockData.error.message);
      const rawText = blockData.content[0].text.trim();
      let blockDays = [];
      try { const parsed = extractJSON(rawText); blockDays = normalizeDays(parsed); }
      catch(parseErr) { for (let d = blockStart; d <= blockEnd; d++) blockDays.push({ day: d, posts: [] }); }
      allDays.push(...blockDays);
    }
    const generated = readJSON(GENERATED_FILE).filter(g => g.profile === profile);
    const calendarDays = allDays.map(dayEntry => {
      const dayNum = Number(dayEntry.day);
      const posts  = Array.isArray(dayEntry.posts) ? dayEntry.posts : [];
      return {
        day: dayNum,
        posts: posts.map(post => {
          const topic = (post.topic || post.tema || '').trim();
          const type  = post.type || post.tipo || (isRR ? 'carrossel' : 'educativo');
          const time  = post.time || post.horario || '09:00';
          const match = generated.find(g => g.calendarDay === dayNum && g.calendarMonth === month && g.calendarYear === year);
          return { time, type, topic, date: year + '-' + String(month).padStart(2,'0') + '-' + String(dayNum).padStart(2,'0'), contentId: match?.id || null, status: match?.status || 'pendente', scheduledAt: match?.scheduledAt || null };
        }),
      };
    });
    const totalPosts = calendarDays.reduce((acc, d) => acc + d.posts.length, 0);
    if (totalPosts === 0) throw new Error('A IA retornou calendário sem posts. Tenta novamente.');
    writeJSON(CALENDAR_FILE, { profile, month, year, calendar: calendarDays, savedAt: new Date().toISOString() });
    if (supabase) {
      await supabase.from('calendars').upsert({ id: profile + '_' + year + '_' + month, profile, month: parseInt(month), year: parseInt(year), data: JSON.stringify(calendarDays), updated_at: new Date().toISOString() }, { onConflict: 'id' });
    }
    res.json({ calendar: calendarDays });
  } catch(err) { console.error('[Calendar] Erro:', err); res.status(500).json({ error: err.message }); }
});

// Gera calendário SEMANAL
app.post('/api/calendar/generate-week', async (req, res) => {
  try {
    const { weekStart, profile, postsPerDay = 1 } = req.body;
    // weekStart = "2026-06-09" (segunda-feira da semana)
    const startDate = new Date(weekStart + 'T12:00:00Z');
    const { isRR, tipos } = getMetodologia(profile);
    const manualNote = getManualText(profile);
    const account    = getAccount(profile);
    const tiposDisponiveis = Object.values(tipos).map(t => t.id).join(' | ');
    const weekDays = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(startDate); d.setUTCDate(startDate.getUTCDate() + i);
      weekDays.push({ date: d.toISOString().slice(0,10), dayOfWeek: ['Segunda','Terça','Quarta','Quinta','Sexta','Sábado','Domingo'][i] });
    }
    const daysText = weekDays.map(d => d.dayOfWeek + ' ' + d.date).join(', ');

    // Busca tendências para todos os perfis (pessoal e corporativo)
    const weekTrendTopics = await getTrendsForCalendar(profile);
    const weekTrendBlock = weekTrendTopics.length
      ? (isRR
          ? '\nTENDÊNCIAS EM ALTA AGORA (encaixe 1-2 como tópico da semana, adaptando à voz da marca pessoal — carrossel, frase, lofi ou vídeo):\n' + weekTrendTopics.map((t, i) => (i + 1) + '. ' + t.gancho + ' [termo: ' + t.termo + ']').join('\n') + '\n'
          : '\nTENDÊNCIAS EM ALTA AGORA (use 1-2 como tópico do tipo "tendencia" na semana):\n' + weekTrendTopics.map((t, i) => (i + 1) + '. ' + t.gancho + ' [termo: ' + t.termo + ']').join('\n') + '\n')
      : '';
    const weekProporcaoBlock = isRR
      ? '\nPROPORÇÃO SEMANAL Metodologia RR: priorize carrossel (profundidade) + 1 lofi/video (conexão) + 1 tema aproveitando as tendências acima quando disponíveis + 1 frase ou dump. Mantém o tom íntimo e real da marca.\n'
      : '\nPROPORÇÃO SEMANAL BrandsDecoded: priorize educativo (autoridade) + 1 tendencia (usando os tópicos acima se disponíveis) + 1 lista ou case. Evite mais de 1 oferta por semana.\n';

    const examplePost = isRR ? '{"time":"09:00","type":"lofi","topic":"Tema específico aqui"}' : '{"time":"09:00","type":"educativo","topic":"Tema específico aqui"}';
    const prompt = 'Você é estrategista de conteúdo para ' + account.name + ' (' + account.handle + ').\n\n' + (manualNote ? 'DIRETRIZES:\n' + manualNote + '\n\n' : '') + weekTrendBlock + weekProporcaoBlock + 'TIPOS DISPONÍVEIS: ' + tiposDisponiveis + '\n\nCrie um plano editorial para a semana: ' + daysText + '\n' + postsPerDay + ' post(s) por dia. Topics devem ser específicos com linguagem de dono de negócio real.\n\nRESPONDA APENAS JSON VÁLIDO:\n{"days":[{"date":"2026-06-09","dayOfWeek":"Segunda","posts":[' + examplePost + ']}]}';
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 3000, messages: [{ role: 'user', content: prompt }] }),
    });
    const d = await r.json();
    if (d.error) throw new Error(d.error.message);
    const parsed = extractJSON(d.content[0].text.trim());
    const days = parsed.days || [];
    if (!days.length) throw new Error('IA retornou sem dias. Tente novamente.');
    res.json({ week: days, weekStart });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/calendar/saved', async (req, res) => {
  try {
    const { profile, month, year, calendar } = req.body;
    if (!profile || !month || !year || !calendar) return res.status(400).json({ error: 'Faltam campos.' });
    writeJSON(CALENDAR_FILE, { profile, month, year, calendar, savedAt: new Date().toISOString() });
    if (supabase) {
      await supabase.from('calendars').upsert({ id: profile + '_' + year + '_' + month, profile, month: parseInt(month), year: parseInt(year), data: JSON.stringify(calendar), updated_at: new Date().toISOString() }, { onConflict: 'id' });
    }
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/calendar/saved', async (req, res) => {
  try {
    const { profile, month, year } = req.query;
    if (supabase) {
      const { data, error } = await supabase.from('calendars').select('data, updated_at').eq('id', profile + '_' + year + '_' + month).single();
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
  } catch(e) { res.json({ found: false }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// CAROUSEL GENERATE AND SAVE
// ═══════════════════════════════════════════════════════════════════════════

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
Converte estes blocos em slides de carrossel. Para cada bloco, gera um heading curto e direto + um body com 2-3 frases que desenvolvem o conceito com substância real (dado concreto, explicação, exemplo ou consequência prática). NUNCA deixar body vazio.

BLOCOS:
${blocks}

JSON: {"title":"título do carrossel","slideCount":N,"slides":[{"slideNumber":1,"funcao":"CAPA","heading":"título curto e impactante","body":"2-3 frases que desenvolvem o conceito com substância real. Inclui dado, explicação ou consequência concreta.","imagePrompt":"visual scene in english"}],"caption":"legenda completa com emojis e CTA","hashtags":"máximo 4 hashtags específicas"}`;
    } else {
      const slideCount = isRR ? '7-8' : '10';
      prompt = `Perfil: ${account.name} (${account.handle})
Tema: "${topic}"
Total: ${slideCount} slides.
${isRR ? 'ESTRUTURA RR: Slide 1 (gancho que nomeia dor/desejo real) → slides de profundidade → conclusão com tese → CTA íntimo.' : 'ESTRUTURA BRANDSDECODED: Slide 1 (hook 14-18 palavras) → desenvolvimento estratégico → CTA com assinatura.'}

REGRA CRÍTICA: cada slide DEVE ter body com 2-3 frases de conteúdo real — dado concreto, explicação do conceito, exemplo prático ou consequência. NUNCA body vazio ou com menos de 2 frases.

JSON: {"title":"título do carrossel","slideCount":${isRR?8:10},"slides":[{"slideNumber":1,"funcao":"CAPA","heading":"gancho de 14-18 palavras","body":"2-3 frases que desenvolvem o gancho com substância. Dado concreto, padrão de mercado real ou consequência.","imagePrompt":"visual scene in english"},{"slideNumber":2,"funcao":"DESENVOLVIMENTO","heading":"título do conceito","body":"2-3 frases explicando o conceito com dado ou exemplo concreto. O leitor deve aprender algo real neste slide.","imagePrompt":"visual scene in english"}],"caption":"legenda completa com emojis e CTA","hashtags":"máximo 4 hashtags específicas ao nicho"}`;
    }
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 8192, system: systemPrompt, messages: [{ role: 'user', content: prompt }] }),
    });
    const d = await r.json();
    if (d.error) return res.status(500).json({ error: d.error.message });
    const carouselData = extractJSON(d.content[0].text.trim());
    function sanitizeCopy(text) { if (!text) return text; return text.replace(/\s*—\s*/g, ' ').replace(/\s*–\s*/g, ' ').replace(/^\s*[–—]\s*/gm, '').trim(); }
    if (carouselData.slides) { carouselData.slides = carouselData.slides.map(s => ({ ...s, heading: sanitizeCopy(s.heading), body: sanitizeCopy(s.body) })); }
    if (carouselData.hashtags) { const tags = carouselData.hashtags.match(/#[\wÀ-ɏ]+/g) || []; carouselData.hashtags = tags.slice(0, 4).join(' '); }
    const item = saveGeneratedContent({ id: 'cnt_' + Date.now(), createdAt: new Date().toISOString(), status: 'pendente', type: 'carrossel', mode, profile, topic: topic || ('Carrossel ' + carouselData.slideCount + ' slides'), caption: caption || carouselData.caption, hashtags: hashtags || carouselData.hashtags, contentMachineType: contentMachineType || null, carouselData, calendarDay: calendarDay || null, calendarMonth: calendarMonth || null, calendarYear: calendarYear || null, imageUrls: [], metodologia: isRR ? 'rr' : 'brandsdecoded' });
    res.json({ success: true, contentId: item.id, ...carouselData });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// CONTENT MACHINE
// ═══════════════════════════════════════════════════════════════════════════

function normalizeSlidesFromGPT(parsed, fallbackTema) {
  let rawSlides = parsed.slides || parsed.blocos || parsed.cards || parsed.content || [];
  if (!Array.isArray(rawSlides) || rawSlides.length === 0) {
    for (const key of Object.keys(parsed)) { if (Array.isArray(parsed[key]) && parsed[key].length > 2) { rawSlides = parsed[key]; break; } }
  }
  return rawSlides.map((s, idx) => {
    const num = s.slide || s.slideNumber || s.numero || (idx + 1);
    let textos = [];
    if (Array.isArray(s.textos) && s.textos.length > 0) { textos = s.textos; }
    else if (Array.isArray(s.texts) && s.texts.length > 0) { textos = s.texts.map(t => ({ tipo: t.type||t.tipo||'texto', texto: typeof t==='string'?t:(t.text||t.texto||'') })); }
    else { const heading = s.heading||s.titulo||s.title||s.hook||s.gancho||s.texto||''; const body = s.body||s.corpo||s.content||s.conteudo||s.subtitulo||''; if (heading) textos.push({ posicao:1, tipo:'hook', texto:heading }); if (body) textos.push({ posicao:2, tipo:'paragrafo', texto:body }); }
    if (textos.length === 0) textos.push({ posicao:1, tipo:'texto', texto:'Slide '+num });
    return { slideNumber: Number(num), funcao: s.funcao||s.label||s.role||(idx===0?'CAPA':idx===rawSlides.length-1?'CTA':'DESENVOLVIMENTO'), heading: textos[0]?.texto||'', body: textos[1]?.texto||'', textos };
  });
}

const TIPOS_VIDEO_RR_SERVER = ['lofi', 'video_curto', 'video_medio'];

function buildPromptRoteiro(tipo, tema, account, tipoInfo, manualNote, brand) {
  const ctaFixo = account.handle === '@analuisa.moutinho' ? 'salva pra reler quando esquecer disso. e me diz nos comentários se isso fez sentido pra você.' : 'salva esse conteúdo e me conta nos comentários o que mais fez sentido pra você.';
  const estruturas = { lofi: 'ESTRUTURA LO-FI: GANCHO (0-3s) → DESENVOLVIMENTO → CONCLUSÃO/TESE → CTA: "' + ctaFixo + '"', video_curto: 'ESTRUTURA VÍDEO CURTO (até 13s): UMA ÚNICA SACADA. Máximo 2-3 frases.', video_medio: 'ESTRUTURA VÍDEO MÉDIO (até 60s): GANCHO (0-5s) → DESENVOLVIMENTO (5-50s) → CONCLUSÃO + CTA (50-60s)' };
  const systemPrompt = 'Você é roteirista de conteúdo para Instagram da ' + account.name + ' — marca pessoal, Metodologia RR.\n\nNUNCA usar: motivacional genérico, guru, coach, desbloqueie, seja sua melhor versão.\n' + (brand.copyDNA || '') + '\n' + (manualNote ? '\nDIRETRIZES DO PERFIL:\n' + manualNote + '\n' : '') + '\nTIPO: ' + tipoInfo.emoji + ' ' + tipoInfo.label + '\n' + (estruturas[tipo] || '') + '\n\nRetornar APENAS JSON valido, sem markdown.';
  const userPrompt = 'Perfil: ' + account.name + ' (' + account.handle + ')\nTema: "' + tema + '"\nTipo: ' + tipoInfo.label + '\n\nJSON:\n{"tipo":"' + tipo + '","tipo_label":"' + tipoInfo.label + '","tema":"' + tema + '","isRoteiro":true,"duracao_estimada":"ex: 45-55 segundos","gancho":"primeira frase exata a ser dita na câmera","blocos":[{"id":1,"label":"GANCHO","tempo":"0-5s","texto":"...","nota_direcao":"..."},{"id":2,"label":"DESENVOLVIMENTO","tempo":"5-40s","texto":"...","nota_direcao":"..."},{"id":3,"label":"CONCLUSÃO","tempo":"40-55s","texto":"...","nota_direcao":"..."},{"id":4,"label":"CTA","tempo":"55-60s","texto":"' + ctaFixo + '","nota_direcao":"falar com intimidade"}],"dicas_gravacao":["dica específica"],"legenda_sugerida":"legenda com emojis, máximo 4 hashtags"}';
  return { systemPrompt, userPrompt };
}

app.post('/api/content-machine/generate', async (req, res) => {
  try {
    const { tipo, tema, profile } = req.body;
    if (!tipo || !tema) return res.status(400).json({ error: 'Faltam campos: tipo e tema.' });
    const { isRR, tipos, metodologia } = getMetodologia(profile);
    const account = getAccount(profile);
    const brand   = BRAND_IDENTITIES[profile] || BRAND_IDENTITIES.marca;
    if (!tipos[tipo]) return res.status(400).json({ error: 'Tipo "' + tipo + '" não disponível. Disponíveis: ' + Object.keys(tipos).join(', ') });
    const tipoInfo   = tipos[tipo];
    const manualNote = getManualText(profile);
    const isVideo    = isRR && TIPOS_VIDEO_RR_SERVER.includes(tipo);
    if (isVideo) {
      const { systemPrompt, userPrompt } = buildPromptRoteiro(tipo, tema, account, tipoInfo, manualNote, brand);
      const response = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.OPENAI_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'gpt-4o', temperature: 1.0, max_tokens: 3000, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }] }) });
      const data = await response.json();
      if (data.error) return res.status(500).json({ error: data.error.message });
      const parsed = extractJSON(data.choices[0].message.content.trim());
      const item = saveGeneratedContent({ id: 'cnt_' + Date.now(), createdAt: new Date().toISOString(), status: 'pendente', type: 'reels', contentMachineType: tipo, contentMachineTypeLabel: tipoInfo.label, profile, topic: tema, imageUrls: [], metodologia: 'rr', isRoteiro: true, roteiroData: parsed });
      return res.json({ success: true, contentId: item.id, isRoteiro: true, ...parsed });
    }
    const systemPrompt = buildSystemPromptContentMachine(profile, tipo, metodologia, isRR);
    const ctaFixo = account.handle === '@analuisa.moutinho' ? 'salva pra reler quando esquecer disso.' : 'Gostou? Comente CASE que nossa equipe te chama.';
    const tipoInfo2 = isRR ? tipoInfo : tipoInfo;
    const instrucaoEstrutura = isRR ? 'INSTRUÇÃO: ' + tipoInfo.instrucao + '\nESTRUTURA RR: Slide 1 (gancho dor/desejo) → profundidade → conclusão → CTA íntimo.' : 'INSTRUÇÃO: ' + tipoInfo.instrucao + '\nESTRUTURA BD: Slide 1 (hook 14-18 palavras) → frameworks/dados → CTA assinatura.';
    const userPrompt = 'Tipo: ' + tipoInfo.label + '\nPerfil: ' + account.name + ' (' + account.handle + ')\nTema: "' + tema + '"\n\n' + instrucaoEstrutura + '\n\nJSON:\n{"tipo":"' + tipo + '","tipo_label":"' + tipoInfo.label + '","tema":"' + tema + '","profile":"' + profile + '","metodologia":"' + (isRR?'rr':'brandsdecoded') + '","isRoteiro":false,"slides":[{"slide":1,"funcao":"CAPA","textos":[{"posicao":1,"tipo":"hook","texto":"..."},{"posicao":2,"tipo":"sub-hook","texto":"..."}]},{"slide":2,"funcao":"DESENVOLVIMENTO","textos":[{"posicao":3,"tipo":"titulo","texto":"..."},{"posicao":4,"tipo":"paragrafo","texto":"..."}]},{"slide":8,"funcao":"CTA","textos":[{"posicao":15,"tipo":"cta","texto":"' + ctaFixo + '"}]}]}';
    const response = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.OPENAI_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'gpt-4o', temperature: 1.0, max_tokens: 4500, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }] }) });
    const data = await response.json();
    if (data.error) return res.status(500).json({ error: data.error.message });
    const parsed = extractJSON(data.choices[0].message.content.trim());
    const slidesNorm = normalizeSlidesFromGPT(parsed, tema);
    if (slidesNorm.length === 0) return res.status(500).json({ error: 'A IA não retornou slides válidos. Tente novamente com um tema mais específico.' });
    const item = saveGeneratedContent({ id: 'cnt_' + Date.now(), createdAt: new Date().toISOString(), status: 'pendente', type: 'carrossel', contentMachineType: tipo, contentMachineTypeLabel: tipoInfo.label, profile, topic: tema, imageUrls: [], metodologia: isRR ? 'rr' : 'brandsdecoded', isRoteiro: false, carouselData: { title: tema, slideCount: slidesNorm.length, slides: slidesNorm, caption: '', hashtags: '' } });
    res.json({ success: true, contentId: item.id, isRoteiro: false, ...parsed, slidesNormalizados: slidesNorm });
  } catch(err) { console.error('Content Machine error:', err); res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// TENDÊNCIAS
// ═══════════════════════════════════════════════════════════════════════════

const NICHE_CONFIG = { marca: 'empreendedorismo, gestão de negócios, faturamento, operação, equipe, expansão, delivery, e-commerce, negócio local, franquia, pequenas e médias empresas, liderança empresarial, fluxo de caixa, precificação, atendimento ao cliente', pessoal: 'marca pessoal, carreira, comportamento humano, produtividade, mulheres empreendedoras, estilo de vida', virttus: 'tecnologia, inteligência artificial, transformação digital, software B2B, dados, cibersegurança' };
const trendsCache = {};
const TRENDS_TTL  = 60 * 60 * 1000;

function parseGoogleTrendsRSS(xml) {
  const items = []; const itemRx = /<item>([\s\S]*?)<\/item>/g; let m;
  while ((m = itemRx.exec(xml)) !== null) {
    const block = m[1]; const title = (/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/.exec(block) || /<title>([\s\S]*?)<\/title>/.exec(block) || [])[1] || ''; const traffic = (/<ht:approx_traffic>([\s\S]*?)<\/ht:approx_traffic>/.exec(block) || [])[1] || '';
    const t = title.replace(/&amp;/g,'&').replace(/&#39;/g,"'").trim(); if (t) items.push({ termo: t, volume: traffic.trim(), fonte: 'Google Trends' });
  }
  return items;
}

async function getGoogleTrends() {
  try {
    const r = await fetch('https://trends.google.com/trends/trendingsearches/daily/rss?geo=BR', { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36', 'Accept': 'application/rss+xml,*/*', 'Accept-Language': 'pt-BR,pt;q=0.9' }, signal: AbortSignal.timeout(12000) });
    if (r.ok) { const xml = await r.text(); const items = parseGoogleTrendsRSS(xml); if (items.length > 0) return items.slice(0, 20); }
  } catch(e) { console.warn('[Trends] RSS failed:', e.message); }
  try {
    const month = new Date().toLocaleDateString('pt-BR', {month:'long', year:'numeric'});
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 900, messages: [{ role: 'user', content: 'Liste 15 assuntos muito comentados no Brasil em ' + month + '. Variedade: entretenimento, esportes, politica, economia, tecnologia, comportamento. SOMENTE JSON array: [{"termo":"nome","volume":"tendencia","fonte":"Estimativa IA"}]' }] }) });
    const aiData = await aiRes.json();
    if (aiData.content?.[0]) { const txt = aiData.content[0].text.trim(); const m2 = txt.match(/\[[\s\S]+\]/); if (m2) return JSON.parse(m2[0]).slice(0, 15); }
  } catch(e2) { console.warn('[Trends] Fallback failed:', e2.message); }
  return [];
}

app.get('/api/trends', async (req, res) => {
  try {
    const { profile = 'marca', refresh } = req.query;
    const now = Date.now();
    if (refresh !== 'true' && trendsCache[profile] && (now - trendsCache[profile].ts) < TRENDS_TTL) return res.json({ ...trendsCache[profile].data, cached: true });
    const account    = getAccount(profile);
    const nicho      = NICHE_CONFIG[profile] || NICHE_CONFIG.marca;
    const manualNote = getManualText(profile);
    const googleTrends = await getGoogleTrends();
    if (!googleTrends.length) return res.json({ trends: [], updatedAt: new Date().toISOString(), warning: 'Nenhuma fonte de tendências disponível neste momento.' });
    const termosList = googleTrends.map((t, i) => (i + 1) + '. [' + t.fonte + '] ' + t.termo + (t.volume ? ' (' + t.volume + ')' : '')).join('\n');
    const prompt = 'Você é estrategista de conteúdo para ' + account.name + '.\nNicho: ' + nicho + '.\n' + (manualNote ? 'Contexto:\n' + manualNote + '\n' : '') + 'Termos em alta agora no Brasil:\n\n' + termosList + '\n\nIdentifique os 6 termos mais relevantes para o nicho. JSON:\n{"trends":[{"termo":"...","fonte":"Google Trends","volume":"...","relevancia":"por que é oportuno (1 frase)","angulo":"como transformar em pauta (2 frases)","tipo_ideal":"carrossel | post | reels","gancho":"headline pronta para usar","urgencia":"alta | media | baixa"}]}';
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 2800, messages: [{ role: 'user', content: prompt }] }) });
    const aiData = await aiRes.json();
    if (aiData.error) throw new Error(aiData.error.message);
    const parsed = extractJSON(aiData.content[0].text.trim());
    const result = { trends: parsed.trends || [], updatedAt: new Date().toISOString(), fontes: { google: googleTrends.length > 0 } };
    trendsCache[profile] = { data: result, ts: now };
    res.json(result);
  } catch(err) { console.error('[Trends]', err); res.status(500).json({ error: err.message }); }
});

// Busca e filtra tendências para uso no calendário (sem cache, chamada interna)
async function getTrendsForCalendar(profile) {
  try {
    const account  = getAccount(profile);
    const nicho    = NICHE_CONFIG[profile] || NICHE_CONFIG.marca;
    const manualNote = getManualText(profile);
    const googleTrends = await getGoogleTrends();
    if (!googleTrends.length) return [];
    const termosList = googleTrends.map((t, i) => (i + 1) + '. ' + t.termo + (t.volume ? ' (' + t.volume + ')' : '')).join('\n');
    const prompt = 'Você é estrategista de conteúdo para ' + account.name + '.\nNicho: ' + nicho + '.\n' + (manualNote ? 'Contexto:\n' + manualNote + '\n' : '') + 'Termos em alta agora no Brasil:\n\n' + termosList + '\n\nSelecione os 4 termos mais relevantes para o nicho e gere ganchos prontos. JSON APENAS:\n{"trends":[{"termo":"...","gancho":"headline de 12-16 palavras pronta para usar como tópico no calendário","tipo":"tendencia"}]}';
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1200, messages: [{ role: 'user', content: prompt }] }) });
    const aiData = await aiRes.json();
    if (aiData.content?.[0]) {
      const parsed = extractJSON(aiData.content[0].text.trim());
      return (parsed.trends || []).slice(0, 4);
    }
  } catch(e) { console.warn('[TrendsForCalendar]', e.message); }
  return [];
}

// ═══════════════════════════════════════════════════════════════════════════
// CANVA TEMPLATES
// ═══════════════════════════════════════════════════════════════════════════

const CANVA_TEMPLATES_FILE = '/tmp/canva_templates.json';
const DEFAULT_CANVA_TEMPLATES = [
  { id: 'tmpl_default_001', createdAt: '2026-06-14T00:00:00.000Z', name: 'Posts Estáticos - Chamada em Destaque [Handwriting]', contentTypes: ['frase'], aesthetic: 'Handwriting, chamada de atenção em destaque, estilo manuscrito', slideCount: 1, canvaUrl: 'https://www.canva.com/design/DAHL5Modgyc/vEEcxRj9jnHi4dFKqSm_pA/edit', profile: 'all' },
  { id: 'tmpl_default_002', createdAt: '2026-06-14T00:00:00.000Z', name: 'Posts Estáticos [Sublime]', contentTypes: ['frase'], aesthetic: 'Elegante, minimalista, identidade visual sóbria', slideCount: 1, canvaUrl: 'https://www.canva.com/design/DAHL5R5kU2Y/xIyRwYXAdmFCqKaYiw3dYA/edit', profile: 'all' },
  { id: 'tmpl_default_003', createdAt: '2026-06-14T00:00:00.000Z', name: 'Post Carrossel - Recomendações', contentTypes: ['carrossel', 'lista'], aesthetic: 'Carrossel de indicações e recomendações', slideCount: 178, canvaUrl: 'https://www.canva.com/design/DAHL5TqhKyI/etk6efSME5DhFwZ4hgdDuw/edit', profile: 'all' },
  { id: 'tmpl_default_004', createdAt: '2026-06-14T00:00:00.000Z', name: 'Post Carrossel [Flow]', contentTypes: ['carrossel'], aesthetic: 'Estilo Flow, fluido e moderno', slideCount: 47, canvaUrl: 'https://www.canva.com/design/DAHMlM5WCeE/NRbPJN3Jh8i3pp0ZeFENA/edit', profile: 'all' },
  { id: 'tmpl_default_005', createdAt: '2026-06-14T00:00:00.000Z', name: 'Post Carrossel [StudioMoulin]', contentTypes: ['carrossel'], aesthetic: 'Estilo StudioMoulin, editorial sofisticado', slideCount: 67, canvaUrl: 'https://www.canva.com/design/DAHMlGdvovg/OKFiMiynrALoa53TnTlrnQ/edit', profile: 'all' },
  { id: 'tmpl_default_006', createdAt: '2026-06-14T00:00:00.000Z', name: 'Posts Sobre Mim [Lifestyle]', contentTypes: ['bastidores', 'dump'], aesthetic: 'Lifestyle, conteúdo pessoal, autêntico e íntimo', slideCount: 86, canvaUrl: 'https://www.canva.com/design/DAHL5N_tvhA/7MZi0VRLPp3QdXBEklwYVw/edit', profile: 'all' },
  { id: 'tmpl_default_007', createdAt: '2026-06-14T00:00:00.000Z', name: 'Posts Variados [Flow]', contentTypes: ['carrossel', 'frase'], aesthetic: 'Estilo Flow, versátil e dinâmico', slideCount: 18, canvaUrl: 'https://www.canva.com/design/DAHMlDU5T9U/edit', profile: 'all' },
  { id: 'tmpl_default_008', createdAt: '2026-06-14T00:00:00.000Z', name: 'Post para Frase [StudioMoulin]', contentTypes: ['frase'], aesthetic: 'Estilo StudioMoulin, elegante para frases e citações', slideCount: 22, canvaUrl: 'https://www.canva.com/design/DAHMlPnisuI/E7t-QxVHNLMOSxIAQ6oMiw/edit', profile: 'all' },
  { id: 'tmpl_default_009', createdAt: '2026-06-14T00:00:00.000Z', name: 'Capa para Photodump', contentTypes: ['dump'], aesthetic: 'Capa criativa para posts estilo photodump', slideCount: 87, canvaUrl: 'https://www.canva.com/design/DAHL5RVJ-ug/o_RsgOzgY8HsDubf1vnAOQ/edit', profile: 'all' }
];
function loadCT() {
  try {
    if (!fs.existsSync(CANVA_TEMPLATES_FILE)) {
      fs.writeFileSync(CANVA_TEMPLATES_FILE, JSON.stringify(DEFAULT_CANVA_TEMPLATES, null, 2));
      return DEFAULT_CANVA_TEMPLATES;
    }
    const data = JSON.parse(fs.readFileSync(CANVA_TEMPLATES_FILE, 'utf8'));
    if (!data.length) { fs.writeFileSync(CANVA_TEMPLATES_FILE, JSON.stringify(DEFAULT_CANVA_TEMPLATES, null, 2)); return DEFAULT_CANVA_TEMPLATES; }
    return data;
  } catch(e) { return DEFAULT_CANVA_TEMPLATES; }
}
function saveCT(t) { try { fs.writeFileSync(CANVA_TEMPLATES_FILE, JSON.stringify(t, null, 2)); } catch(e) {} }
app.get('/api/canva/templates', (req, res) => { let t = loadCT(); if (req.query.profile) t = t.filter(x => !x.profile || x.profile === req.query.profile || x.profile === 'all'); res.json(t); });
app.post('/api/canva/templates', (req, res) => { const t = loadCT(); const n = { id: 'tmpl_' + Date.now(), createdAt: new Date().toISOString(), ...req.body }; t.unshift(n); saveCT(t); res.json({ success: true, template: n }); });
app.patch('/api/canva/templates/:id', (req, res) => { const t = loadCT(); const i = t.findIndex(x => x.id === req.params.id); if (i === -1) return res.status(404).json({ error: 'nao encontrado' }); t[i] = { ...t[i], ...req.body, id: req.params.id }; saveCT(t); res.json({ success: true, template: t[i] }); });
app.delete('/api/canva/templates/:id', (req, res) => { saveCT(loadCT().filter(x => x.id !== req.params.id)); res.json({ success: true }); });
app.post('/api/canva/match', async (req, res) => {
  try {
    const { contentId, tipo, tema, slides, legenda, profile } = req.body;
    const templates = loadCT().filter(t => !t.profile || t.profile === profile || t.profile === 'all');
    if (!templates.length) return res.json({ matches: [], message: 'Nenhum template cadastrado.' });
    const templateList = templates.map((t, i) => (i+1) + '. ID: ' + t.id + '\n   Nome: ' + t.name + '\n   Tipos: ' + (Array.isArray(t.contentTypes)?t.contentTypes.join(', '):t.contentTypes||'geral') + '\n   Estetica: ' + (t.aesthetic||'-') + '\n   Slides: ' + (t.slideCount||'?')).join('\n\n');
    const slidesResumo = Array.isArray(slides) ? slides.slice(0,3).map((s,i)=>'  Slide '+(i+1)+' ['+( s.funcao||'')+'] : "'+( s.heading||'').slice(0,60)+'"').join('\n') : '';
    const prompt = 'Perfil: ' + profile + '\nTipo: ' + (tipo||'carrossel') + '\nTema: ' + tema + '\nSlides:\n' + slidesResumo + '\n\nTemplates:\n' + templateList + '\n\nSeleciona os 3 mais adequados. JSON: {"matches":[{"templateId":"tmpl_xxx","score":95,"reason":"1 frase","fitLabel":"Perfeito","fieldMapping":{"headline":"texto slide 1"}}]}';
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: {'x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01','Content-Type':'application/json'}, body: JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:1200,messages:[{role:'user',content:prompt}]}) });
    const d = await r.json(); if (d.error) throw new Error(d.error.message);
    const raw = d.content[0].text.trim(); const jm = raw.match(/\{[\s\S]*\}/); const parsed = jm ? JSON.parse(jm[0]) : { matches: [] };
    const enriched = (parsed.matches||[]).map(m => { const tmpl = templates.find(t=>t.id===m.templateId); return tmpl ? {...m, template:tmpl} : null; }).filter(Boolean);
    res.json({ matches: enriched });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/canva/prepare-texts', (req, res) => {
  try {
    const { slides=[], legenda='', hashtags='', templateId, fieldMapping={} } = req.body;
    const templates = loadCT(); const tmpl = templates.find(t=>t.id===templateId);
    const lines = [];
    if (Object.keys(fieldMapping).length > 0) { Object.entries(fieldMapping).forEach(([f,v])=>lines.push('[ ' + f.toUpperCase() + ' ]\n' + v)); }
    else { slides.forEach((s,i)=>{ if(s.heading)lines.push('[ SLIDE ' + (i+1) + ' TITULO ]\n' + s.heading); if(s.body)lines.push('[ SLIDE ' + (i+1) + ' CORPO ]\n' + s.body); }); }
    if (legenda) lines.push('[ LEGENDA ]\n' + legenda); if (hashtags) lines.push('[ HASHTAGS ]\n' + hashtags);
    const fullText = lines.join('\n\n──────────\n\n');
    const structured = slides.map((s,i)=>({slideNumber:i+1,funcao:s.funcao||'',fields:[s.heading?{label:'Titulo',value:s.heading,key:'slide'+(i+1)+'_heading'}:null,s.body?{label:'Corpo',value:s.body,key:'slide'+(i+1)+'_body'}:null].filter(Boolean)}));
    res.json({ success:true, clipboardText:fullText, structured, canvaUrl:tmpl&&tmpl.canvaUrl||null, templateName:tmpl&&tmpl.name||'Template' });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── Health ────────────────────────────────────────────────────────────────

// Geracao de imagem por slide (GPT Image-1)
// Aceita referenceImageB64 (base64 sem prefixo) para usar a foto real do Google Fotos como base
app.post('/api/image/carousel-slide', async (req, res) => {
  try {
    const { heading, body, slideNumber, totalSlides, funcao, topic, profile, contentId, imagePromptHint, designStyleHint, quality: rawQuality, referenceImageB64, engine } = req.body;
    if (engine === 'none') return res.json({ success: true, b64: null, url: null, designMeta: {}, quality: 'none' });
    const quality = resolveQuality(rawQuality);
    const brand = BRAND_IDENTITIES[profile] || BRAND_IDENTITIES.marca;
    const account = getAccount(profile);
    const sceneHint = imagePromptHint || topic || '';
    const promptPhoto = buildCarouselPrompt({
      quality,
      brand,
      aestheticOverride: designStyleHint || null,
      slideRole: funcao,
      heading, body,
      slideNumber: slideNumber || 1,
      totalSlides: totalSlides || 1,
      sceneHint,
    });
    const moodList = brand.moods || ['HERO_DARK'];
    const moodIndex = Math.min((slideNumber || 1) - 1, moodList.length - 1);
    const mood = moodList[moodIndex] || 'HERO_DARK';
    const isDark = mood.includes('DARK') || mood.includes('LOFI') || mood.includes('WARM') || mood === 'FRASE_IMPACTO' || mood === 'VIRADA' || mood === 'CTA_INTIMO';
    const designMeta = { heading: heading||'', body: body||'', accent: brand.accent||'#C8A020', bgDark: brand.bgDark||'#0A0A0A', bgLight: brand.bgLight||'#F5F4F0', handle: brand.handle||account.handle, isDark, mood, slideNumber, totalSlides, funcao: funcao||(slideNumber===1?'CAPA':slideNumber===totalSlides?'ASSINATURA':'CONTEUDO') };

    let imageData;

    if (referenceImageB64) {
      // Usa a foto real como imagem de entrada via edits endpoint
      const imgBuffer = Buffer.from(referenceImageB64, 'base64');
      const { FormData: NodeFormData, Blob: NodeBlob } = await import('node:buffer').catch(() => ({}));
      const FormDataLib = (typeof FormData !== 'undefined') ? FormData : (await import('formdata-node').catch(() => null))?.FormData;
      const form = new (FormDataLib || FormData)();
      form.append('model', 'gpt-image-1');
      form.append('prompt', promptPhoto + ' Keep the person/subject from the reference photo as the main element. Apply the brand editorial style on top.');
      form.append('n', '1');
      form.append('size', '1024x1536');
      form.append('quality', quality);
      // Envia a imagem como ficheiro PNG
      const blob = new Blob([imgBuffer], { type: 'image/png' });
      form.append('image', blob, 'photo.png');
      const r = await fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY },
        body: form,
      });
      const data = await r.json();
      if (data.error) {
        console.warn('[carousel-slide] edits falhou, fallback para generations:', data.error.message);
        // Fallback: gera normalmente sem a foto
        const r2 = await fetch('https://api.openai.com/v1/images/generations', { method: 'POST', headers: { 'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'gpt-image-1', prompt: promptPhoto, n: 1, size: '1024x1536', quality, output_format: 'png' }) });
        const data2 = await r2.json();
        if (data2.error) return res.status(500).json({ error: data2.error.message });
        imageData = data2.data?.[0];
      } else {
        imageData = data.data?.[0];
      }
    } else {
      const r = await fetch('https://api.openai.com/v1/images/generations', { method: 'POST', headers: { 'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'gpt-image-1', prompt: promptPhoto, n: 1, size: '1024x1536', quality, output_format: 'png' }) });
      const data = await r.json();
      if (data.error) { console.error('[carousel-slide] GPT error:', data.error); return res.status(500).json({ error: data.error.message || JSON.stringify(data.error) }); }
      imageData = data.data?.[0];
    }

    if (!imageData) return res.status(500).json({ error: 'Nenhuma imagem retornada' });

    // Crop center 2:3 → 4:5 for Instagram feed (1080×1350)
    let finalB64 = imageData.b64_json || null;
    if (finalB64) {
      finalB64 = await cropTo45(finalB64);
    }

    res.json({ success: true, b64: finalB64, url: imageData.url || null, designMeta, quality });
  } catch (err) { console.error('[image/carousel-slide]', err); res.status(500).json({ error: err.message }); }
});
// Salva imagem base64 em disco e devolve URL pública
app.post('/api/image/save-b64', (req, res) => {
  try {
    const { b64, contentId, slideIndex } = req.body;
    if (!b64) return res.status(400).json({ error: 'b64 obrigatório' });
    const uploadsDir = path.join(__dirname, 'public', 'uploads');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    const filename = `${contentId || 'img'}_slide${slideIndex ?? 0}_${Date.now()}.png`;
    const filepath = path.join(uploadsDir, filename);
    fs.writeFileSync(filepath, Buffer.from(b64, 'base64'));
    const publicUrl = (process.env.PUBLIC_URL || '').replace(/\/$/, '') + '/uploads/' + filename;
    res.json({ success: true, url: publicUrl, filename });
  } catch (err) { res.status(500).json({ error: err.message }); }
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
  const item = { id: 'cnt_' + Date.now(), createdAt: new Date().toISOString(), status: 'pendente', ...req.body };
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

app.patch('/api/content/:id/images', (req, res) => {
  try {
    const { imageUrls } = req.body;
    if (!Array.isArray(imageUrls)) return res.status(400).json({ error: 'imageUrls deve ser array' });
    updateContentImages(req.params.id, imageUrls);
    res.json({ success: true, savedCount: imageUrls.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/content/:id', async (req, res) => {
  try {
    if (supabase) {
      const { data, error } = await supabase.from('generated_content').select('*').eq('id', req.params.id).single();
      if (!error && data) {
        return res.json({ id: data.id, profile: data.profile, type: data.type, status: data.status, topic: data.topic, caption: data.caption, hashtags: data.hashtags, carouselData: data.carousel_data ? JSON.parse(data.carousel_data) : null, contentMachineType: data.content_machine_type, createdAt: data.created_at, imageUrls: data.image_urls || [] });
      }
    }
    const all  = readJSON(GENERATED_FILE);
    const item = all.find(i => i.id === req.params.id);
    if (!item) return res.status(404).json({ error: 'Não encontrado' });
    res.json(item);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Instagram ─────────────────────────────────────────────────────────────
async function publishSingle(account, imageUrl, caption) {
  const { id: accountId, token } = account;
  const cr = await fetch('https://graph.facebook.com/v19.0/' + accountId + '/media?image_url=' + encodeURIComponent(imageUrl) + '&caption=' + encodeURIComponent(caption) + '&access_token=' + token, { method: 'POST' });
  const { id: containerId, error } = await cr.json();
  if (error) throw new Error(error.message);
  await new Promise(r => setTimeout(r, 5000));
  const pr = await fetch('https://graph.facebook.com/v19.0/' + accountId + '/media_publish?creation_id=' + containerId + '&access_token=' + token, { method: 'POST' });
  return pr.json();
}

async function publishCarousel(account, imageUrls, caption) {
  const { id: accountId, token } = account;
  const childIds = [];
  for (const url of imageUrls) {
    const r = await fetch('https://graph.facebook.com/v19.0/' + accountId + '/media?image_url=' + encodeURIComponent(url) + '&is_carousel_item=true&access_token=' + token, { method: 'POST' });
    const { id, error } = await r.json();
    if (error) throw new Error(error.message);
    childIds.push(id);
  }
  const cr = await fetch('https://graph.facebook.com/v19.0/' + accountId + '/media?media_type=CAROUSEL&children=' + childIds.join(',') + '&caption=' + encodeURIComponent(caption) + '&access_token=' + token, { method: 'POST' });
  const { id: carouselId, error: cerr } = await cr.json();
  if (cerr) throw new Error(cerr.message);
  await new Promise(r => setTimeout(r, 8000));
  const pr = await fetch('https://graph.facebook.com/v19.0/' + accountId + '/media_publish?creation_id=' + carouselId + '&access_token=' + token, { method: 'POST' });
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
    const newPost = { id: 'sch_' + Date.now(), contentId, scheduledAt, status: 'pending', ...rest };
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
}, 60000);

// ═══════════════════════════════════════════════════════════════════════════
// CANVA TEMPLATE SLIDE GENERATOR
// POST /api/canva/generate-slides
// Gera imagens PNG de cada slide no estilo visual do template escolhido
// ═══════════════════════════════════════════════════════════════════════════

app.post('/api/canva/generate-slides', async (req, res) => {
  try {
    const { templateId, slides, profile, quality: rawQuality } = req.body;

    if (!templateId) return res.status(400).json({ error: 'templateId obrigatório' });
    if (!slides || !slides.length) return res.status(400).json({ error: 'slides obrigatório' });

    const quality = resolveQuality(rawQuality || 'medium');
    const templates = loadCT();
    const tmpl = templates.find(t => t.id === templateId);
    if (!tmpl) return res.status(404).json({ error: 'Template não encontrado' });

    const aesthetic = tmpl.aesthetic || 'editorial clean, Instagram carousel';
    const templateName = tmpl.name || 'Template';
    const notes = tmpl.notes || '';
    const results = [];

    const brand = BRAND_IDENTITIES[profile] || BRAND_IDENTITIES.marca;

    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i];
      const slideNumber = slide.slideNumber || slide.slide || (i + 1);
      const totalSlides = slides.length;
      const heading = slide.heading || (slide.textos && slide.textos[0]?.texto) || '';
      const body    = slide.body    || (slide.textos && slide.textos[1]?.texto) || '';
      const funcao  = slide.funcao  || (i === 0 ? 'CAPA' : i === slides.length - 1 ? 'CTA' : 'DESENVOLVIMENTO');

      // Template-specific aesthetic appended to brand DNA
      const aestheticOverride = [aesthetic, notes].filter(Boolean).join('. ');

      const imagePrompt = buildCarouselPrompt({
        quality,
        brand,
        aestheticOverride,
        slideRole: funcao,
        heading, body,
        slideNumber,
        totalSlides,
        sceneHint: '',
      });

      try {
        const r = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-image-1',
            prompt: imagePrompt,
            n: 1,
            size: '1024x1536',
            quality,
            output_format: 'png',
          }),
        });

        const data = await r.json();
        if (data.error) {
          results.push({ slideNumber, error: data.error.message, b64: null });
          continue;
        }

        const imageData = data.data && data.data[0];
        results.push({
          slideNumber,
          funcao,
          heading,
          body,
          b64: imageData?.b64_json || null,
          url: imageData?.url || null,
          prompt: imagePrompt,
        });
      } catch (slideErr) {
        results.push({ slideNumber, error: slideErr.message, b64: null });
      }
    }

    const ok = results.filter(r => r.b64 || r.url).length;
    res.json({
      success: true,
      templateName,
      aesthetic,
      quality,
      total: slides.length,
      generated: ok,
      slides: results,
    });
  } catch (err) {
    console.error('[canva/generate-slides]', err);
    res.status(500).json({ error: err.message });
  }
});

// Serve estáticos, mas garante que o HTML nunca fica em cache no browser/CDN
// (senão actualizações à app não chegam ao utilizador sem hard-refresh).
app.use(express.static('public', {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) res.set('Cache-Control', 'no-cache, must-revalidate');
  },
}));
app.use('/api', (req, res) => { res.status(404).json({ error: `Rota não encontrada: ${req.method} ${req.originalUrl}` }); });
app.get('*', (req, res) => {
  res.set('Cache-Control', 'no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.listen(PORT, () => {
  console.log(`🚀 Máquina de Conteúdo na porta ${PORT} | quality default: ${DEFAULT_QUALITY} | valid: ${VALID_QUALITIES.join(', ')}`);
  checkSupabaseTables();
});
