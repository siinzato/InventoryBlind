-- Curva ABC (Produtos → Curva ABC): módulo isolado de análise comercial (giro, faturamento,
-- lucro bruto) importada de planilhas. NUNCA escreve em products, inventory_* ou physical_count_*.
-- Recomendações são informativas; nenhuma ação automática é criada. Convenção company_id uuid
-- (mesma de nfe_invoices/sales_import_*), RLS por empresa, sem policy de DELETE (histórico
-- append-only). Nomes prefixados abc_curve_ para não colidir com a classificação ABC/XYZ já
-- existente no módulo de Inventário (migration 030), que é um recurso diferente.

CREATE TABLE IF NOT EXISTS abc_curve_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL DEFAULT get_my_company_id()::uuid REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  sales_period_start date NOT NULL,
  sales_period_end date NOT NULL,
  pricing_snapshot_date date NOT NULL,
  stock_snapshot_date date,
  threshold_a numeric NOT NULL DEFAULT 80,
  threshold_b numeric NOT NULL DEFAULT 95,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  total_sku_count int NOT NULL DEFAULT 0,
  total_quantity numeric NOT NULL DEFAULT 0,
  total_revenue numeric NOT NULL DEFAULT 0,
  cost_coverage_pct numeric,
  stock_coverage_pct numeric,
  warning_count int NOT NULL DEFAULT 0,
  published_by uuid REFERENCES auth.users(id),
  published_at timestamptz,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS abc_curve_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL DEFAULT get_my_company_id()::uuid REFERENCES companies(id) ON DELETE CASCADE,
  analysis_id uuid NOT NULL REFERENCES abc_curve_analyses(id) ON DELETE CASCADE,
  file_kind text NOT NULL CHECK (file_kind IN ('vendas', 'precos_custos', 'estoque', 'abc_tiny')),
  -- Reservado para integrações futuras via API (Tiny/Bling/TOTVS/SAP). Nenhuma chamada externa,
  -- credencial, job de sincronização ou endpoint é implementado nesta migration.
  source_type text NOT NULL DEFAULT 'file' CHECK (source_type IN ('file', 'api')),
  provider text CHECK (provider IS NULL OR provider IN ('tiny', 'bling', 'totvs', 'sap', 'custom')),
  connection_id uuid,
  sync_status text CHECK (sync_status IS NULL OR sync_status IN ('pending', 'synced', 'error')),
  file_name text,
  file_hash text,
  row_count int NOT NULL DEFAULT 0,
  imported_count int NOT NULL DEFAULT 0,
  warning_count int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'failed')),
  error_message text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS abc_curve_sku_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL DEFAULT get_my_company_id()::uuid REFERENCES companies(id) ON DELETE CASCADE,
  analysis_id uuid NOT NULL REFERENCES abc_curve_analyses(id) ON DELETE CASCADE,
  sku text NOT NULL,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  product_name text,
  quantity numeric NOT NULL DEFAULT 0,
  revenue numeric NOT NULL DEFAULT 0,
  freight numeric NOT NULL DEFAULT 0,
  avg_price numeric,
  list_price numeric,
  promo_price numeric,
  cost numeric,
  cogs numeric,
  gross_profit numeric,
  gross_margin numeric,
  realized_markup numeric,
  price_realization numeric,
  turnover_class text CHECK (turnover_class IS NULL OR turnover_class IN ('A', 'B', 'C')),
  revenue_class text CHECK (revenue_class IS NULL OR revenue_class IN ('A', 'B', 'C')),
  profit_class text CHECK (profit_class IS NULL OR profit_class IN ('A', 'B', 'C')),
  -- estado NORMAL | SEM_CUSTO | PREJUIZO — nunca esconde produto na classe C.
  cost_state text NOT NULL DEFAULT 'NORMAL' CHECK (cost_state IN ('NORMAL', 'SEM_CUSTO', 'PREJUIZO')),
  -- Snapshot de estoque próprio do módulo — informativo, nunca lido/gravado no Inventário.
  stock_available numeric,
  stock_reserved numeric,
  stock_in_transit numeric,
  lead_time_days numeric,
  safety_stock numeric,
  daily_demand numeric,
  coverage_days numeric,
  reorder_point numeric,
  suggested_purchase numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (analysis_id, sku)
);

CREATE TABLE IF NOT EXISTS abc_curve_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL DEFAULT get_my_company_id()::uuid REFERENCES companies(id) ON DELETE CASCADE,
  analysis_id uuid NOT NULL REFERENCES abc_curve_analyses(id) ON DELETE CASCADE,
  sku_snapshot_id uuid NOT NULL REFERENCES abc_curve_sku_snapshots(id) ON DELETE CASCADE,
  sku text NOT NULL,
  code text NOT NULL CHECK (code IN (
    'COMPRA_URGENTE', 'PROTEGER_DISPONIBILIDADE', 'PROMOVER', 'REVISAR_PRECO_CUSTO',
    'RENEGOCIAR_CUSTO_OU_PRECO', 'REDUZIR_COMPRA_OU_LIQUIDAR', 'ESTOQUE_PARADO',
    'CORRIGIR_CUSTO', 'PREJUIZO'
  )),
  priority int NOT NULL,
  rule_applied text NOT NULL,
  justification text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_abc_curve_sku_snapshots_analysis ON abc_curve_sku_snapshots(analysis_id);
CREATE INDEX IF NOT EXISTS idx_abc_curve_recommendations_analysis ON abc_curve_recommendations(analysis_id);
CREATE INDEX IF NOT EXISTS idx_abc_curve_import_batches_hash ON abc_curve_import_batches(company_id, file_hash);

ALTER TABLE abc_curve_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE abc_curve_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE abc_curve_sku_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE abc_curve_recommendations ENABLE ROW LEVEL SECURITY;

CREATE POLICY abc_curve_analyses_select ON abc_curve_analyses FOR SELECT
  USING (company_id::text = get_my_company_id());
CREATE POLICY abc_curve_analyses_insert ON abc_curve_analyses FOR INSERT
  WITH CHECK (company_id::text = get_my_company_id());
CREATE POLICY abc_curve_analyses_update ON abc_curve_analyses FOR UPDATE
  USING (company_id::text = get_my_company_id()) WITH CHECK (company_id::text = get_my_company_id());
CREATE POLICY abc_curve_analyses_delete ON abc_curve_analyses FOR DELETE
  USING (company_id::text = get_my_company_id() AND status = 'draft');

CREATE POLICY abc_curve_import_batches_select ON abc_curve_import_batches FOR SELECT
  USING (company_id::text = get_my_company_id());
CREATE POLICY abc_curve_import_batches_insert ON abc_curve_import_batches FOR INSERT
  WITH CHECK (company_id::text = get_my_company_id());

CREATE POLICY abc_curve_sku_snapshots_select ON abc_curve_sku_snapshots FOR SELECT
  USING (company_id::text = get_my_company_id());
CREATE POLICY abc_curve_sku_snapshots_insert ON abc_curve_sku_snapshots FOR INSERT
  WITH CHECK (company_id::text = get_my_company_id());

CREATE POLICY abc_curve_recommendations_select ON abc_curve_recommendations FOR SELECT
  USING (company_id::text = get_my_company_id());
CREATE POLICY abc_curve_recommendations_insert ON abc_curve_recommendations FOR INSERT
  WITH CHECK (company_id::text = get_my_company_id());
