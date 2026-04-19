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

-- Monitor config (singleton). Edited via /admin/monitor.
CREATE TABLE IF NOT EXISTS monitor_config (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled BOOLEAN NOT NULL DEFAULT false,
  interval_seconds INTEGER NOT NULL DEFAULT 300,
  window_hours INTEGER NOT NULL DEFAULT 48,
  retention_days INTEGER NOT NULL DEFAULT 7,
  max_requests_per_hour INTEGER NOT NULL DEFAULT 240,
  site_patterns JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
