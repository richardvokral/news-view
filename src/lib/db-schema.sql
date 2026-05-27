CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT,
  url TEXT UNIQUE NOT NULL,
  image_url TEXT,
  published_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL,
  source_country TEXT NOT NULL,
  category TEXT,
  keywords TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published_at);
CREATE INDEX IF NOT EXISTS idx_articles_source ON articles(source);
CREATE INDEX IF NOT EXISTS idx_articles_source_country ON articles(source_country);

-- Access control: who can see which sections.
CREATE TABLE IF NOT EXISTS access_users (
  email TEXT PRIMARY KEY,
  sections TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS access_domains (
  domain TEXT PRIMARY KEY,
  sections TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dashboard_user_layouts (
  email TEXT PRIMARY KEY,
  widgets JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dashboard_defaults (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  widgets JSONB NOT NULL,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Phase B: article performance monitoring.
CREATE TABLE IF NOT EXISTS article_monitors (
  page_path TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_checked_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS article_monitors_site_idx
  ON article_monitors(site_id, first_seen_at DESC);

CREATE TABLE IF NOT EXISTS article_metric_snapshots (
  id BIGSERIAL PRIMARY KEY,
  page_path TEXT NOT NULL REFERENCES article_monitors(page_path) ON DELETE CASCADE,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  window_seconds INTEGER NOT NULL,
  visitors INTEGER,
  pageviews INTEGER,
  extra JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS article_metric_snapshots_page_idx
  ON article_metric_snapshots(page_path, captured_at DESC);

-- Per-article source attribution snapshots (optional; populated when
-- monitor_config.source_sampling_enabled is true).
CREATE TABLE IF NOT EXISTS article_source_snapshots (
  id BIGSERIAL PRIMARY KEY,
  page_path TEXT NOT NULL REFERENCES article_monitors(page_path) ON DELETE CASCADE,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source TEXT NOT NULL,
  visitors INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS article_source_snapshots_page_idx
  ON article_source_snapshots(page_path, captured_at DESC);

-- Per-article author attribution snapshots. Populated when
-- monitor_config.author_sampling_enabled is true; one call per
-- top-sampled article per tick pulls the author list from Plausible.
CREATE TABLE IF NOT EXISTS article_author_snapshots (
  id BIGSERIAL PRIMARY KEY,
  page_path TEXT NOT NULL REFERENCES article_monitors(page_path) ON DELETE CASCADE,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  name TEXT NOT NULL,
  visitors INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS article_author_snapshots_page_idx
  ON article_author_snapshots(page_path, captured_at DESC);

-- Cached Google Trends results (one row per (locale, fetched_at) — newest
-- per locale is what the sidebar reads). The shape of `data` is whatever
-- the upstream scrape.do trending API returns; we store the parsed list of
-- top trending searches as JSONB.
CREATE TABLE IF NOT EXISTS google_trends_snapshots (
  id BIGSERIAL PRIMARY KEY,
  locale TEXT NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source TEXT,
  data JSONB NOT NULL DEFAULT '[]'::jsonb,
  error TEXT
);

CREATE INDEX IF NOT EXISTS google_trends_locale_idx
  ON google_trends_snapshots(locale, fetched_at DESC);

-- Articles pulled from external (competitor) RSS feeds for the coverage
-- comparison view. One row per unique (feed_source, guid).
CREATE TABLE IF NOT EXISTS external_articles (
  id BIGSERIAL PRIMARY KEY,
  feed_source TEXT NOT NULL,
  guid TEXT NOT NULL,
  title TEXT NOT NULL,
  link TEXT NOT NULL,
  description TEXT,
  pub_date TIMESTAMPTZ,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (feed_source, guid)
);

CREATE INDEX IF NOT EXISTS external_articles_imported_idx
  ON external_articles(imported_at DESC);
CREATE INDEX IF NOT EXISTS external_articles_pub_date_idx
  ON external_articles(pub_date DESC);

-- Coverage analysis results (AI cross-reference between external articles
-- and our recent titles). Keyed by (our_site_id, external_article_id) so
-- the same external article can be compared against multiple of our sites.
CREATE TABLE IF NOT EXISTS coverage_analysis (
  id BIGSERIAL PRIMARY KEY,
  our_site_id TEXT NOT NULL,
  external_article_id BIGINT NOT NULL REFERENCES external_articles(id) ON DELETE CASCADE,
  covered BOOLEAN NOT NULL,
  importance INTEGER NOT NULL DEFAULT 3,
  matched_our_paths TEXT[] NOT NULL DEFAULT '{}',
  rationale TEXT,
  model TEXT,
  analyzed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (our_site_id, external_article_id)
);

CREATE INDEX IF NOT EXISTS coverage_analysis_site_idx
  ON coverage_analysis(our_site_id, analyzed_at DESC);

-- Article title history (populated when rss_enabled and the site has an RSS
-- URL configured). Append-only: a new row is inserted only when the title
-- observed on the RSS feed differs from the previous latest row.
CREATE TABLE IF NOT EXISTS article_titles (
  id BIGSERIAL PRIMARY KEY,
  page_path TEXT NOT NULL REFERENCES article_monitors(page_path) ON DELETE CASCADE,
  site_id TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  title TEXT NOT NULL,
  image_url TEXT,
  pub_date TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS article_titles_page_idx
  ON article_titles(page_path, captured_at DESC);

ALTER TABLE article_titles
  ADD COLUMN IF NOT EXISTS pub_date TIMESTAMPTZ;

-- Monitor config (singleton). Edited via /admin/monitor.
CREATE TABLE IF NOT EXISTS monitor_config (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled BOOLEAN NOT NULL DEFAULT false,
  interval_seconds INTEGER NOT NULL DEFAULT 300,
  window_hours INTEGER NOT NULL DEFAULT 48,
  retention_days INTEGER NOT NULL DEFAULT 7,
  max_requests_per_hour INTEGER NOT NULL DEFAULT 240,
  site_patterns JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_sampling_enabled BOOLEAN NOT NULL DEFAULT false,
  source_sampling_top_n INTEGER NOT NULL DEFAULT 10,
  trend_window_minutes INTEGER NOT NULL DEFAULT 60,
  source_timeseries_enabled BOOLEAN NOT NULL DEFAULT false,
  excluded_sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  rss_enabled BOOLEAN NOT NULL DEFAULT false,
  site_rss_urls JSONB NOT NULL DEFAULT '{}'::jsonb,
  show_article_images BOOLEAN NOT NULL DEFAULT false,
  author_short_names JSONB NOT NULL DEFAULT '{}'::jsonb,
  author_sampling_enabled BOOLEAN NOT NULL DEFAULT false,
  top_sources_limit INTEGER NOT NULL DEFAULT 10,
  external_rss_enabled BOOLEAN NOT NULL DEFAULT false,
  external_rss_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  coverage_enabled BOOLEAN NOT NULL DEFAULT false,
  coverage_window_hours INTEGER NOT NULL DEFAULT 24,
  coverage_model TEXT NOT NULL DEFAULT 'claude-haiku-4-5-20251001',
  google_trends_enabled BOOLEAN NOT NULL DEFAULT false,
  google_trends_locales JSONB NOT NULL DEFAULT '["CZ","DE","US"]'::jsonb,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Backfill for existing installs.
ALTER TABLE monitor_config
  ADD COLUMN IF NOT EXISTS source_sampling_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS source_sampling_top_n INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS trend_window_minutes INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS source_timeseries_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS excluded_sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS rss_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS site_rss_urls JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS show_article_images BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS author_short_names JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS author_sampling_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS top_sources_limit INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS external_rss_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS external_rss_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS coverage_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS coverage_window_hours INTEGER NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS coverage_model TEXT NOT NULL DEFAULT 'claude-haiku-4-5-20251001',
  ADD COLUMN IF NOT EXISTS google_trends_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS google_trends_locales JSONB NOT NULL DEFAULT '["CZ","DE","US"]'::jsonb;

-- =====================================================================
-- AI Czech proofreading (Stage 1). All DDL idempotent.
-- =====================================================================

-- Bearer sessions for the Chrome extension. token stored as SHA-256 hash
-- (never plaintext). password_hash/password_set_at are reserved for the next
-- stage (email-only login for now).
CREATE TABLE IF NOT EXISTS proofread_sessions (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  password_set_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_proofread_sessions_email ON proofread_sessions(email);
CREATE INDEX IF NOT EXISTS idx_proofread_sessions_expires ON proofread_sessions(expires_at);

-- Selectable LLM models with per-1M-token USD prices and labels.
-- key is a stable synthetic id (e.g. 'openai:gpt-4o-mini').
CREATE TABLE IF NOT EXISTS proofread_models (
  key TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('openai', 'anthropic')),
  model_id TEXT NOT NULL,
  label TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  input_usd_per_mtok NUMERIC(10, 4) NOT NULL DEFAULT 0,
  output_usd_per_mtok NUMERIC(10, 4) NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One system prompt per mode; is_default_mode marks the extension default.
CREATE TABLE IF NOT EXISTS proofread_prompts (
  mode TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  body TEXT NOT NULL,
  is_default_mode BOOLEAN NOT NULL DEFAULT false,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per-user override of model and/or prompt. email is the de-facto key (no
-- users table exists; matches access_users). NULL => fall back to defaults.
CREATE TABLE IF NOT EXISTS proofread_user_config (
  email TEXT PRIMARY KEY,
  model_key TEXT REFERENCES proofread_models(key) ON DELETE SET NULL,
  prompt_override TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Singleton: which model is the system default (mirrors monitor_config).
CREATE TABLE IF NOT EXISTS proofread_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  default_model_key TEXT REFERENCES proofread_models(key) ON DELETE SET NULL,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per-request usage log. NEVER stores article text, only counts and ids.
CREATE TABLE IF NOT EXISTS proofread_usage (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_key TEXT,
  mode TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
  cost_czk NUMERIC(12, 4) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ok',
  article_id TEXT,
  source_url TEXT,
  input_chars INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proofread_usage_email ON proofread_usage(email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_proofread_usage_model ON proofread_usage(model_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_proofread_usage_created ON proofread_usage(created_at DESC);

-- Seed both providers (prices = USD per 1M tokens; editable in admin).
INSERT INTO proofread_models
  (key, provider, model_id, label, enabled, input_usd_per_mtok, output_usd_per_mtok, sort_order)
VALUES
  ('openai:gpt-4o-mini',   'openai',    'gpt-4o-mini',               'OpenAI GPT-4o mini (cheap)',  true, 0.15, 0.60, 10),
  ('openai:gpt-4o',        'openai',    'gpt-4o',                    'OpenAI GPT-4o (quality)',     true, 2.50, 10.00, 20),
  ('anthropic:haiku-4-5',  'anthropic', 'claude-haiku-4-5-20251001', 'Claude Haiku 4.5 (cheap)',    true, 1.00, 5.00, 30),
  ('anthropic:sonnet-4-6', 'anthropic', 'claude-sonnet-4-6',         'Claude Sonnet 4.6 (quality)', true, 3.00, 15.00, 40)
ON CONFLICT (key) DO NOTHING;

-- System default model pointer.
INSERT INTO proofread_settings (id, default_model_key) VALUES (1, 'openai:gpt-4o-mini')
ON CONFLICT (id) DO NOTHING;

-- Seed the 3 modes; pravopis_gramatika_interpunkce is the default mode.
INSERT INTO proofread_prompts (mode, label, body, is_default_mode) VALUES
  ('pravopis_gramatika', 'Pravopis + gramatika',
   'Jsi korektor českého textu. Oprav POUZE pravopisné a gramatické chyby (shoda podmětu s přísudkem, koncovky, i/y, velká písmena, překlepy). NEopravuj interpunkci ani styl. Zachovej beze změny veškeré HTML značky, atributy a strukturu; uvnitř značek text neměň. Vrať opravený text a strukturovaný seznam změn.',
   false),
  ('pravopis_gramatika_interpunkce', 'Pravopis + gramatika + interpunkce',
   'Jsi korektor českého textu. Oprav pravopisné a gramatické chyby a interpunkci (čárky, tečky, mezery, uvozovky, pomlčky). NEMĚŇ slovosled ani styl nad rámec nezbytných oprav. Zachovej beze změny veškeré HTML značky, atributy a strukturu; uvnitř značek text neměň. Vrať opravený text a strukturovaný seznam změn.',
   true),
  ('jemna_stylistika', 'Jemná stylistika',
   'Jsi jazykový korektor a stylistický redaktor českého textu. Oprav pravopis, gramatiku a interpunkci a navíc proveď JEMNÉ stylistické úpravy (plynulost, opakování slov, neobratné vazby), ale zachovej autorův hlas a význam. Zachovej beze změny veškeré HTML značky, atributy a strukturu; uvnitř značek text neměň. Vrať opravený text a strukturovaný seznam změn.',
   false)
ON CONFLICT (mode) DO NOTHING;
