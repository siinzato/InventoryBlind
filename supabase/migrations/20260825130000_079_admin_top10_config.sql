-- Configuração do bloco "Top 10 de Vendas" (painel administrativo, aba Vendas e Integrações):
-- permite alternar entre o modo manual já existente (métrica + período sobre sales_records,
-- comportamento inalterado) e um modo automático alimentado pelos resultados já calculados e
-- publicados da Curva ABC. Nunca recalcula nada da Curva ABC nem lê/escreve tabelas do
-- Inventário — só referencia abc_curve_analyses (leitura) para saber qual análise está publicada
-- no Top 10. Uma linha por empresa (UNIQUE company_id): a config é única, não um histórico.

CREATE TABLE IF NOT EXISTS admin_top10_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL DEFAULT get_my_company_id()::uuid REFERENCES companies(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  source_mode text NOT NULL DEFAULT 'manual' CHECK (source_mode IN ('manual', 'automatic_abc')),
  -- Modo manual: mesma métrica/período que a tela já oferece hoje sobre sales_records.
  manual_metric text NOT NULL DEFAULT 'quantidade' CHECK (manual_metric IN ('quantidade', 'faturamento')),
  manual_period_preset text NOT NULL DEFAULT '30d' CHECK (manual_period_preset IN ('7d', '30d', 'mes_atual', 'custom')),
  manual_period_from date,
  manual_period_to date,
  -- Modo automático: referência explícita à análise publicada e ao critério de ranking.
  -- ON DELETE RESTRICT reforça (a nível de banco) que uma análise em uso pelo Top 10 não pode
  -- ser apagada silenciosamente — hoje a policy abc_curve_analyses_delete já só permite excluir
  -- rascunho, então isto é defensivo, não a única barreira.
  abc_analysis_id uuid REFERENCES abc_curve_analyses(id) ON DELETE RESTRICT,
  ranking_metric text CHECK (ranking_metric IN ('revenue', 'quantity', 'gross_profit')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id)
);

ALTER TABLE admin_top10_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_top10_config_select ON admin_top10_config FOR SELECT
  USING (company_id::text = get_my_company_id());
CREATE POLICY admin_top10_config_insert ON admin_top10_config FOR INSERT
  WITH CHECK (company_id::text = get_my_company_id());
CREATE POLICY admin_top10_config_update ON admin_top10_config FOR UPDATE
  USING (company_id::text = get_my_company_id()) WITH CHECK (company_id::text = get_my_company_id());
