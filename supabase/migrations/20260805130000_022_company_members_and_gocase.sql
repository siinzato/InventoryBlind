/*
# Multi-company switching — company_members + GoCase seed

## Summary
Introduces a real company-switching mechanism. `get_my_company_id()` /
`get_my_role()` (008_saas_foundation.sql) already resolve the active company
from a single source — `profiles.company_id`/`profiles.role` of the caller's
row — so every existing RLS policy in the system keeps working unchanged.
"Switching companies" is implemented as: verify membership, then update that
one row via a SECURITY DEFINER RPC (same shape as link_user_to_company()).

## New Tables
- company_members: which companies a user may access, and their role in each.
  No client INSERT/UPDATE/DELETE policy — memberships are granted only via
  migration/seed, mirroring the privilege-escalation caution already applied
  to profiles.role in 015_fix_privilege_escalation.sql.

## New Function
- switch_active_company(target_company_id): verifies a company_members row
  exists for the caller, then updates profiles.company_id/role to match it.

## Security addition
- companies_select_via_membership: a SECOND (additive — RLS OR-combines
  policies of the same command) SELECT policy on companies, letting a user
  read the companies they hold a company_members row for. Needed because the
  existing companies_select policy (010_fix_rls_infinite_recursion.sql) only
  allows reading the ONE company matching the caller's current active
  company_id — without this, the switcher couldn't list the user's other
  companies to switch into.

## Seed
- GoCase company (new, empty — every operational table is already
  company_id-scoped, so it starts with zero brands/products/counts/KPIs by
  construction, no explicit zeroing needed).
- company_members backfilled from every existing profile (records today's
  1:1 company_id as an explicit membership, changes nothing for anyone).
- victor@azbuy.com.br additionally linked to GoCase as 'owner'. His
  profiles.company_id is NOT changed here — he keeps opening in AZ by
  default; switching to GoCase happens through the UI switcher.
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. company_members
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS company_members (
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role       text NOT NULL DEFAULT 'viewer'
             CHECK (role IN ('owner','admin','manager','counter','viewer')),
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, company_id)
);

CREATE INDEX IF NOT EXISTS company_members_user_idx ON company_members (user_id);

ALTER TABLE company_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company_members_select" ON company_members;
CREATE POLICY "company_members_select" ON company_members FOR SELECT
  TO authenticated USING (user_id = auth.uid());

-- Deliberately no INSERT/UPDATE/DELETE policy for `authenticated` — memberships
-- are granted only via migration/seed or a future admin-invite RPC, never
-- directly by the client.

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. companies_select_via_membership (additive SELECT policy)
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "companies_select_via_membership" ON companies;
CREATE POLICY "companies_select_via_membership" ON companies FOR SELECT
  TO authenticated
  USING (id IN (SELECT company_id FROM company_members WHERE user_id = auth.uid()));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. switch_active_company() RPC
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.switch_active_company(
  target_company_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role text;
BEGIN
  SELECT role INTO v_role
  FROM company_members
  WHERE user_id = auth.uid() AND company_id = target_company_id;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'User is not a member of this company';
  END IF;

  UPDATE profiles
  SET company_id = target_company_id, role = v_role, updated_at = now()
  WHERE id = auth.uid();
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.switch_active_company(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.switch_active_company(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Backfill company_members from existing profiles
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO company_members (user_id, company_id, role)
SELECT id, company_id, role
FROM profiles
WHERE company_id IS NOT NULL
ON CONFLICT (user_id, company_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Seed GoCase (new, empty company) + link victor@azbuy.com.br as owner
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO companies (id, name, slug, plan, settings)
VALUES (gen_random_uuid(), 'GoCase', 'gocase', 'enterprise', '{"is_seed": true}')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO company_members (user_id, company_id, role)
SELECT u.id, c.id, 'owner'
FROM auth.users u
CROSS JOIN companies c
WHERE u.email = 'victor@azbuy.com.br' AND c.slug = 'gocase'
ON CONFLICT (user_id, company_id) DO NOTHING;
