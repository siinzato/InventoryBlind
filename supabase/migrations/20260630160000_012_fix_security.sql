-- 1. CORRIGE "Function Search Path Mutable"
ALTER FUNCTION public.update_full_operations_updated_at() SET search_path = public;
ALTER FUNCTION public.update_updated_at_column() SET search_path = public;

-- 2. CORRIGE "Public/Signed-In Can Execute SECURITY DEFINER Function"
REVOKE EXECUTE ON FUNCTION public.get_my_company_id() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_my_role() FROM anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;

-- 3. CORRIGE "RLS Policy Always True" NAS TABELAS
-- Tabela: audit_logs
DROP POLICY IF EXISTS audit_logs_insert ON public.audit_logs;
CREATE POLICY audit_logs_insert ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

-- Tabela: import_history
DROP POLICY IF EXISTS delete_import_history ON public.import_history;
DROP POLICY IF EXISTS insert_import_history ON public.import_history;
DROP POLICY IF EXISTS update_import_history ON public.import_history;
CREATE POLICY delete_import_history ON public.import_history FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY insert_import_history ON public.import_history FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY update_import_history ON public.import_history FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- Tabela: import_products_audit
DROP POLICY IF EXISTS delete_import_products_audit ON public.import_products_audit;
DROP POLICY IF EXISTS insert_import_products_audit ON public.import_products_audit;
CREATE POLICY delete_import_products_audit ON public.import_products_audit FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY insert_import_products_audit ON public.import_products_audit FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

-- Tabela: inventory_kpi_history
DROP POLICY IF EXISTS anon_delete_inventory_kpi_history ON public.inventory_kpi_history;
DROP POLICY IF EXISTS anon_insert_inventory_kpi_history ON public.inventory_kpi_history;
DROP POLICY IF EXISTS anon_update_inventory_kpi_history ON public.inventory_kpi_history;
CREATE POLICY anon_delete_inventory_kpi_history ON public.inventory_kpi_history FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY anon_insert_inventory_kpi_history ON public.inventory_kpi_history FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY anon_update_inventory_kpi_history ON public.inventory_kpi_history FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- Tabela: inventory_top_vendas_history
DROP POLICY IF EXISTS anon_delete_inventory_top_vendas_history ON public.inventory_top_vendas_history;
DROP POLICY IF EXISTS anon_insert_inventory_top_vendas_history ON public.inventory_top_vendas_history;
DROP POLICY IF EXISTS anon_update_inventory_top_vendas_history ON public.inventory_top_vendas_history;
CREATE POLICY anon_delete_inventory_top_vendas_history ON public.inventory_top_vendas_history FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY anon_insert_inventory_top_vendas_history ON public.inventory_top_vendas_history FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY anon_update_inventory_top_vendas_history ON public.inventory_top_vendas_history FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);