/*
# SaaS Foundation — Companies, Profiles, Audit Logs

## Summary
Transforms InventoryBlind from single-tenant to multi-tenant SaaS.
Creates company isolation, role-based access, and audit logging.

## New Tables
- companies: name, slug, owner_id, plan, settings
- profiles: mirrors auth.users, adds company_id and role
- audit_logs: action history per company

## Security
All tables have RLS. Policies use subqueries so companies table
can be created before profiles (avoiding the circular reference
that caused the previous error).
*/

-- ─── companies ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS companies (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text UNIQUE NOT NULL,
  owner_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  plan        text NOT NULL DEFAULT 'starter'
              CHECK (plan IN ('starter','professional','enterprise')),
  settings    jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS companies_owner_id_idx ON companies (owner_id);
CREATE INDEX IF NOT EXISTS companies_slug_idx     ON companies (slug);

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

-- ─── profiles ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS profiles (
  id                   uuid PRIMARY KEY DEFAULT auth.uid()
                       REFERENCES auth.users(id) ON DELETE CASCADE,
  name                 text,
  email                text,
  company_id           uuid REFERENCES companies(id) ON DELETE SET NULL,
  role                 text NOT NULL DEFAULT 'counter'
                       CHECK (role IN ('owner','admin','manager','counter','viewer')),
  must_change_password boolean NOT NULL DEFAULT false,
  created_at           timestamptz DEFAULT now(),
  updated_at           timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS profiles_company_id_idx ON profiles (company_id);
CREATE INDEX IF NOT EXISTS profiles_email_idx      ON profiles (email);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- ─── RLS on companies (now profiles exists) ───────────────────────────────────

DROP POLICY IF EXISTS "companies_select" ON companies;
CREATE POLICY "companies_select" ON companies FOR SELECT
  TO authenticated
  USING (
    id IN (SELECT company_id FROM profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "companies_insert" ON companies;
CREATE POLICY "companies_insert" ON companies FOR INSERT
  TO authenticated
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "companies_update" ON companies;
CREATE POLICY "companies_update" ON companies FOR UPDATE
  TO authenticated
  USING (
    id IN (SELECT company_id FROM profiles WHERE id = auth.uid() AND role IN ('owner','admin'))
  )
  WITH CHECK (
    id IN (SELECT company_id FROM profiles WHERE id = auth.uid() AND role IN ('owner','admin'))
  );

-- ─── RLS on profiles ──────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "profiles_select" ON profiles;
CREATE POLICY "profiles_select" ON profiles FOR SELECT
  TO authenticated
  USING (
    id = auth.uid()
    OR company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "profiles_insert" ON profiles;
CREATE POLICY "profiles_insert" ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "profiles_update" ON profiles;
CREATE POLICY "profiles_update" ON profiles FOR UPDATE
  TO authenticated
  USING (
    id = auth.uid()
    OR company_id IN (
      SELECT company_id FROM profiles WHERE id = auth.uid() AND role IN ('owner','admin')
    )
  )
  WITH CHECK (
    id = auth.uid()
    OR company_id IN (
      SELECT company_id FROM profiles WHERE id = auth.uid() AND role IN ('owner','admin')
    )
  );

-- ─── audit_logs ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    text,
  user_id       uuid,
  user_email    text,
  action        text NOT NULL,
  resource_type text,
  resource_id   text,
  ip_address    text,
  metadata      jsonb DEFAULT '{}',
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_logs_company_id_idx ON audit_logs (company_id);
CREATE INDEX IF NOT EXISTS audit_logs_user_id_idx    ON audit_logs (user_id);
CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs (created_at DESC);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_logs_insert" ON audit_logs;
CREATE POLICY "audit_logs_insert" ON audit_logs FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "audit_logs_select" ON audit_logs;
CREATE POLICY "audit_logs_select" ON audit_logs FOR SELECT
  TO authenticated
  USING (
    company_id IN (
      SELECT p.company_id::text FROM profiles p
      WHERE p.id = auth.uid() AND p.role IN ('owner','admin')
    )
  );

-- ─── updated_at triggers ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS companies_updated_at ON companies;
CREATE TRIGGER companies_updated_at
  BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS profiles_updated_at ON profiles;
CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─── Helper functions ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_my_company_id()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT company_id::text FROM profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION get_my_role()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT role FROM profiles WHERE id = auth.uid()
$$;
