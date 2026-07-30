/*
# Fix 21 Security Audit Issues

## Overview
This migration resolves all security issues identified by the Supabase security advisor:
- 3 SECURITY DEFINER functions with mutable search_path
- 3 SECURITY DEFINER functions executable by the anon role
- 16 overly-permissive RLS policies using USING(true) / WITH CHECK(true)

## 1. Functions — Fix Mutable Search Path (3 issues)
The functions `get_my_company_id`, `get_my_role`, and `handle_new_user` are
SECURITY DEFINER but did not have a fixed search_path, making them vulnerable
to search-path hijacking. We explicitly set search_path=public on each.

## 2. Functions — Revoke anon Execute (3 issues)
The same 3 SECURITY DEFINER functions were executable by the `anon` role,
allowing unauthenticated users to invoke privileged functions. We REVOKE
execute from anon (and from authenticated for handle_new_user, which is a
trigger function that should only run via the trigger).

## 3. RLS Policies — Replace USING(true) (16 issues across 5 tables)
The following tables had policies with USING(true) or WITH CHECK(true),
meaning ANY authenticated user could read/modify ANY row regardless of
company ownership:
  - audit_logs (1 policy: insert)
  - import_history (4 policies: select, insert, update, delete)
  - import_products_audit (3 policies: select, insert, delete)
  - inventory_kpi_history (4 policies: select, insert, update, delete)
  - inventory_top_vendas_history (4 policies: select, insert, update, delete)

Three of these tables (import_products_audit, inventory_kpi_history,
inventory_top_vendas_history) lacked a company_id column entirely, making
company-scoped RLS impossible. We add company_id to each, backfill from
parent tables via FK joins, set NOT NULL, and add a default for future
inserts. Then we replace all 16 permissive policies with proper
company-ownership-scoped policies using get_my_company_id().

## Important Notes
- No data is deleted or lost; company_id is backfilled from existing FK relationships.
- import_products_audit.company_id is backfilled from import_history.company_id.
- inventory_kpi_history and inventory_top_vendas_history company_id backfilled
  from inventory_snapshots.company_id via snapshot_id FK.
- All new policies use get_my_company_id() for tenant isolation, consistent
  with the rest of the platform.
*/

-- ── 1. Fix search_path on SECURITY DEFINER functions ──────────────────────────
ALTER FUNCTION public.get_my_company_id() SET search_path = public;
ALTER FUNCTION public.get_my_role() SET search_path = public;
ALTER FUNCTION public.handle_new_user() SET search_path = public;

-- ── 2. Revoke anon execute on SECURITY DEFINER functions ──────────────────────
REVOKE EXECUTE ON FUNCTION public.get_my_company_id() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_my_role() FROM anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;

-- ── 3. Add company_id to tables that lack it ──────────────────────────────────

-- import_products_audit: add company_id, backfill from import_history
ALTER TABLE import_products_audit ADD COLUMN IF NOT EXISTS company_id text;
UPDATE import_products_audit ipa
  SET company_id = ih.company_id
  FROM import_history ih
  WHERE ipa.import_id = ih.id AND ipa.company_id IS NULL;
ALTER TABLE import_products_audit ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE import_products_audit ALTER COLUMN company_id SET DEFAULT get_my_company_id();

-- inventory_kpi_history: add company_id, backfill from inventory_snapshots
ALTER TABLE inventory_kpi_history ADD COLUMN IF NOT EXISTS company_id text;
UPDATE inventory_kpi_history ikh
  SET company_id = isnap.company_id
  FROM inventory_snapshots isnap
  WHERE ikh.snapshot_id = isnap.id AND ikh.company_id IS NULL;
ALTER TABLE inventory_kpi_history ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE inventory_kpi_history ALTER COLUMN company_id SET DEFAULT get_my_company_id();

-- inventory_top_vendas_history: add company_id, backfill from inventory_snapshots
ALTER TABLE inventory_top_vendas_history ADD COLUMN IF NOT EXISTS company_id text;
UPDATE inventory_top_vendas_history itvh
  SET company_id = isnap.company_id
  FROM inventory_snapshots isnap
  WHERE itvh.snapshot_id = isnap.id AND itvh.company_id IS NULL;
