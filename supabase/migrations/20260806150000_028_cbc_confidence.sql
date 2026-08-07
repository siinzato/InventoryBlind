/*
# Confidence Based Counting (CBC)

## Summary
Adds a per-SKU Confidence Score (0-100) that decides each product's next count
date, replacing fixed-interval counting entirely — no fixed-cycle concept
existed anywhere in this app before this migration. The score is computed by a
pure, isolated heuristic (src/lib/cbcAlgorithm.ts) explicitly designed to be
swapped for a ML model later without any schema change: the model/algorithm
only ever writes the same shape (confidence_score, risk_level, next_count_date,
factors breakdown), never touches products or any other table's core columns.

## Changes
1. product_confidence_scores — one row per product (upserted on every
   recompute): current score, risk band, next count date, and a jsonb factor
   breakdown + top_reasons for the product screen's "Motivos da nota".
2. product_confidence_history — append-only snapshot per recompute, feeding
   the CBC dashboard's trend sparkline and "how many migrated band" count
   (computed in TS by comparing each product's last two rows here).
3. cbc_company_summary_v — company-wide aggregate view (avg score, count per
   risk_level, overdue count, due-this-week count) for the dashboard's top
   cards.

## Data granularity note (see plan)
Per-SKU signal only exists via inventory_count_import_items (populated only
when a count comes through the IMPORT flow — manual counts are brand-level
aggregates with no SKU rows) and full_operation_items (Full Manager picks,
joined by `sku` text since product_id there has no FK). No stock-adjustment
ledger exists in this app; the algorithm uses inventory_count_import_items'
`diferenca` (the balance correction already recorded on each count) as the
honest proxy for "ajustes de estoque" rather than inventing a new adjustments
feature nobody asked for.
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. product_confidence_scores — current state, upserted per product
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_confidence_scores (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           text NOT NULL DEFAULT get_my_company_id(),
  product_id           uuid UNIQUE NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  confidence_score     numeric NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 100),
  risk_level           text NOT NULL CHECK (risk_level IN ('excelente','bom','medio','critico')),
  next_count_date      date NOT NULL,
  factors              jsonb NOT NULL DEFAULT '{}',
  top_reasons          text[] NOT NULL DEFAULT '{}',
  algorithm_version    text NOT NULL DEFAULT 'v1-heuristic',
  last_algorithm_run   timestamptz NOT NULL DEFAULT now(),
  created_at           timestamptz DEFAULT now(),
  updated_at           timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_confidence_scores_company_idx ON product_confidence_scores (company_id);
CREATE INDEX IF NOT EXISTS product_confidence_scores_next_count_idx ON product_confidence_scores (next_count_date);
CREATE INDEX IF NOT EXISTS product_confidence_scores_risk_idx ON product_confidence_scores (risk_level);

ALTER TABLE product_confidence_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_confidence_scores_select" ON product_confidence_scores;
CREATE POLICY "product_confidence_scores_select" ON product_confidence_scores FOR SELECT
  TO authenticated USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS "product_confidence_scores_insert" ON product_confidence_scores;
CREATE POLICY "product_confidence_scores_insert" ON product_confidence_scores FOR INSERT
  TO authenticated WITH CHECK (company_id = get_my_company_id());

DROP POLICY IF EXISTS "product_confidence_scores_update" ON product_confidence_scores;
CREATE POLICY "product_confidence_scores_update" ON product_confidence_scores FOR UPDATE
  TO authenticated
  USING (company_id = get_my_company_id())
  WITH CHECK (company_id = get_my_company_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. product_confidence_history — append-only, feeds trend + band-migration count
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_confidence_history (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       text NOT NULL DEFAULT get_my_company_id(),
  product_id       uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  confidence_score numeric NOT NULL,
  risk_level       text NOT NULL,
  recorded_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_confidence_history_company_idx ON product_confidence_history (company_id);
CREATE INDEX IF NOT EXISTS product_confidence_history_product_idx ON product_confidence_history (product_id, recorded_at DESC);

ALTER TABLE product_confidence_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_confidence_history_select" ON product_confidence_history;
CREATE POLICY "product_confidence_history_select" ON product_confidence_history FOR SELECT
  TO authenticated USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS "product_confidence_history_insert" ON product_confidence_history;
CREATE POLICY "product_confidence_history_insert" ON product_confidence_history FOR INSERT
  TO authenticated WITH CHECK (company_id = get_my_company_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. cbc_company_summary_v — dashboard top-card aggregates
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW cbc_company_summary_v
WITH (security_invoker = true) AS
SELECT
  company_id,
  ROUND(AVG(confidence_score), 1)                                        AS avg_confidence,
  COUNT(*)                                                                AS total_scored,
  COUNT(*) FILTER (WHERE risk_level = 'excelente')                        AS excelente_count,
  COUNT(*) FILTER (WHERE risk_level = 'bom')                              AS bom_count,
  COUNT(*) FILTER (WHERE risk_level = 'medio')                            AS medio_count,
  COUNT(*) FILTER (WHERE risk_level = 'critico')                         AS critico_count,
  COUNT(*) FILTER (WHERE next_count_date < CURRENT_DATE)                  AS overdue_count,
  COUNT(*) FILTER (WHERE next_count_date >= CURRENT_DATE AND next_count_date < CURRENT_DATE + 7) AS due_this_week_count
FROM product_confidence_scores
GROUP BY company_id;
