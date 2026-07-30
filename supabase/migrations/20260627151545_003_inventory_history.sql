/*
# Create Inventory History Tables for Archiving Completed Inventories

1. New Tables
- `inventory_snapshots` (header)
  - `id` (uuid, primary key)
  - `name` (text) - nome do inventário (ex: "Inventário Junho 2026")
  - `start_date` (timestamptz) - data de início
  - `end_date` (timestamptz) - data de finalização/arquivamento
  - `total_sku` (integer) - total de SKUs
  - `total_done` (integer) - SKUs contabilizados
  - `total_divergences` (integer) - total de divergências
  - `progress` (decimal) - percentual de progresso final
  - `accuracy` (decimal) - acuracidade final
  - `status` (text) - 'completed' ou 'in_progress'
  - `notes` (text) - observações opcionais
  - `created_at` (timestamp)
  - `updated_at` (timestamp)

- `inventory_brand_history` (snapshot das marcas)
  - `id` (uuid, primary key)
  - `snapshot_id` (uuid, FK para inventory_snapshots)
  - `brand` (text) - nome da marca
  - `total_sku` (integer)
  - `done_sku` (integer)
  - `divergences` (integer)
  - `progress` (decimal)
  - `accuracy` (decimal)
  - `status` (text)
  - `created_at` (timestamp)

- `inventory_kpi_history` (snapshot dos KPIs)
  - `id` (uuid, primary key)
  - `snapshot_id` (uuid, FK para inventory_snapshots)
  - `titulo` (text)
  - `valor` (text)
  - `unidade` (text)
  - `variacao` (text)
  - `tipo_variacao` (text)
  - `cor_icone` (text)
  - `created_at` (timestamp)

- `inventory_top_vendas_history` (snapshot do top vendas)
  - `id` (uuid, primary key)
  - `snapshot_id` (uuid, FK para inventory_snapshots)
  - `produto` (text)
  - `sku` (text)
  - `vendas` (text)
  - `order_index` (integer)
  - `created_at` (timestamp)

2. Security
- Enable RLS on all tables.
- Allow anon + authenticated full CRUD (single-tenant app).
*/

-- Inventory Snapshots (Header)
CREATE TABLE IF NOT EXISTS inventory_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT 'Inventário',
  start_date timestamptz,
  end_date timestamptz,
  total_sku integer DEFAULT 0,
  total_done integer DEFAULT 0,
  total_divergences integer DEFAULT 0,
  progress decimal DEFAULT 0,
  accuracy decimal DEFAULT 0,
  status text DEFAULT 'completed',
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE inventory_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_crud_inventory_snapshots" ON inventory_snapshots;
CREATE POLICY "anon_crud_inventory_snapshots" ON inventory_snapshots FOR SELECT
  TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_inventory_snapshots" ON inventory_snapshots FOR INSERT
  TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_inventory_snapshots" ON inventory_snapshots FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_inventory_snapshots" ON inventory_snapshots FOR DELETE
  TO anon, authenticated USING (true);

-- Inventory Brand History
CREATE TABLE IF NOT EXISTS inventory_brand_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL REFERENCES inventory_snapshots(id) ON DELETE CASCADE,
  brand text NOT NULL,
  total_sku integer NOT NULL,
  done_sku integer NOT NULL,
  divergences integer NOT NULL,
  progress decimal NOT NULL,
  accuracy decimal,
  status text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE inventory_brand_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_crud_inventory_brand_history" ON inventory_brand_history;
CREATE POLICY "anon_crud_inventory_brand_history" ON inventory_brand_history FOR SELECT
  TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_inventory_brand_history" ON inventory_brand_history FOR INSERT
  TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_inventory_brand_history" ON inventory_brand_history FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_inventory_brand_history" ON inventory_brand_history FOR DELETE
  TO anon, authenticated USING (true);

-- Inventory KPI History
CREATE TABLE IF NOT EXISTS inventory_kpi_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL REFERENCES inventory_snapshots(id) ON DELETE CASCADE,
  titulo text NOT NULL,
  valor text NOT NULL,
  unidade text DEFAULT '',
  variacao text DEFAULT '',
  tipo_variacao text DEFAULT 'neutral',
  cor_icone text DEFAULT 'blue',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE inventory_kpi_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_crud_inventory_kpi_history" ON inventory_kpi_history;
CREATE POLICY "anon_crud_inventory_kpi_history" ON inventory_kpi_history FOR SELECT
  TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_inventory_kpi_history" ON inventory_kpi_history FOR INSERT
  TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_inventory_kpi_history" ON inventory_kpi_history FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_inventory_kpi_history" ON inventory_kpi_history FOR DELETE
  TO anon, authenticated USING (true);

-- Inventory Top Vendas History
CREATE TABLE IF NOT EXISTS inventory_top_vendas_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL REFERENCES inventory_snapshots(id) ON DELETE CASCADE,
  produto text NOT NULL,
  sku text NOT NULL,
  vendas text NOT NULL,
  order_index integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE inventory_top_vendas_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_crud_inventory_top_vendas_history" ON inventory_top_vendas_history;
CREATE POLICY "anon_crud_inventory_top_vendas_history" ON inventory_top_vendas_history FOR SELECT
  TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_inventory_top_vendas_history" ON inventory_top_vendas_history FOR INSERT
  TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_inventory_top_vendas_history" ON inventory_top_vendas_history FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_inventory_top_vendas_history" ON inventory_top_vendas_history FOR DELETE
  TO anon, authenticated USING (true);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_inventory_brand_history_snapshot ON inventory_brand_history(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_inventory_kpi_history_snapshot ON inventory_kpi_history(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_inventory_top_vendas_history_snapshot ON inventory_top_vendas_history(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_inventory_snapshots_end_date ON inventory_snapshots(end_date DESC);