ALTER TABLE inventory_top_vendas_history ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE inventory_top_vendas_history ALTER COLUMN company_id SET DEFAULT get_my_company_id();

-- ── 4. Replace overly-permissive policies ─────────────────────────────────────

-- audit_logs: fix insert policy (was WITH CHECK (true))
DROP POLICY IF EXISTS audit_logs_insert ON public.audit_logs;
CREATE POLICY audit_logs_insert ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (company_id = get_my_company_id());

-- import_history: replace all 4 policies
DROP POLICY IF EXISTS select_import_history ON public.import_history;
DROP POLICY IF EXISTS insert_import_history ON public.import_history;
DROP POLICY IF EXISTS update_import_history ON public.import_history;
DROP POLICY IF EXISTS delete_import_history ON public.import_history;

CREATE POLICY select_import_history ON public.import_history
  FOR SELECT TO authenticated USING (company_id = get_my_company_id());
CREATE POLICY insert_import_history ON public.import_history
  FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id());
CREATE POLICY update_import_history ON public.import_history
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id()) WITH CHECK (company_id = get_my_company_id());
CREATE POLICY delete_import_history ON public.import_history
  FOR DELETE TO authenticated USING (company_id = get_my_company_id());

-- import_products_audit: replace all 3 policies
DROP POLICY IF EXISTS select_import_products_audit ON public.import_products_audit;
DROP POLICY IF EXISTS insert_import_products_audit ON public.import_products_audit;
DROP POLICY IF EXISTS delete_import_products_audit ON public.import_products_audit;

CREATE POLICY select_import_products_audit ON public.import_products_audit
  FOR SELECT TO authenticated USING (company_id = get_my_company_id());
CREATE POLICY insert_import_products_audit ON public.import_products_audit
  FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id());
CREATE POLICY delete_import_products_audit ON public.import_products_audit
  FOR DELETE TO authenticated USING (company_id = get_my_company_id());

-- inventory_kpi_history: replace all 4 policies
DROP POLICY IF EXISTS anon_crud_inventory_kpi_history ON public.inventory_kpi_history;
DROP POLICY IF EXISTS anon_delete_inventory_kpi_history ON public.inventory_kpi_history;
DROP POLICY IF EXISTS anon_insert_inventory_kpi_history ON public.inventory_kpi_history;
DROP POLICY IF EXISTS anon_update_inventory_kpi_history ON public.inventory_kpi_history;

CREATE POLICY inv_kpi_hist_select ON public.inventory_kpi_history
  FOR SELECT TO authenticated USING (company_id = get_my_company_id());
CREATE POLICY inv_kpi_hist_insert ON public.inventory_kpi_history
  FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id());
CREATE POLICY inv_kpi_hist_update ON public.inventory_kpi_history
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id()) WITH CHECK (company_id = get_my_company_id());
CREATE POLICY inv_kpi_hist_delete ON public.inventory_kpi_history
  FOR DELETE TO authenticated USING (company_id = get_my_company_id());

-- inventory_top_vendas_history: replace all 4 policies
DROP POLICY IF EXISTS anon_crud_inventory_top_vendas_history ON public.inventory_top_vendas_history;
DROP POLICY IF EXISTS anon_delete_inventory_top_vendas_history ON public.inventory_top_vendas_history;
DROP POLICY IF EXISTS anon_insert_inventory_top_vendas_history ON public.inventory_top_vendas_history;
DROP POLICY IF EXISTS anon_update_inventory_top_vendas_history ON public.inventory_top_vendas_history;

CREATE POLICY inv_tv_hist_select ON public.inventory_top_vendas_history
  FOR SELECT TO authenticated USING (company_id = get_my_company_id());
CREATE POLICY inv_tv_hist_insert ON public.inventory_top_vendas_history
  FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id());
CREATE POLICY inv_tv_hist_update ON public.inventory_top_vendas_history
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id()) WITH CHECK (company_id = get_my_company_id());
CREATE POLICY inv_tv_hist_delete ON public.inventory_top_vendas_history
  FOR DELETE TO authenticated USING (company_id = get_my_company_id());
