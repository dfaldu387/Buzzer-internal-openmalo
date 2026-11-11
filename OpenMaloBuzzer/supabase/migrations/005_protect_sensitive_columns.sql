-- Protect sensitive columns (pin_hash, role) from direct modification via anon key.
-- All changes to these columns must go through the admin-action Edge Function,
-- which verifies the caller's identity and role using the service_role key.

-- 1. Trigger: block UPDATE of pin_hash and role via anon key
CREATE OR REPLACE FUNCTION protect_user_sensitive_columns()
RETURNS trigger AS $$
DECLARE
  jwt_role TEXT;
BEGIN
  -- Extract role from JWT claims set by PostgREST.
  -- service_role = Edge Functions, anon = client app, NULL = internal DB call.
  BEGIN
    jwt_role := current_setting('request.jwt.claims', true)::json->>'role';
  EXCEPTION WHEN OTHERS THEN
    jwt_role := NULL;
  END;

  -- Allow service_role (Edge Functions) and internal DB operations (no JWT)
  IF jwt_role = 'service_role' OR jwt_role IS NULL THEN
    RETURN NEW;
  END IF;

  -- Block anon key from changing sensitive columns
  IF OLD.pin_hash IS DISTINCT FROM NEW.pin_hash THEN
    RAISE EXCEPTION 'pin_hash can only be changed through the admin-action endpoint';
  END IF;
  IF OLD.role IS DISTINCT FROM NEW.role THEN
    RAISE EXCEPTION 'role can only be changed through the admin-action endpoint';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER protect_users_sensitive_update
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION protect_user_sensitive_columns();

-- 2. Replace the wide-open users policy with granular ones.
--    DELETE of active users is restricted to service_role (Edge Function).
--    Inactive users can be cleaned up via anon key (signup dedup flow).
DROP POLICY IF EXISTS "allow_all" ON users;

CREATE POLICY "users_select"  ON users FOR SELECT USING (true);
CREATE POLICY "users_insert"  ON users FOR INSERT WITH CHECK (true);
CREATE POLICY "users_update"  ON users FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "users_delete"  ON users FOR DELETE USING (
  COALESCE(
    (current_setting('request.jwt.claims', true)::json->>'role'),
    'service_role'  -- NULL means internal call, allow it
  ) = 'service_role'
  OR is_active = false
);
