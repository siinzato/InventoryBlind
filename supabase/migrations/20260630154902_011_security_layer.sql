-- Migration 011: Security layer — new tables + proper RLS on all operational tables

-- ── 1. Extend audit_logs with missing columns ─────────────────────────────────
ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS user_agent  text;

-- ── 2. security_logs table ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS security_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  text NOT NULL,
  user_id     uuid,
  event_type  text NOT NULL,
  severity    text NOT NULL CHECK (severity IN ('info','warning','high','critical')),
  description text,
  ip_address  text,
  user_agent  text,
  metadata    jsonb DEFAULT '{}'::jsonb,
  created_at  timestamptz DEFAULT now()
);
ALTER TABLE security_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "security_logs_select" ON security_logs
  FOR SELECT TO authenticated
  USING (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin']));

CREATE POLICY "security_logs_insert" ON security_logs
  FOR INSERT TO authenticated
  WITH CHECK (company_id = get_my_company_id());

-- ── 3. company_security_settings table ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS company_security_settings (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                 text UNIQUE NOT NULL,
  require_email_confirmation boolean  DEFAULT true,
  require_2fa                boolean  DEFAULT false,
  session_timeout_minutes    integer  DEFAULT 480,
  max_failed_login_attempts  integer  DEFAULT 5,
  max_upload_size_mb         integer  DEFAULT 10,
  allowed_file_types         text[]   DEFAULT ARRAY['.xlsx','.xls','.csv'],
  created_at                 timestamptz DEFAULT now(),
  updated_at                 timestamptz DEFAULT now()
);
ALTER TABLE company_security_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "css_select" ON company_security_settings
  FOR SELECT TO authenticated
  USING (company_id = get_my_company_id());

CREATE POLICY "css_insert" ON company_security_settings
  FOR INSERT TO authenticated
  WITH CHECK (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin']));

CREATE POLICY "css_update" ON company_security_settings
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin']))
  WITH CHECK (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin']));

-- ── 4. erp_integrations table ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp_integrations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      text NOT NULL,
  provider        text NOT NULL,
  token_masked    text,
  status          text NOT NULL DEFAULT 'inactive' CHECK (status IN ('active','inactive','error')),
  last_sync_at    timestamptz,
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);
ALTER TABLE erp_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "erp_select" ON erp_integrations
  FOR SELECT TO authenticated
  USING (company_id = get_my_company_id());

CREATE POLICY "erp_insert" ON erp_integrations
  FOR INSERT TO authenticated
  WITH CHECK (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin']));

CREATE POLICY "erp_update" ON erp_integrations
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin']))
  WITH CHECK (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin']));

CREATE POLICY "erp_delete" ON erp_integrations
  FOR DELETE TO authenticated
  USING (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin']));

-- ── 5. Fix RLS on operational tables — replace permissive policies ────────────

-- inventory_brands
DROP POLICY IF EXISTS "anon_crud_inventory_brands"   ON inventory_brands;
DROP POLICY IF EXISTS "anon_delete_inventory_brands" ON inventory_brands;
DROP POLICY IF EXISTS "anon_insert_inventory_brands" ON inventory_brands;
DROP POLICY IF EXISTS "anon_update_inventory_brands" ON inventory_brands;

CREATE POLICY "inv_brands_select" ON inventory_brands
  FOR SELECT TO authenticated USING (company_id = get_my_company_id());
CREATE POLICY "inv_brands_insert" ON inventory_brands
  FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "inv_brands_update" ON inventory_brands
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id()) WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "inv_brands_delete" ON inventory_brands
  FOR DELETE TO authenticated USING (company_id = get_my_company_id());

-- top_vendas
DROP POLICY IF EXISTS "anon_crud_top_vendas"   ON top_vendas;
DROP POLICY IF EXISTS "anon_delete_top_vendas" ON top_vendas;
DROP POLICY IF EXISTS "anon_insert_top_vendas" ON top_vendas;
DROP POLICY IF EXISTS "anon_update_top_vendas" ON top_vendas;

CREATE POLICY "top_vendas_select" ON top_vendas
  FOR SELECT TO authenticated USING (company_id = get_my_company_id());
CREATE POLICY "top_vendas_insert" ON top_vendas
  FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "top_vendas_update" ON top_vendas
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id()) WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "top_vendas_delete" ON top_vendas
  FOR DELETE TO authenticated USING (company_id = get_my_company_id());

-- custom_kpis
DROP POLICY IF EXISTS "anon_crud_custom_kpis"   ON custom_kpis;
DROP POLICY IF EXISTS "anon_delete_custom_kpis" ON custom_kpis;
DROP POLICY IF EXISTS "anon_insert_custom_kpis" ON custom_kpis;
DROP POLICY IF EXISTS "anon_update_custom_kpis" ON custom_kpis;

CREATE POLICY "custom_kpis_select" ON custom_kpis
  FOR SELECT TO authenticated USING (company_id = get_my_company_id());
CREATE POLICY "custom_kpis_insert" ON custom_kpis
  FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "custom_kpis_update" ON custom_kpis
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id()) WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "custom_kpis_delete" ON custom_kpis
  FOR DELETE TO authenticated USING (company_id = get_my_company_id());

-- products
DROP POLICY IF EXISTS "select_products" ON products;
DROP POLICY IF EXISTS "insert_products" ON products;
DROP POLICY IF EXISTS "update_products" ON products;
DROP POLICY IF EXISTS "delete_products" ON products;

CREATE POLICY "products_select" ON products
  FOR SELECT TO authenticated USING (company_id = get_my_company_id());
CREATE POLICY "products_insert" ON products
  FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "products_update" ON products
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id()) WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "products_delete" ON products
  FOR DELETE TO authenticated USING (company_id = get_my_company_id());

-- full_operations
DROP POLICY IF EXISTS "full_ops_select" ON full_operations;
DROP POLICY IF EXISTS "full_ops_insert" ON full_operations;
DROP POLICY IF EXISTS "full_ops_update" ON full_operations;
DROP POLICY IF EXISTS "full_ops_delete" ON full_operations;

CREATE POLICY "full_ops_select" ON full_operations
  FOR SELECT TO authenticated USING (company_id = get_my_company_id());
CREATE POLICY "full_ops_insert" ON full_operations
  FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "full_ops_update" ON full_operations
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id()) WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "full_ops_delete" ON full_operations
  FOR DELETE TO authenticated USING (company_id = get_my_company_id());

