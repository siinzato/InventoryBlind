/*
# Slotting Intelligence — Fase 1 (editor manual de grade + motor real)

## Summary
A versão "completa" pedida (upload de PDF/DWG com parsing automático de geometria)
exige infraestrutura que este projeto não tem hoje (storage de arquivo, parser
de CAD) — decisão confirmada com o usuário: construir um editor manual de
grade 2D em vez de fingir um parsing que não existe. Tudo o que roda sobre essa
grade (distância, heatmap, congestionamento, recomendações) é calculado de
verdade (BFS real sobre a grade desenhada), não simulado. Upload de
imagem/PDF como camada de fundo visual fica documentado como Fase 2.

## Changes
1. warehouse_layouts — uma ou mais plantas por empresa (grade N×M).
2. warehouse_cells — cada célula pintada pelo usuário (rua/módulo/posição/
   expedição/vazio); location_code casa com products.location por texto —
   reaproveita o campo já existente em vez de uma tabela de vínculo redundante.
3. warehouse_slotting_recommendations — fila de recomendações com fluxo
   aprovar/rejeitar/adiar.
4. warehouse_optimization_history — log de otimizações aprovadas, para o
   dashboard.

## Security
Mudança estrutural do CD (layout/células) e decisões sobre recomendações são
restritas a owner/admin/manager (mesmo padrão de pdi_plans/
product_criticality_overrides) — leitura é company-scoped para todos.
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. warehouse_layouts
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS warehouse_layouts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        text NOT NULL DEFAULT get_my_company_id(),
  name              text NOT NULL DEFAULT 'Layout Principal',
  grid_width        integer NOT NULL CHECK (grid_width BETWEEN 2 AND 60),
  grid_height       integer NOT NULL CHECK (grid_height BETWEEN 2 AND 60),
  cell_size_meters  numeric NOT NULL DEFAULT 1.5,
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS warehouse_layouts_company_idx ON warehouse_layouts (company_id);

ALTER TABLE warehouse_layouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "warehouse_layouts_select" ON warehouse_layouts;
CREATE POLICY "warehouse_layouts_select" ON warehouse_layouts FOR SELECT
  TO authenticated USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS "warehouse_layouts_insert" ON warehouse_layouts;
CREATE POLICY "warehouse_layouts_insert" ON warehouse_layouts FOR INSERT
  TO authenticated WITH CHECK (
    company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin','manager'])
  );

DROP POLICY IF EXISTS "warehouse_layouts_update" ON warehouse_layouts;
CREATE POLICY "warehouse_layouts_update" ON warehouse_layouts FOR UPDATE
  TO authenticated
  USING (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin','manager']))
  WITH CHECK (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin','manager']));

DROP POLICY IF EXISTS "warehouse_layouts_delete" ON warehouse_layouts;
CREATE POLICY "warehouse_layouts_delete" ON warehouse_layouts FOR DELETE
  TO authenticated USING (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin','manager']));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. warehouse_cells
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS warehouse_cells (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  layout_id      uuid NOT NULL REFERENCES warehouse_layouts(id) ON DELETE CASCADE,
  company_id     text NOT NULL DEFAULT get_my_company_id(),
  x              integer NOT NULL,
  y              integer NOT NULL,
  cell_type      text NOT NULL DEFAULT 'vazio' CHECK (cell_type IN ('rua','modulo','posicao','expedicao','vazio')),
  location_code  text,
  UNIQUE (layout_id, x, y)
);

CREATE INDEX IF NOT EXISTS warehouse_cells_layout_idx ON warehouse_cells (layout_id);
CREATE INDEX IF NOT EXISTS warehouse_cells_company_idx ON warehouse_cells (company_id);
CREATE INDEX IF NOT EXISTS warehouse_cells_location_idx ON warehouse_cells (location_code);

ALTER TABLE warehouse_cells ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "warehouse_cells_select" ON warehouse_cells;
CREATE POLICY "warehouse_cells_select" ON warehouse_cells FOR SELECT
  TO authenticated USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS "warehouse_cells_insert" ON warehouse_cells;
CREATE POLICY "warehouse_cells_insert" ON warehouse_cells FOR INSERT
  TO authenticated WITH CHECK (
    company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin','manager'])
  );

DROP POLICY IF EXISTS "warehouse_cells_update" ON warehouse_cells;
CREATE POLICY "warehouse_cells_update" ON warehouse_cells FOR UPDATE
  TO authenticated
  USING (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin','manager']))
  WITH CHECK (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin','manager']));

DROP POLICY IF EXISTS "warehouse_cells_delete" ON warehouse_cells;
CREATE POLICY "warehouse_cells_delete" ON warehouse_cells FOR DELETE
  TO authenticated USING (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin','manager']));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. warehouse_slotting_recommendations
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS warehouse_slotting_recommendations (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                      text NOT NULL DEFAULT get_my_company_id(),
  layout_id                       uuid NOT NULL REFERENCES warehouse_layouts(id) ON DELETE CASCADE,
  product_id                      uuid REFERENCES products(id) ON DELETE SET NULL,
  recommendation_type             text NOT NULL CHECK (recommendation_type IN ('mover_mais_perto','aproximar_expedicao','agrupar_frequentes','redistribuir_fluxo')),
  current_location                text,
  suggested_location               text,
  estimated_meters_saved          numeric NOT NULL DEFAULT 0,
  estimated_time_saved_seconds    numeric NOT NULL DEFAULT 0,
  estimated_productivity_gain_pct numeric NOT NULL DEFAULT 0,
  status                          text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','aprovada','rejeitada','adiada')),
  reason                          text NOT NULL DEFAULT '',
  created_at                      timestamptz DEFAULT now(),
  decided_at                      timestamptz,
  decided_by                      uuid
);

CREATE INDEX IF NOT EXISTS warehouse_recommendations_company_idx ON warehouse_slotting_recommendations (company_id);
CREATE INDEX IF NOT EXISTS warehouse_recommendations_layout_idx ON warehouse_slotting_recommendations (layout_id);
CREATE INDEX IF NOT EXISTS warehouse_recommendations_status_idx ON warehouse_slotting_recommendations (status);

ALTER TABLE warehouse_slotting_recommendations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "warehouse_recommendations_select" ON warehouse_slotting_recommendations;
CREATE POLICY "warehouse_recommendations_select" ON warehouse_slotting_recommendations FOR SELECT
  TO authenticated USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS "warehouse_recommendations_insert" ON warehouse_slotting_recommendations;
CREATE POLICY "warehouse_recommendations_insert" ON warehouse_slotting_recommendations FOR INSERT
  TO authenticated WITH CHECK (company_id = get_my_company_id());

DROP POLICY IF EXISTS "warehouse_recommendations_update" ON warehouse_slotting_recommendations;
CREATE POLICY "warehouse_recommendations_update" ON warehouse_slotting_recommendations FOR UPDATE
  TO authenticated
  USING (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin','manager']))
  WITH CHECK (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin','manager']));

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. warehouse_optimization_history
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS warehouse_optimization_history (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        text NOT NULL DEFAULT get_my_company_id(),
  layout_id         uuid NOT NULL REFERENCES warehouse_layouts(id) ON DELETE CASCADE,
  recommendation_id uuid REFERENCES warehouse_slotting_recommendations(id) ON DELETE SET NULL,
  event             text NOT NULL,
  meters_saved      numeric NOT NULL DEFAULT 0,
  recorded_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS warehouse_optimization_history_company_idx ON warehouse_optimization_history (company_id);

ALTER TABLE warehouse_optimization_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "warehouse_optimization_history_select" ON warehouse_optimization_history;
CREATE POLICY "warehouse_optimization_history_select" ON warehouse_optimization_history FOR SELECT
  TO authenticated USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS "warehouse_optimization_history_insert" ON warehouse_optimization_history;
CREATE POLICY "warehouse_optimization_history_insert" ON warehouse_optimization_history FOR INSERT
  TO authenticated WITH CHECK (company_id = get_my_company_id());
