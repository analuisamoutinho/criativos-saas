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

// ── Content Machine — geração de copy via GPT-4o (BrandsDecoded) ─────────────
// Tipos: tendencia | case | educativo | comparacao | lista | prova_social | oferta | dump
app.post('/api/content-machine/generate', async (req, res) => {
  try {
    const { tipo, tema, profile } = req.body;
    if (!tipo || !tema) return res.status(400).json({ error: 'Faltam campos: tipo e tema são obrigatórios.' });

    const manualNote = getManualText(profile);
    const account = getAccount(profile);

    const tipoLabels = {
      tendencia:   'Análise de Tendência',
      case:        'Case de Sucesso',
      educativo:   'Educativo / Framework',
      comparacao:  'Comparação / Antes & Depois',
      lista:       'Lista Valiosa',
      prova_social:'Prova Social',
      oferta:      'Oferta',
      dump:        'Dump / Bastidores',
    };

    const estruturas = {
      tendencia: `
- Slide 1 (CAPA): Hook de 14–18 palavras. Afirmação provocativa ou pergunta que active tensão, curiosidade ou identidade sobre a tendência.
- Slide 2 (SUB-HOOK): 8–12 palavras. Tensiona ou concretiza o slide 1. Não depende sintaticamente do slide 1.
- Slides 3–4: Por que esta tendência está a acontecer agora. Evidências e sinais observáveis.
- Slides 5–7: Implicações do movimento para o mercado/sociedade/negócios.
- Slides 8–9: O que isto significa para o público de ${account.name}.
- Slide 10 (CTA): Convite para comentar palavra-chave, seguir ou guardar.`,
      case: `
- Slide 1 (CAPA): Hook de 14–18 palavras. Apresenta o case como fenómeno, não como notícia.
- Slide 2 (SUB-HOOK): 8–12 palavras. Aprofunda a tensão ou o mistério do case.
- Slides 3–4: Contexto — quem é, o que fez, qual era a situação de partida.
- Slides 5–6: O PONTO DE VIRADA — a decisão ou mudança que transformou tudo.
- Slides 7–8: Resultados e números que comprovam a grandeza do case.
- Slide 9: Lição prática que o leitor pode aplicar no próprio negócio.
- Slide 10 (CTA): Convite claro para ação.`,
      educativo: `
- Slide 1 (CAPA): Hook de 14–18 palavras com promessa clara de aprendizado.
- Slide 2 (SUB-HOOK): 8–12 palavras que tensionam ou aprofundam a promessa.
- Slide 3: Introdução ao conceito/framework — por que isto importa.
- Slides 4–8: Os passos, princípios ou elementos (1 por slide), com exemplos concretos.
- Slide 9: Como aplicar na prática — exemplo direto.
- Slide 10 (CTA): Call to action.`,
      comparacao: `
- Slide 1 (CAPA): Hook de 14–18 palavras que activa o contraste imediatamente.
- Slide 2 (SUB-HOOK): 8–12 palavras que definem os dois polos da comparação.
- Slides 3–5: Lado A — o cenário ruim/antigo/errado, com detalhes e exemplos reais.
- Slide 6: O ponto de virada — o que separa os dois lados.
- Slides 7–9: Lado B — o cenário bom/novo/certo, com resultados concretos.
- Slide 10 (CTA): Convite para reflexão ou ação.`,
      lista: `
- Slide 1 (CAPA): Hook de 14–18 palavras com número específico e promessa de valor.
- Slide 2 (SUB-HOOK): 8–12 palavras que justificam por que esta lista importa agora.
- Slides 3–9: Um item da lista por slide (mínimo 5, máximo 7 itens). Cada item com 2+ frases de desenvolvimento.
- Slide 10 (CTA): Convite para guardar, comentar ou seguir.`,
      prova_social: `
- Slide 1 (CAPA): Hook de 14–18 palavras focado no resultado conquistado.
- Slide 2 (SUB-HOOK): 8–12 palavras com o contexto humano da transformação.
- Slide 3: A situação antes — dor, frustração, ponto de partida.
- Slides 4–6: O processo — o que foi feito, as decisões, os ajustes.
- Slides 7–8: Os resultados — números, evidências, mudanças concretas.
- Slide 9: Lição universal que qualquer pessoa pode extrair.
- Slide 10 (CTA): Convite para quem quer o mesmo resultado.`,
      oferta: `
- Slide 1 (CAPA): Hook de 14–18 palavras que activa desejo sem soar como anúncio.
- Slide 2 (SUB-HOOK): 8–12 palavras que aprofundam a promessa de transformação.
- Slides 3–4: O problema que o produto/serviço resolve, com riqueza de detalhes.
- Slides 5–6: A solução e como funciona — benefícios, não features.
- Slide 7: Para quem é — qualificação do público ideal.
- Slide 8: Prova — resultado de quem já usou.
- Slide 9: O que está incluído / como funciona o processo.
- Slide 10 (CTA): Convite claro e específico para a ação de compra/contacto.`,
      dump: `
- Slide 1 (CAPA): Hook de 14–18 palavras que humaniza e gera curiosidade.
- Slide 2 (SUB-HOOK): 8–12 palavras que contextualizam o momento ou período.
- Slides 3–7: Momentos específicos com narrativa (o que estava a acontecer, o que foi aprendido, o que foi sentido).
- Slide 8: Uma reflexão ou aprendizado gerado por esse período/evento.
- Slide 9: Como isto se conecta com o trabalho/missão de ${account.name}.
- Slide 10 (CTA): Convite para comentar, partilhar ou seguir.`,
    };

    const systemPrompt = `Você é o Content Machine 5.4, agente de construção narrativa para carrosseis de alta performance no Instagram, desenvolvido pela BrandsDecoded.

IDENTIDADE E PRIORIDADE
Sua função é gerar carrosseis com fluxo narrativo coeso, progressão sequencial real e headlines que capturam atenção no feed. Cada slide deve empurrar o raciocínio do anterior e abrir o gancho para o próximo — nunca soltos, nunca repetitivos.

REGRAS GLOBAIS DE LINGUAGEM
- Nunca inventar fatos, números, datas, locais ou fontes.
- Nunca fazer acusações diretas a pessoas ou empresas.
- Sem metalinguagem ou exposição de raciocínio interno.
- Proibido usar o termo "cena".
- Proibido travessão (—) em qualquer slide.
- Proibido em headline/hook: "quando X vira Y", "a ascensão de", "o impacto de", "por que X está mudando", "não é X, é Y", "virou".
- Proibido: "Descubra", "Saiba", "Conheça", "Aprenda" como abertura de qualquer slide.
- Proibido AI slop: frases genéricas, jargão corporativo, abstrações vazias, pares simétricos, slogans quebrados, "e isso muda tudo", "no fim das contas", "o ponto é", "colapso silencioso", "a pergunta que fica".
- Sem 2ª pessoa nos slides de desenvolvimento (apenas no CTA é permitido).
- Sem bullets dentro dos textos dos slides.
- Sempre em português do Brasil.
- Apenas fatos verificáveis e observáveis.

CONTRATO DA CAPA (slides 1 e 2)
São os slides mais importantes. Falhar aqui é falhar no carrossel inteiro.

SLIDE 1 — hook principal
- Estrutura preferencial: afirmação provocativa + dois-pontos + pergunta OU reenquadramento forte + stake
- Deve ativar pelo menos 2 gatilhos simultâneos: nostalgia, medo/alerta, indignação, identidade, curiosidade, aspiração
- Padrões priorizados: Brasil/contexto nacional, Fim/Morte/Crise, Geracional, Novidade, Investigando, Contraste/Antítese, Nome próprio/Referência pop
- MÍNIMO 14 palavras, MÁXIMO 18 palavras. Contar antes de fechar.
- Deve funcionar isoladamente, sem depender do slide 2.
- Não explicar tudo na linha 1. Abrir tensão, não resolver.

SLIDE 2 — sub-hook
- Deve aprofundar, tensionar ou concretizar a leitura aberta pelo slide 1.
- Não entregar a resolução do carrossel — gerar curiosidade, mistério ou chamada contraintuitiva.
- MÍNIMO 8 palavras, MÁXIMO 12 palavras. Contar antes de fechar.
- Não pode depender sintaticamente do slide 1.
- Não pode começar com conectivo de continuação (E, Mas, Porém, Pois, Então, Assim).
- Deve funcionar isoladamente.

CHECKLIST INTERNO OBRIGATÓRIO PARA A HEADLINE
Antes de fechar o slide 1, verificar internamente:
[ ] Tem interrupção real — para o scroll de um desconhecido?
[ ] Tem relevância — faz sentido para quem nunca viu o perfil?
[ ] Tem clareza — pode ser lida em 2 segundos sem esforço?
[ ] Tem tensão — há algo em jogo, algo que pode se perder ou ganhar?
[ ] Está dentro de 14-18 palavras?
[ ] Está livre dos padrões proibidos?
Se qualquer item falhar, reescrever internamente antes de colocar no JSON.

PROGRESSÃO NARRATIVA OBRIGATÓRIA
O carrossel funciona como um funil interno. Cada slide tem uma função na cadeia:
- Slides 1-2: CAPA — parar o scroll do desconhecido
- Slides 3-4: TRAÇÃO — mais argumentos para continuar lendo, abrir o problema ou o fenômeno
- Slides 5-7: AVANÇO — aprofundamento real, mecanismo, prova, dados observáveis
- Slides 8-9: CONSEQUÊNCIA — implicação, aplicação, o que muda com esse conhecimento
- Slide 10: CTA — convite específico para ação (comentar palavra-chave, seguir, guardar)

REGRAS DE PROGRESSÃO
- Cada slide deve abrir uma micro-tensão que o próximo resolve parcialmente.
- Nunca repetir a ideia central do slide anterior com outras palavras.
- Nunca resumir o que já foi dito.
- O slide 3 deve conectar com a tensão aberta no slide 2.
- O slide final de desenvolvimento (8 ou 9) deve fechar o argumento com força real antes do CTA.
- O CTA deve ser consequência natural do conteúdo, não um apêndice.

FAIXAS DE PALAVRAS POR FUNÇÃO
- Slide 1 (hook): 14 a 18 palavras
- Slide 2 (sub-hook): 8 a 12 palavras
- Slides títulos (3, 7, 11, 14 quando existirem): 11 a 15 palavras
- Slides parágrafo: 25 a 32 palavras
- Slides curtos de transição: 20 a 26 palavras
- Slide de fechamento: 26 a 30 palavras
- CTA: frase específica com palavra-chave para comentar

DISCIPLINA INTERNA ANTES DO JSON FINAL
Revisar internamente:
- Estrutura e progressão narrativa
- Fatos verificáveis (nenhum inventado)
- Gramática e fluência
- AI slop (remover qualquer ocorrência)
- Coerência entre slide 1, desenvolvimento e CTA
- Independência sintática entre slide 1 e slide 2
- Contagem de palavras do slide 1 (14-18) e slide 2 (8-12)
Se qualquer ponto falhar, reescrever internamente antes de serializar.

Retornar APENAS JSON válido, sem markdown, sem texto antes ou depois.`;

    const userPrompt = `Tipo de carrossel: ${tipoLabels[tipo] || tipo}
Perfil: ${account.name} (${account.handle})
${manualNote ? `Diretrizes do cliente: ${manualNote}\n` : ''}
Tema central: "${tema}"

ESTRUTURA NARRATIVA PARA ESTE TIPO:
${estruturas[tipo] || estruturas.educativo}

PROCESSO INTERNO OBRIGATÓRIO (executar antes de gerar o JSON):

PASSO 1 — TRIAGEM
Identificar internamente:
- Transformação: o que mudou ou está mudando no tema, com costura e consequência
- Fricção central: a tensão real do fenômeno (não apenas o resumo do tema)
- Ângulo narrativo dominante: a leitura mais forte para capturar atenção de quem não conhece o perfil
- Evidências observáveis: A), B), C) de âncoras verificáveis que sustentam a tese

PASSO 2 — HEADLINE
Com base na triagem, gerar internamente a headline mais forte possível:
- Linha 1 (slide 1): captura — interrompe o scroll, abre tensão, não resolve. 14-18 palavras.
- Linha 2 (slide 2): ancoragem — aprofunda ou tensiona, não depende da linha 1. 8-12 palavras.
Verificar o checklist interno. Se morno, reescrever.

PASSO 3 — ESPINHA DORSAL
Definir internamente:
- Hook: como contextualizar a tensão da headline nos slides 3-4
- Mecanismo: por que o fenômeno acontece (slides 5-6)
- Prova: evidências observáveis (slides 6-7)
- Aplicação: consequência para o leitor (slides 8-9)
- Direção: encaminhamento natural para o CTA (slide 10)

PASSO 4 — RENDER FINAL
Gerar o JSON com todos os slides usando a espinha dorsal como guia.
Garantir que cada slide empurra o raciocínio do anterior.

Retornar APENAS este JSON:
{
  "tipo": "${tipo}",
  "tipo_label": "${tipoLabels[tipo] || tipo}",
  "tema": "${tema}",
  "profile": "${profile}",
  "slides": [
    { "numero": 1, "titulo": "CAPA", "texto": "..." },
    { "numero": 2, "titulo": "SUB-HOOK", "texto": "..." },
    { "numero": 3, "titulo": "...", "texto": "..." },
    { "numero": 4, "titulo": "...", "texto": "..." },
    { "numero": 5, "titulo": "...", "texto": "..." },
    { "numero": 6, "titulo": "...", "texto": "..." },
    { "numero": 7, "titulo": "...", "texto": "..." },
    { "numero": 8, "titulo": "...", "texto": "..." },
    { "numero": 9, "titulo": "...", "texto": "..." },
    { "numero": 10, "titulo": "CTA", "texto": "..." }
  ]
}`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        temperature: 1.0,
        max_tokens: 3000,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    const data = await response.json();
    if (data.error) return res.status(500).json({ error: data.error.message });

    let text = data.choices[0].message.content.trim();
    // Remover fences markdown se o modelo as incluir mesmo assim
    text = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();

    const parsed = JSON.parse(text);

    // Guardar na biblioteca de conteúdos gerados
    const item = saveGeneratedContent({
      id: `cnt_${Date.now()}`,
      createdAt: new Date().toISOString(),
      status: 'pendente',
      type: 'carrossel',
      contentMachineType: tipo,
      contentMachineTypeLabel: tipoLabels[tipo] || tipo,
      profile,
      topic: tema,
      carouselData: {
        title: tema,
        slideCount: parsed.slides?.length || 10,
        slides: (parsed.slides || []).map(s => ({
          slideNumber: s.numero,
          heading: s.texto,
          body: '',
          imagePrompt: '',
          titulo: s.titulo,
        })),
        caption: '',
        hashtags: '',
      },
    });

    res.json({ success: true, contentId: item.id, ...parsed });
  } catch (err) {
    console.error('Content Machine error:', err);
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
// Modos:
//   - "blocks": o utilizador cola blocos de texto prontos (ex: # Bloco 1 ... # Bloco 2)
//               a IA organiza cada bloco em 1 slide, sem alterar o conteúdo
//   - "topic":  o utilizador dá só um tema/tópico e a IA cria tudo do zero
// Sem limite de slides — a IA decide quantos fazem sentido para o conteúdo
app.post('/api/carousel/generate-and-save', async (req, res) => {
  try {
    const { topic, blocks, profile, calendarDay, calendarMonth, calendarYear, caption, hashtags } = req.body;
    const manualNote = getManualText(profile);
    const account = getAccount(profile);
    const mode = blocks ? 'blocks' : 'topic';

    let prompt;

    if (mode === 'blocks') {
      // Modo blocos: cada bloco vira 1 slide, IA só formata + gera imagePrompt
      prompt = `Tens os seguintes blocos de texto para um carrossel do Instagram do perfil ${account.name} (${account.handle}).
Cada bloco deve virar exatamente 1 slide. Não alteres o texto dos blocos — apenas formata.

BLOCOS:
${blocks}

${manualNote ? `\nDiretrizes do cliente:\n${manualNote}` : ''}

Responde APENAS com JSON válido:
{
  "title": "título interno do carrossel (não aparece no post)",
  "slideCount": <número total de slides>,
  "slides": [
    {
      "slideNumber": 1,
      "heading": "texto principal do bloco (preserva o original)",
      "body": "texto secundário se houver (pode ser vazio)",
      "imagePrompt": "prompt detalhado em inglês para gerar imagem de fundo: ambiente, luz, composição, paleta — compatível com o tom do texto. Sem texto na imagem."
    }
  ],
  "caption": "legenda completa para o Instagram com emojis e CTA",
  "hashtags": "#hashtag1 #hashtag2 #hashtag3"
}`;
    } else {
      // Modo tópico: IA cria tudo do zero, decide quantos slides fazem sentido
      prompt = `Cria um carrossel completo para Instagram sobre: "${topic}".
Perfil: ${account.name} (${account.handle})
${manualNote ? `\nDiretrizes:\n${manualNote}` : ''}

Decide o número ideal de slides para o tema (sem limite máximo — usa quantos forem necessários para o conteúdo fluir bem).
Cada slide deve ter uma ideia clara e impactante.

Responde APENAS com JSON válido:
{
  "title": "título interno do carrossel",
  "slideCount": <número total de slides>,
  "slides": [
    {
      "slideNumber": 1,
      "heading": "texto principal do slide",
      "body": "texto secundário (pode ser vazio)",
      "imagePrompt": "prompt detalhado em inglês para imagem de fundo. Sem texto na imagem."
    }
  ],
  "caption": "legenda completa com emojis e CTA",
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

// Catch-all: rotas /api/* inexistentes → 404 JSON; resto → SPA
// IMPORTANTE: sem isto, Express devolve index.html para /api/* não encontradas,
// causando "Unexpected token '<'" ao tentar JSON.parse do HTML no frontend
app.use('/api', (req, res) => {
  res.status(404).json({ error: `Rota não encontrada: ${req.method} ${req.originalUrl}` });
});
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`🚀 Máquina de Conteúdo rodando na porta ${PORT}`));