-- full_operation_items
DROP POLICY IF EXISTS "full_items_select" ON full_operation_items;
DROP POLICY IF EXISTS "full_items_insert" ON full_operation_items;
DROP POLICY IF EXISTS "full_items_update" ON full_operation_items;
DROP POLICY IF EXISTS "full_items_delete" ON full_operation_items;

CREATE POLICY "full_items_select" ON full_operation_items
  FOR SELECT TO authenticated USING (company_id = get_my_company_id());
CREATE POLICY "full_items_insert" ON full_operation_items
  FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "full_items_update" ON full_operation_items
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id()) WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "full_items_delete" ON full_operation_items
  FOR DELETE TO authenticated USING (company_id = get_my_company_id());

-- inventory_snapshots
DROP POLICY IF EXISTS "anon_crud_inventory_snapshots"   ON inventory_snapshots;
DROP POLICY IF EXISTS "anon_delete_inventory_snapshots" ON inventory_snapshots;
DROP POLICY IF EXISTS "anon_insert_inventory_snapshots" ON inventory_snapshots;
DROP POLICY IF EXISTS "anon_update_inventory_snapshots" ON inventory_snapshots;

CREATE POLICY "inv_snap_select" ON inventory_snapshots
  FOR SELECT TO authenticated USING (company_id = get_my_company_id());
CREATE POLICY "inv_snap_insert" ON inventory_snapshots
  FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "inv_snap_update" ON inventory_snapshots
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id()) WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "inv_snap_delete" ON inventory_snapshots
  FOR DELETE TO authenticated USING (company_id = get_my_company_id());

-- inventory_brand_history
DROP POLICY IF EXISTS "anon_crud_inventory_brand_history"   ON inventory_brand_history;
DROP POLICY IF EXISTS "anon_delete_inventory_brand_history" ON inventory_brand_history;
DROP POLICY IF EXISTS "anon_insert_inventory_brand_history" ON inventory_brand_history;
DROP POLICY IF EXISTS "anon_update_inventory_brand_history" ON inventory_brand_history;

CREATE POLICY "inv_bh_select" ON inventory_brand_history
  FOR SELECT TO authenticated USING (company_id = get_my_company_id());
CREATE POLICY "inv_bh_insert" ON inventory_brand_history
  FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "inv_bh_update" ON inventory_brand_history
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id()) WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "inv_bh_delete" ON inventory_brand_history
  FOR DELETE TO authenticated USING (company_id = get_my_company_id());

-- audit_logs: fix recursive select policy
DROP POLICY IF EXISTS "audit_logs_select" ON audit_logs;
CREATE POLICY "audit_logs_select" ON audit_logs
  FOR SELECT TO authenticated
  USING (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin']));

-- ── 6. Seed default security settings for AZ ─────────────────────────────────
INSERT INTO company_security_settings (company_id)
VALUES ('00000000-0000-0000-0000-000000000001')
ON CONFLICT (company_id) DO NOTHING;
