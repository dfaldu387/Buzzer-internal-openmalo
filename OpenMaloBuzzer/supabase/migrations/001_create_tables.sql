-- Buzzer App - Supabase Database Schema
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/uqjlftjosdufuxivpahi/sql

-- Users
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  pin_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'manager', 'member')),
  last_seen_at BIGINT NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint,
  is_active BOOLEAN NOT NULL DEFAULT true
);

-- Buzzes
CREATE TABLE IF NOT EXISTS buzzes (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  from_user_id TEXT NOT NULL,
  to_user_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  note TEXT,
  created_at BIGINT NOT NULL,
  responded_at BIGINT,
  response TEXT NOT NULL DEFAULT 'none',
  escalated BOOLEAN NOT NULL DEFAULT false,
  group_id TEXT,
  group_name TEXT
);

-- Reasons
CREATE TABLE IF NOT EXISTS reasons (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true
);

-- Groups
CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL,
  member_ids TEXT[] NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true
);

-- FCM Tokens
CREATE TABLE IF NOT EXISTS user_tokens (
  user_id TEXT PRIMARY KEY,
  fcm_token TEXT,
  fcm_token_stale BOOLEAN DEFAULT false,
  stale_since TIMESTAMPTZ
);

-- Voice Mails
CREATE TABLE IF NOT EXISTS voice_mails (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  from_user_id TEXT NOT NULL,
  from_user_name TEXT,
  to_user_id TEXT NOT NULL,
  audio_url TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  listened BOOLEAN NOT NULL DEFAULT false,
  deleted BOOLEAN NOT NULL DEFAULT false
);

-- Call Logs
CREATE TABLE IF NOT EXISTS call_logs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  caller_id TEXT NOT NULL,
  receiver_id TEXT NOT NULL,
  started_at BIGINT NOT NULL,
  duration_seconds INTEGER NOT NULL DEFAULT 0
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_buzzes_to_user ON buzzes(to_user_id, response);
CREATE INDEX IF NOT EXISTS idx_buzzes_from_user ON buzzes(from_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_buzzes_created_at ON buzzes(created_at);
CREATE INDEX IF NOT EXISTS idx_voice_mails_to_user ON voice_mails(to_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);

-- Enable RLS (required for Supabase Realtime)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE buzzes ENABLE ROW LEVEL SECURITY;
ALTER TABLE reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_mails ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_logs ENABLE ROW LEVEL SECURITY;

-- Permissive policies (internal app, 15 users)
CREATE POLICY "allow_all" ON users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON buzzes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON reasons FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON groups FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON user_tokens FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON voice_mails FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON call_logs FOR ALL USING (true) WITH CHECK (true);

-- Enable Realtime on tables that need live updates
ALTER PUBLICATION supabase_realtime ADD TABLE users;
ALTER PUBLICATION supabase_realtime ADD TABLE buzzes;
ALTER PUBLICATION supabase_realtime ADD TABLE reasons;
ALTER PUBLICATION supabase_realtime ADD TABLE groups;
ALTER PUBLICATION supabase_realtime ADD TABLE voice_mails;
