/*
# Create Inventory Tables for InventoryBlindAZ

1. New Tables
- `inventory_brands`
  - `id` (uuid, primary key)
  - `brand` (text, not null) - nome da linha/marca
  - `total_sku` (integer, not null) - total de SKUs esperados
  - `done_sku` (integer, not null, default 0) - SKUs contabilizados
  - `divergences` (integer, not null, default 0) - divergências encontradas
  - `order_index` (integer, default 0) - ordem de exibição
  - `created_at` (timestamp)
  - `updated_at` (timestamp)

- `top_vendas`
  - `id` (uuid, primary key)
  - `produto` (text, not null) - nome do produto
  - `sku` (text, not null) - código SKU
  - `vendas` (text, not null) - quantidade de vendas
  - `order_index` (integer, default 0) - ordem de exibição (1-10)
  - `created_at` (timestamp)
  - `updated_at` (timestamp)

- `custom_kpis`
  - `id` (uuid, primary key)
  - `titulo` (text, not null) - título do KPI
  - `valor` (text, not null) - valor do KPI
  - `unidade` (text) - unidade de medida
  - `variacao` (text) - descrição da variação
  - `tipo_variacao` (text, default 'neutral') - up, down, neutral
  - `cor_icone` (text, default 'blue') - blue, red, amber, emerald
  - `order_index` (integer, default 0) - ordem de exibição
  - `created_at` (timestamp)
  - `updated_at` (timestamp)

2. Security
- Enable RLS on all tables.
- Allow anon + authenticated full CRUD (single-tenant app without sign-in UI).
*/

-- Inventory Brands Table
CREATE TABLE IF NOT EXISTS inventory_brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand text NOT NULL,
  total_sku integer NOT NULL,
  done_sku integer NOT NULL DEFAULT 0,
  divergences integer NOT NULL DEFAULT 0,
  order_index integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE inventory_brands ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_crud_inventory_brands" ON inventory_brands;
CREATE POLICY "anon_crud_inventory_brands" ON inventory_brands FOR SELECT
  TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_inventory_brands" ON inventory_brands FOR INSERT
  TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_inventory_brands" ON inventory_brands FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_inventory_brands" ON inventory_brands FOR DELETE
  TO anon, authenticated USING (true);

-- Top Vendas Table
CREATE TABLE IF NOT EXISTS top_vendas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  produto text NOT NULL,
  sku text NOT NULL,
  vendas text NOT NULL,
  order_index integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE top_vendas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_crud_top_vendas" ON top_vendas;
CREATE POLICY "anon_crud_top_vendas" ON top_vendas FOR SELECT
  TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_top_vendas" ON top_vendas FOR INSERT
  TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_top_vendas" ON top_vendas FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_top_vendas" ON top_vendas FOR DELETE
  TO anon, authenticated USING (true);

-- Custom KPIs Table
CREATE TABLE IF NOT EXISTS custom_kpis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo text NOT NULL,
  valor text NOT NULL,
  unidade text DEFAULT '',
  variacao text DEFAULT '',
  tipo_variacao text DEFAULT 'neutral',
  cor_icone text DEFAULT 'blue',
  order_index integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE custom_kpis ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_crud_custom_kpis" ON custom_kpis;
CREATE POLICY "anon_crud_custom_kpis" ON custom_kpis FOR SELECT
  TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_custom_kpis" ON custom_kpis FOR INSERT
  TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_custom_kpis" ON custom_kpis FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_custom_kpis" ON custom_kpis FOR DELETE
  TO anon, authenticated USING (true);

-- Create indexes for ordering
CREATE INDEX IF NOT EXISTS idx_inventory_brands_order ON inventory_brands(order_index);
CREATE INDEX IF NOT EXISTS idx_top_vendas_order ON top_vendas(order_index);
CREATE INDEX IF NOT EXISTS idx_custom_kpis_order ON custom_kpis(order_index);