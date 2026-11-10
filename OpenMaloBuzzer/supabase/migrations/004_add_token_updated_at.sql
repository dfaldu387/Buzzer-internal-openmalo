-- Track when the FCM token was last refreshed so we can detect dormant
-- devices whose tokens may be stale even before a push attempt fails.
ALTER TABLE user_tokens ADD COLUMN IF NOT EXISTS token_updated_at BIGINT;
