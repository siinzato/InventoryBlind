/*
# Resumo de fechamento de linha/marca — Centro de Gestão da Contagem

## Summary
Quando os pendentes de uma linha/marca (inventory_brands.total_sku - done_sku) chegam a zero, o app
passa a reunir as observações das contagens manuais/importadas daquele mesmo ciclo (ManualCountTab.tsx /
ImportCountTab.tsx, inventory_count_records.observacoes) e classificá-las localmente por palavra-chave,
gerando um resumo curto. Tudo aditivo — nenhuma coluna de inventory_brands/inventory_count_records muda,
nenhuma contagem existente é tocada.

1. New Tables
- inventory_closing_categories — catálogo configurável de tipos de problema (nome + palavras-chave),
  por empresa. Sem policy de DELETE: desativar (active=false) é a única forma suportada de "remover",
  para nunca apagar uma categoria já referenciada num relatório histórico.
- inventory_closing_reports — um relatório por (linha, ciclo), versionado. "Ciclo" = janela desde o
  último inventory_snapshots.end_date da empresa (o único arquivamento existente, ver
  App.tsx::handleResetInventory), ou desde sempre se a empresa nunca arquivou. Índice único parcial
  garante no banco que só existe um relatório "atual" por linha/ciclo, mesmo sob clique duplo/concorrência.
  Indicadores numéricos são sempre cópias lidas de fontes já existentes — nunca recalculados aqui.
- inventory_closing_report_observations — vínculo auditável entre cada inventory_count_records.observacoes
  incluída no relatório e as categorias que ela casou, com o texto original preservado (nunca editável).

2. Security
- company_id text default get_my_company_id(), mesmo padrão de rca_settings/inventory_count_records.
- RLS company-scoped em todas; sem DELETE em nenhuma das três (histórico imutável, categorias só
  desativam).
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. inventory_closing_categories
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_closing_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  text NOT NULL DEFAULT get_my_company_id(),
  key         text NOT NULL,
  name        text NOT NULL,
  keywords    text[] NOT NULL DEFAULT '{}',
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, key)
);

CREATE INDEX IF NOT EXISTS inv_closing_categories_company_idx ON inventory_closing_categories (company_id);

ALTER TABLE inventory_closing_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inv_closing_categories_select" ON inventory_closing_categories;
CREATE POLICY "inv_closing_categories_select" ON inventory_closing_categories FOR SELECT
  TO authenticated USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS "inv_closing_categories_insert" ON inventory_closing_categories;
CREATE POLICY "inv_closing_categories_insert" ON inventory_closing_categories FOR INSERT
  TO authenticated WITH CHECK (company_id = get_my_company_id());

DROP POLICY IF EXISTS "inv_closing_categories_update" ON inventory_closing_categories;
CREATE POLICY "inv_closing_categories_update" ON inventory_closing_categories FOR UPDATE
  TO authenticated
  USING (company_id = get_my_company_id())
  WITH CHECK (company_id = get_my_company_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. inventory_closing_reports
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_closing_reports (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               text NOT NULL DEFAULT get_my_company_id(),
  brand_id                 uuid NOT NULL REFERENCES inventory_brands(id) ON DELETE CASCADE,
  cycle_start              timestamptz,
  version                  integer NOT NULL DEFAULT 1,
  is_current               boolean NOT NULL DEFAULT true,
  total_sku                integer NOT NULL DEFAULT 0,
  skus_contados            integer NOT NULL DEFAULT 0,
  divergencias_encontradas integer NOT NULL DEFAULT 0,
  divergencias_recontadas  integer NOT NULL DEFAULT 0,
  divergencias_reais       integer NOT NULL DEFAULT 0,
  accuracy_initial         numeric,
  accuracy_final           numeric,
  category_counts          jsonb NOT NULL DEFAULT '[]',
  unclassified_count       integer NOT NULL DEFAULT 0,
  summary_text             text NOT NULL,
  source_count_record_ids  uuid[] NOT NULL DEFAULT '{}',
  generated_at             timestamptz NOT NULL DEFAULT now(),
  generated_by             uuid DEFAULT auth.uid(),
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inv_closing_reports_company_idx ON inventory_closing_reports (company_id);
CREATE INDEX IF NOT EXISTS inv_closing_reports_brand_idx   ON inventory_closing_reports (brand_id, generated_at DESC);

-- Garante no banco que só existe um relatório "atual" por linha/ciclo — trava
-- contra clique duplo ou duas abas processando o mesmo fechamento ao mesmo
-- tempo. COALESCE cobre o ciclo "desde sempre" (cycle_start null), que senão
-- não colidiria (NULL <> NULL em índice único comum).
CREATE UNIQUE INDEX IF NOT EXISTS inv_closing_reports_current_idx
  ON inventory_closing_reports (company_id, brand_id, COALESCE(cycle_start, 'epoch'::timestamptz))
  WHERE is_current;

ALTER TABLE inventory_closing_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inv_closing_reports_select" ON inventory_closing_reports;
CREATE POLICY "inv_closing_reports_select" ON inventory_closing_reports FOR SELECT
  TO authenticated USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS "inv_closing_reports_insert" ON inventory_closing_reports;
CREATE POLICY "inv_closing_reports_insert" ON inventory_closing_reports FOR INSERT
  TO authenticated WITH CHECK (company_id = get_my_company_id());

-- UPDATE só é usado pelo app para virar is_current=false na versão anterior ao
-- reprocessar um resumo — nunca para editar o conteúdo de um relatório já gerado.
DROP POLICY IF EXISTS "inv_closing_reports_update" ON inventory_closing_reports;
CREATE POLICY "inv_closing_reports_update" ON inventory_closing_reports FOR UPDATE
  TO authenticated
  USING (company_id = get_my_company_id())
  WITH CHECK (company_id = get_my_company_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. inventory_closing_report_observations
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_closing_report_observations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id            uuid NOT NULL REFERENCES inventory_closing_reports(id) ON DELETE CASCADE,
  company_id           text NOT NULL DEFAULT get_my_company_id(),
  count_record_id      uuid NOT NULL REFERENCES inventory_count_records(id) ON DELETE CASCADE,
  observation_text      text NOT NULL,
  matched_category_ids  uuid[] NOT NULL DEFAULT '{}',
  is_unclassified       boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inv_closing_report_obs_report_idx  ON inventory_closing_report_observations (report_id);
CREATE INDEX IF NOT EXISTS inv_closing_report_obs_company_idx ON inventory_closing_report_observations (company_id);

ALTER TABLE inventory_closing_report_observations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inv_closing_report_obs_select" ON inventory_closing_report_observations;
CREATE POLICY "inv_closing_report_obs_select" ON inventory_closing_report_observations FOR SELECT
  TO authenticated USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS "inv_closing_report_obs_insert" ON inventory_closing_report_observations;
CREATE POLICY "inv_closing_report_obs_insert" ON inventory_closing_report_observations FOR INSERT
  TO authenticated WITH CHECK (company_id = get_my_company_id());
