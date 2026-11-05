-- User Favorites (persists across reinstall/logout)
CREATE TABLE IF NOT EXISTS user_favorites (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL,
  target_user_id TEXT NOT NULL,
  reasons TEXT[] NOT NULL DEFAULT '{}',
  reason_sounds JSONB DEFAULT '{}',
  created_at BIGINT NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint,
  UNIQUE(user_id, target_user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_favorites_user ON user_favorites(user_id);

ALTER TABLE user_favorites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all" ON user_favorites FOR ALL USING (true) WITH CHECK (true);
