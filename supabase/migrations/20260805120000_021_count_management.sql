/*
# Count Management — Centro de Gestão da Contagem

## Summary
Adds per-count audit history behind the "Nova Contagem" screen, without changing
how inventory_brands/Dashboard/Rankings/Heatmap already work (they keep reading
inventory_brands.total_sku/done_sku/divergences exactly as before).

1. New Tables
- inventory_count_records — one row per manual count, recount, or 3rd count.
  - brand_id (FK inventory_brands), count_number (1|2|3), source (manual|import),
    linked_count_id (self-FK to the first count of a recount chain),
    operator_1/operator_2, total_sku, skus_contados,
    divergencias_encontradas/recontadas/reais, valor_financeiro_divergencias,
    accuracy_initial/final, observacoes, duration_seconds, created_by, created_at.
- inventory_count_import_items — per-SKU detail rows, only populated when
  source = 'import' on the parent record (Produto/SKU/EAN/Local/Saldo Sistema/
  Saldo Contado/Diferença/Status/Responsável).

2. Schema addition
- products.stock_quantity (integer, default 0) — did not exist before; needed so
  "Importar Contagem" has a system balance to compare counted quantities against.
  Existing rows start at 0 (no historical balance to backfill).

3. Security
- company_id is text, defaults to get_my_company_id(), matching the existing
  inventory_brands/products convention (not the uuid+FK convention used by the
  newer nfe_* tables) since these tables join against inventory_brands/products.
- RLS: company-scoped SELECT/INSERT/UPDATE/DELETE, same pattern as inv_brands_*
  policies in 011_security_layer.sql.
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. inventory_count_records
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_count_records (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                    text NOT NULL DEFAULT get_my_company_id(),
  brand_id                      uuid NOT NULL REFERENCES inventory_brands(id) ON DELETE CASCADE,
  count_number                  smallint NOT NULL DEFAULT 1 CHECK (count_number IN (1, 2, 3)),
  source                        text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import')),
  linked_count_id               uuid REFERENCES inventory_count_records(id) ON DELETE SET NULL,
  operator_1                    text,
  operator_2                    text,
  total_sku                     integer NOT NULL DEFAULT 0,
  skus_contados                 integer NOT NULL DEFAULT 0,
  divergencias_encontradas      integer NOT NULL DEFAULT 0,
  divergencias_recontadas       integer NOT NULL DEFAULT 0,
  divergencias_reais            integer NOT NULL DEFAULT 0,
  valor_financeiro_divergencias numeric,
  accuracy_initial              numeric,
  accuracy_final                numeric,
  observacoes                   text,
  duration_seconds              integer,
  created_by                    uuid DEFAULT auth.uid(),
  created_at                    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inv_count_records_company_idx ON inventory_count_records (company_id);
CREATE INDEX IF NOT EXISTS inv_count_records_brand_idx   ON inventory_count_records (brand_id, created_at DESC);
CREATE INDEX IF NOT EXISTS inv_count_records_linked_idx  ON inventory_count_records (linked_count_id);

ALTER TABLE inventory_count_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inv_count_records_select" ON inventory_count_records;
CREATE POLICY "inv_count_records_select" ON inventory_count_records FOR SELECT
  TO authenticated USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS "inv_count_records_insert" ON inventory_count_records;
CREATE POLICY "inv_count_records_insert" ON inventory_count_records FOR INSERT
  TO authenticated WITH CHECK (company_id = get_my_company_id());

DROP POLICY IF EXISTS "inv_count_records_update" ON inventory_count_records;
CREATE POLICY "inv_count_records_update" ON inventory_count_records FOR UPDATE
  TO authenticated
  USING (company_id = get_my_company_id())
  WITH CHECK (company_id = get_my_company_id());

DROP POLICY IF EXISTS "inv_count_records_delete" ON inventory_count_records;
CREATE POLICY "inv_count_records_delete" ON inventory_count_records FOR DELETE
  TO authenticated USING (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner', 'admin', 'manager']));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. inventory_count_import_items
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_count_import_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  count_record_id uuid NOT NULL REFERENCES inventory_count_records(id) ON DELETE CASCADE,
  company_id      text NOT NULL DEFAULT get_my_company_id(),
  product_id      uuid REFERENCES products(id) ON DELETE SET NULL,
  sku             text,
  ean             text,
  produto_nome    text,
  local           text,
  saldo_sistema   integer,
  saldo_contado   integer,
  diferenca       integer,
  status          text CHECK (status IN ('correct', 'divergent', 'missing', 'surplus')),
  responsavel     text,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inv_count_import_items_record_idx  ON inventory_count_import_items (count_record_id);
CREATE INDEX IF NOT EXISTS inv_count_import_items_company_idx ON inventory_count_import_items (company_id);

ALTER TABLE inventory_count_import_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inv_count_import_items_select" ON inventory_count_import_items;
CREATE POLICY "inv_count_import_items_select" ON inventory_count_import_items FOR SELECT
  TO authenticated USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS "inv_count_import_items_insert" ON inventory_count_import_items;
CREATE POLICY "inv_count_import_items_insert" ON inventory_count_import_items FOR INSERT
  TO authenticated WITH CHECK (company_id = get_my_company_id());

DROP POLICY IF EXISTS "inv_count_import_items_update" ON inventory_count_import_items;
CREATE POLICY "inv_count_import_items_update" ON inventory_count_import_items FOR UPDATE
  TO authenticated
  USING (company_id = get_my_company_id())
  WITH CHECK (company_id = get_my_company_id());

DROP POLICY IF EXISTS "inv_count_import_items_delete" ON inventory_count_import_items;
CREATE POLICY "inv_count_import_items_delete" ON inventory_count_import_items FOR DELETE
  TO authenticated USING (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner', 'admin', 'manager']));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. products.stock_quantity
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_quantity integer NOT NULL DEFAULT 0;
