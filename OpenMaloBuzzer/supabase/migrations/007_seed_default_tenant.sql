-- Seed default tenant and backfill all existing data
DO $$
DECLARE
  tid TEXT;
BEGIN
  INSERT INTO tenants (name, code) VALUES ('OpenMalo', 'OP')
  RETURNING id INTO tid;

  UPDATE users SET tenant_id = tid WHERE tenant_id IS NULL;
  UPDATE buzzes SET tenant_id = tid WHERE tenant_id IS NULL;
  UPDATE reasons SET tenant_id = tid WHERE tenant_id IS NULL;
  UPDATE groups SET tenant_id = tid WHERE tenant_id IS NULL;
  UPDATE user_tokens SET tenant_id = tid WHERE tenant_id IS NULL;
  UPDATE voice_mails SET tenant_id = tid WHERE tenant_id IS NULL;
  UPDATE call_logs SET tenant_id = tid WHERE tenant_id IS NULL;
  UPDATE user_favorites SET tenant_id = tid WHERE tenant_id IS NULL;

  RAISE NOTICE 'Default tenant created with id: %, code: OP. All existing data backfilled.', tid;
END $$;
