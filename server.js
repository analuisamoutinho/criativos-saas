const express    = require('express');
const fetch      = require('node-fetch');
const path       = require('path');
const session    = require('express-session');
const passport   = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

const app = express();
app.use(express.json({ limit: '10mb' }));

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

  // Inicializa stats para novo usuario
  if (!usageStats[email]) {
    usageStats[email] = {
      name:           profile.displayName,
      photo:          profile.photos?.[0]?.value || null,
      totalCreatives: 0,
      byClient:       {},
      lastActive:     null
    };
  } else {
    // Atualiza nome/foto caso tenha mudado
    usageStats[email].name  = profile.displayName;
    usageStats[email].photo = profile.photos?.[0]?.value || null;
  }

  return done(null, { email, name: profile.displayName, photo: profile.photos?.[0]?.value || null });
}));

passport.serializeUser((user, done)   => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// ── TRACKING DE USO (em memória) ─────────────────────────
// Nota: reseta a cada redeploy. Para persistência, use Railway PostgreSQL.
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

// ── ROTA: Claude (gera o prompt) ─────────────────────────
app.post('/api/claude', async (req, res) => {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':    'application/json',
        'x-api-key':       process.env.ANTHROPIC_API_KEY,
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

// ── ROTA: OpenAI GPT Image ────────────────────────────────
app.post('/api/image', async (req, res) => {
  try {
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model:   'gpt-image-1',
        prompt:  req.body.prompt,
        n:       req.body.n || 3,
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
    const { prompt, n = 3, aspectRatio = '1:1' } = req.body;
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

// ── INICIA O SERVIDOR ─────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Maquina de Criativos rodando na porta ${PORT}`);
});
