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
  image_url TEXT
);

CREATE INDEX IF NOT EXISTS article_titles_page_idx
  ON article_titles(page_path, captured_at DESC);

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
  ADD COLUMN IF NOT EXISTS coverage_model TEXT NOT NULL DEFAULT 'claude-haiku-4-5-20251001';
