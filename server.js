const express    = require('express');
const fetch      = require('node-fetch');
const path       = require('path');
const session    = require('express-session');
const passport   = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

const app = express();
app.use(express.json({ limit: '50mb' })); // aumentado para suportar base64 dos slides

// ── SESSÃO ────────────────────────────────────────────────
app.use(session({
  secret: process.env.SESSION_SECRET || 'maquina-criativos-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // 7 dias
}));

app.use(passport.initialize());
app.use(passport.session());

// ── GOOGLE OAUTH ──────────────────────────────────────────
passport.use(new GoogleStrategy({
  clientID:     process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL:  process.env.CALLBACK_URL || '/auth/google/callback'
}, (accessToken, refreshToken, profile, done) => {
  const email = profile.emails[0].value;
  const allowed = (process.env.ALLOWED_EMAILS || '').split(',').map(e => e.trim().toLowerCase());

  if (!allowed.includes(email.toLowerCase())) {
    return done(null, false, { message: 'Email nao autorizado.' });
  }

  if (!usageStats[email]) {
    usageStats[email] = {
      name:           profile.displayName,
      photo:          profile.photos?.[0]?.value || null,
      totalCreatives: 0,
      byClient:       {},
      lastActive:     null
    };
  } else {
    usageStats[email].name  = profile.displayName;
    usageStats[email].photo = profile.photos?.[0]?.value || null;
  }

  return done(null, { email, name: profile.displayName, photo: profile.photos?.[0]?.value || null });
}));

passport.serializeUser((user, done)   => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// ── TRACKING DE USO (em memória) ─────────────────────────
const usageStats = {};

// ── MIDDLEWARE DE AUTH ────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect('/login');
}

