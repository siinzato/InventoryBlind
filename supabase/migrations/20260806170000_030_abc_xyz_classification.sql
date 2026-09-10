/*
# Classificação ABC+XYZ

## Summary
Classifies every product by value moved (ABC, Pareto: A≈80%/B≈15%/C≈5% of total
value moved, computed in a single whole-company batch since a SKU's letter
depends on its rank among ALL other SKUs) and by demand predictability (XYZ,
coefficient of variation of monthly movement — X=stable, Y=variable, Z=erratic).
The 9 combinations (AX..CZ) drive a static operational-strategy lookup
(src/lib/abcXyzStrategies.ts). Designed to be consumed by other modules (CBC,
Risk, Heatmap, Slotting, future planning) via abcXyzService.ts's public getters
instead of each module re-deriving its own value/demand classification —
today only the shared read API exists; wiring it INTO those modules' formulas
is deliberately not done in this pass (stability principle — they already work).

## Changes
1. product_abc_xyz_classifications — one row per product (upserted per
   whole-company recompute).
2. product_abc_xyz_history — append-only snapshot per recompute (trend +
   "how many changed class").
3. abc_xyz_company_summary_v — count + total value moved per abc_xyz_class,
   feeding the dashboard's distribution/matrix cards directly.
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. product_abc_xyz_classifications
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_abc_xyz_classifications (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                  text NOT NULL DEFAULT get_my_company_id(),
  product_id                  uuid UNIQUE NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  abc_class                   text NOT NULL CHECK (abc_class IN ('A','B','C')),
  xyz_class                   text NOT NULL CHECK (xyz_class IN ('X','Y','Z')),
  abc_xyz_class               text NOT NULL CHECK (abc_xyz_class IN ('AX','AY','AZ','BX','BY','BZ','CX','CY','CZ')),
  classification_date         date NOT NULL DEFAULT CURRENT_DATE,
  value_moved                 numeric NOT NULL DEFAULT 0,
  demand_coefficient_variation numeric,
  reasons                     text[] NOT NULL DEFAULT '{}',
  algorithm_version           text NOT NULL DEFAULT 'v1-heuristic',
  created_at                  timestamptz DEFAULT now(),
  updated_at                  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_abc_xyz_company_idx ON product_abc_xyz_classifications (company_id);
CREATE INDEX IF NOT EXISTS product_abc_xyz_combo_idx ON product_abc_xyz_classifications (abc_xyz_class);

ALTER TABLE product_abc_xyz_classifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_abc_xyz_select" ON product_abc_xyz_classifications;
CREATE POLICY "product_abc_xyz_select" ON product_abc_xyz_classifications FOR SELECT
  TO authenticated USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS "product_abc_xyz_insert" ON product_abc_xyz_classifications;
CREATE POLICY "product_abc_xyz_insert" ON product_abc_xyz_classifications FOR INSERT
  TO authenticated WITH CHECK (company_id = get_my_company_id());

DROP POLICY IF EXISTS "product_abc_xyz_update" ON product_abc_xyz_classifications;
CREATE POLICY "product_abc_xyz_update" ON product_abc_xyz_classifications FOR UPDATE
  TO authenticated
  USING (company_id = get_my_company_id())
  WITH CHECK (company_id = get_my_company_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. product_abc_xyz_history — append-only
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_abc_xyz_history (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     text NOT NULL DEFAULT get_my_company_id(),
  product_id     uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  abc_xyz_class  text NOT NULL,
  value_moved    numeric NOT NULL DEFAULT 0,
  recorded_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_abc_xyz_history_company_idx ON product_abc_xyz_history (company_id);
CREATE INDEX IF NOT EXISTS product_abc_xyz_history_product_idx ON product_abc_xyz_history (product_id, recorded_at DESC);

ALTER TABLE product_abc_xyz_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_abc_xyz_history_select" ON product_abc_xyz_history;
CREATE POLICY "product_abc_xyz_history_select" ON product_abc_xyz_history FOR SELECT
  TO authenticated USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS "product_abc_xyz_history_insert" ON product_abc_xyz_history;
CREATE POLICY "product_abc_xyz_history_insert" ON product_abc_xyz_history FOR INSERT
  TO authenticated WITH CHECK (company_id = get_my_company_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. abc_xyz_company_summary_v
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW abc_xyz_company_summary_v
WITH (security_invoker = true) AS
SELECT
  company_id,
  abc_xyz_class,
  COUNT(*)               AS sku_count,
  SUM(value_moved)        AS total_value_moved
FROM product_abc_xyz_classifications
GROUP BY company_id, abc_xyz_class;
