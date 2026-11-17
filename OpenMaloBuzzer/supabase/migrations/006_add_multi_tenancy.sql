-- Multi-tenancy: add tenants table and tenant_id to all data tables.
-- Each tenant is a separate company using the buzzer app.

-- Tenants table
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,  -- short code for login (e.g. 'ACME', 'REST01')
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at BIGINT NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint
);

CREATE INDEX IF NOT EXISTS idx_tenants_code ON tenants(code);

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all" ON tenants FOR ALL USING (true) WITH CHECK (true);

-- Add tenant_id to all data tables
ALTER TABLE users ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE buzzes ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE reasons ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE user_tokens ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE voice_mails ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE user_favorites ADD COLUMN IF NOT EXISTS tenant_id TEXT;

-- Indexes for tenant filtering
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_buzzes_tenant ON buzzes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_reasons_tenant ON reasons(tenant_id);
CREATE INDEX IF NOT EXISTS idx_groups_tenant ON groups(tenant_id);
CREATE INDEX IF NOT EXISTS idx_voice_mails_tenant ON voice_mails(tenant_id);
CREATE INDEX IF NOT EXISTS idx_user_favorites_tenant ON user_favorites(tenant_id);

-- Drop old permissive phone uniqueness (phone is now unique per tenant, not globally)
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_phone_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_tenant ON users(phone, tenant_id);
