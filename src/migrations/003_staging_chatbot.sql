-- Migration 003: Virtual Staging + Chatbot support

-- Staging usage tracking on users
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS staging_uses_count     INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS staging_uses_reset_at  TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days');

-- is_staged flag on listing_media
ALTER TABLE listing_media
  ADD COLUMN IF NOT EXISTS is_staged BOOLEAN DEFAULT FALSE;

-- Staging jobs table
CREATE TABLE IF NOT EXISTS staging_jobs (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  listing_id   UUID REFERENCES listings(id) ON DELETE CASCADE,
  user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  source_url   VARCHAR(500) NOT NULL,
  room_type    VARCHAR(50),
  style        VARCHAR(50),
  status       VARCHAR(20) DEFAULT 'processing',  -- processing | done | failed
  result_urls  JSONB,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staging_listing ON staging_jobs(listing_id);
CREATE INDEX IF NOT EXISTS idx_staging_user    ON staging_jobs(user_id);

-- Chat logs (optional analytics)
CREATE TABLE IF NOT EXISTS chat_logs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  user_message    TEXT,
  bot_response    TEXT,
  listings_found  INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_logs_user ON chat_logs(user_id);
