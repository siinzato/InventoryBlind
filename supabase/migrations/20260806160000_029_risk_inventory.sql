/*
# Inventário por Risco (Risk Score)

## Summary
Sibling of CBC (product_confidence_scores), but the opposite semantic: here a
HIGH score means MORE risk (count it soon), not more confidence. Kept in fully
separate tables/services from CBC to avoid conflating two opposite-direction
0-100 numbers under one name. Same architecture as CBC on purpose: pure
algorithm (src/lib/riskAlgorithm.ts), a recompute service, an append-only
history table for trend/migration tracking, and the same RLS shape.

## Changes
1. product_risk_scores — one row per product (upserted per recompute):
   risk_score, risk_level, risk_reason (human summary), factors breakdown,
   last_risk_update.
2. product_risk_history — append-only snapshot per recompute (trend +
   "how many moved band").
3. product_criticality_overrides — implements "criticidade operacional
   configurável": a manager-set override (baixa/normal/alta/maxima) that the
   algorithm applies as an ADDITIVE bonus on top of the data-driven score,
   since it's meant to be a decisive human override, not just one more
   statistical input. Write restricted to owner/admin/manager, same pattern
   as pdi_plans_insert (011/023 precedent) — a business decision, not
   automatically-derived data.
4. risk_company_summary_v — company-wide aggregate view for the dashboard.
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. product_risk_scores
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_risk_scores (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        text NOT NULL DEFAULT get_my_company_id(),
  product_id        uuid UNIQUE NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  risk_score        numeric NOT NULL CHECK (risk_score >= 0 AND risk_score <= 100),
  risk_level        text NOT NULL CHECK (risk_level IN ('critico','alto','medio','baixo')),
  risk_reason       text NOT NULL DEFAULT '',
  factors           jsonb NOT NULL DEFAULT '{}',
  algorithm_version text NOT NULL DEFAULT 'v1-heuristic',
  last_risk_update  timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_risk_scores_company_idx ON product_risk_scores (company_id);
CREATE INDEX IF NOT EXISTS product_risk_scores_level_idx ON product_risk_scores (risk_level);
CREATE INDEX IF NOT EXISTS product_risk_scores_score_idx ON product_risk_scores (risk_score DESC);

ALTER TABLE product_risk_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_risk_scores_select" ON product_risk_scores;
CREATE POLICY "product_risk_scores_select" ON product_risk_scores FOR SELECT
  TO authenticated USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS "product_risk_scores_insert" ON product_risk_scores;
CREATE POLICY "product_risk_scores_insert" ON product_risk_scores FOR INSERT
  TO authenticated WITH CHECK (company_id = get_my_company_id());

DROP POLICY IF EXISTS "product_risk_scores_update" ON product_risk_scores;
CREATE POLICY "product_risk_scores_update" ON product_risk_scores FOR UPDATE
  TO authenticated
  USING (company_id = get_my_company_id())
  WITH CHECK (company_id = get_my_company_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. product_risk_history — append-only
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_risk_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  text NOT NULL DEFAULT get_my_company_id(),
  product_id  uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  risk_score  numeric NOT NULL,
  risk_level  text NOT NULL,
  recorded_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_risk_history_company_idx ON product_risk_history (company_id);
CREATE INDEX IF NOT EXISTS product_risk_history_product_idx ON product_risk_history (product_id, recorded_at DESC);

ALTER TABLE product_risk_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_risk_history_select" ON product_risk_history;
CREATE POLICY "product_risk_history_select" ON product_risk_history FOR SELECT
  TO authenticated USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS "product_risk_history_insert" ON product_risk_history;
CREATE POLICY "product_risk_history_insert" ON product_risk_history FOR INSERT
  TO authenticated WITH CHECK (company_id = get_my_company_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. product_criticality_overrides — manager-set business override
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_criticality_overrides (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        text NOT NULL DEFAULT get_my_company_id(),
  product_id        uuid UNIQUE NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  criticality_level text NOT NULL DEFAULT 'normal' CHECK (criticality_level IN ('baixa','normal','alta','maxima')),
  set_by            uuid DEFAULT auth.uid(),
  updated_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_criticality_overrides_company_idx ON product_criticality_overrides (company_id);

ALTER TABLE product_criticality_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_criticality_overrides_select" ON product_criticality_overrides;
CREATE POLICY "product_criticality_overrides_select" ON product_criticality_overrides FOR SELECT
  TO authenticated USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS "product_criticality_overrides_insert" ON product_criticality_overrides;
CREATE POLICY "product_criticality_overrides_insert" ON product_criticality_overrides FOR INSERT
  TO authenticated WITH CHECK (
    company_id = get_my_company_id()
    AND get_my_role() = ANY(ARRAY['owner','admin','manager'])
  );

DROP POLICY IF EXISTS "product_criticality_overrides_update" ON product_criticality_overrides;
CREATE POLICY "product_criticality_overrides_update" ON product_criticality_overrides FOR UPDATE
  TO authenticated
  USING (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin','manager']))
  WITH CHECK (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin','manager']));

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. risk_company_summary_v
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW risk_company_summary_v
WITH (security_invoker = true) AS
SELECT
  company_id,
  ROUND(AVG(risk_score), 1)                                AS avg_risk,
  COUNT(*)                                                  AS total_scored,
  COUNT(*) FILTER (WHERE risk_level = 'critico')            AS critico_count,
  COUNT(*) FILTER (WHERE risk_level = 'alto')               AS alto_count,
  COUNT(*) FILTER (WHERE risk_level = 'medio')              AS medio_count,
  COUNT(*) FILTER (WHERE risk_level = 'baixo')              AS baixo_count
FROM product_risk_scores
GROUP BY company_id;
