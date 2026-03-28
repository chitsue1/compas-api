-- Migration 002: Add AI usage tracking to users
-- Run after 001_schema.sql

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS ai_uses_count    INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_uses_reset_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days');
