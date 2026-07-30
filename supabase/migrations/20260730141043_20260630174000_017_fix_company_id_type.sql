/*
# Fix company_id Type Inconsistency (text -> uuid) — audit_logs & security_logs

## Problem
audit_logs and security_logs have company_id as text, while companies.id
is uuid. This is fragile (implicit cast errors).

## Fix
1. Drop policies that reference company_id on both tables
2. Convert company_id to uuid
3. Add FK constraints to companies(id)
4. Recreate policies using company_id::text = get_my_company_id() pattern
   (get_my_company_id() returns text, so we cast uuid column to text)

## Important Notes
- Both tables are empty (verified), so no data loss.
- All other tables still use text for company_id, so the ::text cast pattern
  is consistent across the entire codebase.
*/

-- ── 1. Drop policies that reference company_id ───────────────────────────────
DROP POLICY IF EXISTS audit_logs_select ON public.audit_logs;
DROP POLICY IF EXISTS audit_logs_insert ON public.audit_logs;

DROP POLICY IF EXISTS security_logs_select ON public.security_logs;
DROP POLICY IF EXISTS security_logs_insert ON public.security_logs;

-- ── 2. Convert company_id to uuid ─────────────────────────────────────────────
ALTER TABLE audit_logs ALTER COLUMN company_id DROP DEFAULT;
ALTER TABLE audit_logs ALTER COLUMN company_id TYPE uuid USING company_id::uuid;
ALTER TABLE audit_logs ALTER COLUMN company_id SET DEFAULT get_my_company_id()::uuid;

ALTER TABLE security_logs ALTER COLUMN company_id DROP DEFAULT;
ALTER TABLE security_logs ALTER COLUMN company_id TYPE uuid USING company_id::uuid;
ALTER TABLE security_logs ALTER COLUMN company_id SET DEFAULT get_my_company_id()::uuid;

-- ── 3. Add foreign keys ────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'audit_logs_company_id_fkey'
  ) THEN
    ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_company_id_fkey
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'security_logs_company_id_fkey'
  ) THEN
    ALTER TABLE security_logs ADD CONSTRAINT security_logs_company_id_fkey
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ── 4. Recreate policies ──────────────────────────────────────────────────────
-- audit_logs: SELECT for owner/admin only, INSERT for any authenticated same-company
CREATE POLICY audit_logs_select ON public.audit_logs
  FOR SELECT TO authenticated
  USING (company_id::text = get_my_company_id() AND get_my_role() IN ('owner','admin'));

CREATE POLICY audit_logs_insert ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (company_id::text = get_my_company_id());

-- security_logs: SELECT for owner/admin only, INSERT for any authenticated same-company
CREATE POLICY security_logs_select ON public.security_logs
  FOR SELECT TO authenticated
  USING (company_id::text = get_my_company_id() AND get_my_role() IN ('owner','admin'));

CREATE POLICY security_logs_insert ON public.security_logs
  FOR INSERT TO authenticated
  WITH CHECK (company_id::text = get_my_company_id());

/*
# Audit Query — paste into Supabase SQL Editor to verify no insecure policies remain:

SELECT tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
AND (qual ILIKE '%true%' OR with_check ILIKE '%true%' OR 'anon' = ANY(roles))
ORDER BY tablename;
*/
