-- ============================================================
-- Máquina de Conteúdo — Schema Supabase
-- Cola este SQL no Supabase Dashboard → SQL Editor → Run
-- ============================================================

-- Conteúdo gerado (posts, carrosseis, reels, feed)
CREATE TABLE IF NOT EXISTS generated_content (
  id                    TEXT PRIMARY KEY,
  profile               TEXT NOT NULL,
  type                  TEXT,
  status                TEXT DEFAULT 'pendente',
  topic                 TEXT,
  caption               TEXT,
  hashtags              TEXT,
  carousel_data         JSONB,
  content_machine_type  TEXT,
  content_machine_type_label TEXT,
  calendar_day          INTEGER,
  calendar_month        INTEGER,
  calendar_year         INTEGER,
  image_urls            TEXT[]  DEFAULT '{}',
  instagram_id          TEXT,
  published_at          TIMESTAMPTZ,
  scheduled_at          TIMESTAMPTZ,
  metodologia           TEXT,
  is_roteiro            BOOLEAN DEFAULT FALSE,
  roteiro_data          JSONB,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Calendários editoriais mensais
CREATE TABLE IF NOT EXISTS calendars (
  id          TEXT PRIMARY KEY,   -- formato: "{profile}_{year}_{month}"
  profile     TEXT NOT NULL,
  month       INTEGER NOT NULL,
  year        INTEGER NOT NULL,
  data        JSONB,              -- array de dias com posts
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para queries frequentes
CREATE INDEX IF NOT EXISTS idx_generated_content_profile    ON generated_content (profile);
CREATE INDEX IF NOT EXISTS idx_generated_content_status     ON generated_content (status);
CREATE INDEX IF NOT EXISTS idx_generated_content_created_at ON generated_content (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_calendars_profile            ON calendars (profile);

-- Se estiver atualizando instalação existente, adicionar a coluna:
-- ALTER TABLE generated_content ADD COLUMN IF NOT EXISTS image_quality TEXT DEFAULT 'medium';

-- Row Level Security desativado (acesso via service key no backend)
ALTER TABLE generated_content DISABLE ROW LEVEL SECURITY;
ALTER TABLE calendars          DISABLE ROW LEVEL SECURITY;


-- Tabela de metadados das fotos do banco
-- (substitui o arquivo /tmp/photos_meta.json que é efêmero no Railway)
CREATE TABLE IF NOT EXISTS photos_meta (
  id           TEXT PRIMARY KEY,
  profile      TEXT NOT NULL,
  filename     TEXT,
  original_name TEXT,
  tags         TEXT[]  DEFAULT '{}',
  description  TEXT    DEFAULT '',
  public_url   TEXT,
  data_url     TEXT,   -- base64 da imagem (fallback quando não há Supabase Storage)
  uploaded_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela de tokens OAuth de terceiros
-- (substitui /tmp/gphotos_tokens.json que é efêmero no Railway)
CREATE TABLE IF NOT EXISTS oauth_tokens (
  user_id      TEXT NOT NULL,
  service      TEXT NOT NULL,   -- ex: 'gphotos'
  access_token  TEXT,
  refresh_token TEXT,
  expires_at   TIMESTAMPTZ,
  connected_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, service)
);

CREATE INDEX IF NOT EXISTS idx_photos_meta_profile ON photos_meta (profile);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_service ON oauth_tokens (service);

ALTER TABLE photos_meta  DISABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_tokens DISABLE ROW LEVEL SECURITY;

-- Bucket de Storage para fotos (cria via Dashboard > Storage > New bucket: "photos", public: true)
-- Ou via SQL se tiver permissão:
-- INSERT INTO storage.buckets (id, name, public) VALUES ('photos', 'photos', true) ON CONFLICT DO NOTHING;
