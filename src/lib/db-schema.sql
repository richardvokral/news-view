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
-- ADMIN_EMAILS env var bypasses these tables entirely.
-- Resolution for signed-in user: admin -> access_users (exact email) -> access_domains -> deny.
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

-- Per-user saved dashboard layout (keyed by email).
CREATE TABLE IF NOT EXISTS dashboard_user_layouts (
  email TEXT PRIMARY KEY,
  widgets JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Singleton admin-editable default (id=1 enforced).
CREATE TABLE IF NOT EXISTS dashboard_defaults (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  widgets JSONB NOT NULL,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Phase B placeholders (declared now so future migrations are zero-work; unused in Phase A).
CREATE TABLE IF NOT EXISTS article_monitors (
  page_path TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_checked_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

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