// ── ROTAS DE AUTH ─────────────────────────────────────────
app.get('/login', (req, res) => {
  if (req.isAuthenticated()) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login?erro=nao-autorizado' }),
  (req, res) => res.redirect('/')
);

app.get('/auth/logout', (req, res) => {
  req.logout(() => res.redirect('/login'));
});

// ── PROTEÇÃO DAS ROTAS ────────────────────────────────────
app.use((req, res, next) => {
  if (req.path === '/login' || req.path.startsWith('/auth/')) return next();
  if (!req.isAuthenticated()) return res.redirect('/login');
  next();
});

// ── ARQUIVOS ESTÁTICOS (só após auth) ────────────────────
app.use(express.static('public'));

// ── API: usuário logado ───────────────────────────────────
app.get('/api/me', (req, res) => {
  res.json({ email: req.user.email, name: req.user.name, photo: req.user.photo });
});

// ── API: registrar criativo gerado ───────────────────────
app.post('/api/track', (req, res) => {
  const email = req.user.email;
  const { clientName } = req.body;

  if (!usageStats[email]) {
    usageStats[email] = { name: req.user.name, photo: req.user.photo, totalCreatives: 0, byClient: {}, lastActive: null };
  }

  usageStats[email].totalCreatives += 1;
  usageStats[email].lastActive = new Date().toISOString();

  if (clientName) {
    usageStats[email].byClient[clientName] = (usageStats[email].byClient[clientName] || 0) + 1;
  }

  res.json({ ok: true });
});

// ── API: dashboard de uso ─────────────────────────────────
app.get('/api/stats', (req, res) => {
  const result = Object.entries(usageStats).map(([email, data]) => ({
    email,
    name:           data.name,
    photo:          data.photo,
    totalCreatives: data.totalCreatives,
    byClient:       data.byClient,
    lastActive:     data.lastActive
  }));
  res.json(result);
});

// ── ROTA: Claude ──────────────────────────────────────────
app.post('/api/claude', async (req, res) => {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('Erro Claude:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── ROTA: OpenAI GPT Image 2 ─────────────────────────────
app.post('/api/image', async (req, res) => {
  try {
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model:   'gpt-image-2',           // ← atualizado de gpt-image-1
        prompt:  req.body.prompt,
        n:       req.body.n || 1,
        size:    req.body.size || '1024x1024',
        quality: req.body.quality || 'high'
      })
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('Erro OpenAI:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── ROTA: Gemini Imagen 4 ─────────────────────────────────
app.post('/api/gemini-image', async (req, res) => {
  try {
    const { prompt, n = 1, aspectRatio = '1:1' } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-preview-05-20:predict?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instances:  [{ prompt }],
          parameters: {
            sampleCount:       Math.min(n, 4),
            aspectRatio,
            safetyFilterLevel: 'block_only_high',
            personGeneration:  'allow_adult'
          }
        })
      }
    );
    const data = await response.json();
    if (data.predictions) {
      res.json({ data: data.predictions.map(p => ({ b64_json: p.bytesBase64Encoded, url: null })) });
    } else {
      res.json(data);
    }
  } catch (err) {
    console.error('Erro Gemini:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── ROTA: Instagram — postar carrossel ───────────────────
// Variáveis de ambiente necessárias no Railway:
//   INSTAGRAM_ACCESS_TOKEN  — token de longa duração da conta
//   INSTAGRAM_ACCOUNT_ID    — ID numérico da conta Business/Creator
//
// Como gerar o token: Meta for Developers → seu App →
//   Instagram Graph API → Generate Token → converter para long-lived token
app.post('/api/instagram/post', async (req, res) => {
  const { imagens, legenda } = req.body;

  const { perfil } = req.body;
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  const accountId   = perfil === 'case'
    ? process.env.INSTAGRAM_ACCOUNT_ID_MARCA
    : process.env.INSTAGRAM_ACCOUNT_ID_PESSOAL;

  if (!accessToken || !accountId) {
    return res.status(500).json({ error: `INSTAGRAM_ACCESS_TOKEN ou INSTAGRAM_ACCOUNT_ID_${perfil === 'case' ? 'MARCA' : 'PESSOAL'} não configurados no Railway.` });
  }

  if (!imagens || imagens.length < 2) {
    return res.status(400).json({ error: 'Carrossel precisa de pelo menos 2 imagens.' });
  }

  try {
    // ── Passo 1: fazer upload de cada imagem como container de mídia ──
    // A API do Instagram não aceita base64 direto — precisa de URL pública.
    // Usamos o endpoint de upload de imagem do próprio Meta (image_url via data URI não funciona).
    // Estratégia: subir cada imagem como bytes para o endpoint de criação com image_url apontando
    // para nossa própria rota temporária.
    //
    // Alternativa mais simples e confiável: usar o campo "image_url" com uma URL pública.
    // Como estamos no Railway (URL pública), servimos as imagens temporariamente.

    const tempImages = {}; // { token: base64 }

    // Servir imagens temporariamente por token
    imagens.forEach((b64, i) => {
      const token = `tmp_${Date.now()}_${i}`;
      tempImages[token] = b64;
    });

    // Registra rota temporária para cada imagem (remove depois de 5 min)
    const tokens = Object.keys(tempImages);
    tokens.forEach(token => {
      const handler = (req2, res2) => {
        const buf = Buffer.from(tempImages[token], 'base64');
        res2.setHeader('Content-Type', 'image/png');
        res2.send(buf);
      };
      app.get(`/tmp-img/${token}`, handler);
      setTimeout(() => delete tempImages[token], 5 * 60 * 1000);
    });

    // URL base pública do Railway (ex: https://meu-app.railway.app)
    const baseUrl = process.env.PUBLIC_URL || `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;

    // ── Passo 2: criar container de mídia para cada slide ──
    const mediaIds = [];
    for (let i = 0; i < tokens.length; i++) {
      const imageUrl = `${baseUrl}/tmp-img/${tokens[i]}`;
      const formData = new URLSearchParams({
        image_url:    imageUrl,
        is_carousel_item: 'true',
        access_token: accessToken
      });

      const mediaRes  = await fetch(`https://graph.facebook.com/v21.0/${accountId}/media`, {
        method: 'POST',
        body:   formData
      });
      const mediaData = await mediaRes.json();

      if (!mediaData.id) {
        throw new Error(`Falha no upload da imagem ${i + 1}: ${JSON.stringify(mediaData)}`);
      }
      mediaIds.push(mediaData.id);
    }

    // ── Passo 3: criar container do carrossel ──
    const carrosselRes = await fetch(`https://graph.facebook.com/v21.0/${accountId}/media`, {
      method: 'POST',
      body: new URLSearchParams({
        media_type:   'CAROUSEL',
        children:     mediaIds.join(','),
        caption:      legenda || '',
        access_token: accessToken
      })
    });
    const carrosselData = await carrosselRes.json();

    if (!carrosselData.id) {
      throw new Error('Falha ao criar container do carrossel: ' + JSON.stringify(carrosselData));
    }

    // ── Passo 4: publicar ──
    const publishRes = await fetch(`https://graph.facebook.com/v21.0/${accountId}/media_publish`, {
      method: 'POST',
      body: new URLSearchParams({
        creation_id:  carrosselData.id,
        access_token: accessToken
      })
    });
    const publishData = await publishRes.json();

    if (publishData.id) {
      console.log(`Carrossel publicado! Post ID: ${publishData.id}`);
      res.json({ ok: true, postId: publishData.id });
    } else {
      throw new Error('Falha na publicação: ' + JSON.stringify(publishData));
    }

  } catch (err) {
    console.error('Erro Instagram:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── INICIA O SERVIDOR ─────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Maquina de Criativos rodando na porta ${PORT}`);
});
