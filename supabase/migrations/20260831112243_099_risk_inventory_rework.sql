/*
# Inventário por Risco — Probabilidade × Impacto + "dados insuficientes" real

## Causa raiz do "22-24 repetido" (achada por leitura de código, sem alterar dados)
`riskAlgorithm.ts` já era uma fórmula real — mas SKU nunca contado (totalCounts=0)
recebia "valores neutros" (score 50 em divergência, 80 em recência) em vez de um
estado "não sei". Somando esses neutros aos pesos antigos, mais valor
unitário/estoque tipicamente baixo numa base recém-importada, o resultado
convergia sempre para 22-24. Esta migration + o rework de
`riskAlgorithm.ts`/`riskService.ts` trocam isso por `has_sufficient_data = false`
(risk_score/risk_level/probability NULL) quando o SKU-local nunca foi contado,
em vez de inventar uma probabilidade.

## Por que NÃO renomeamos risk_level
`RiskBand` (critico/alto/medio/baixo) é um tipo compartilhado (src/lib/supabase.ts)
também consumido fora desta tela — `LiveWarehouseMap.tsx` colore o Digital Twin do
Armazém com o mesmo enum. Renomear os valores quebraria essa tela, fora do escopo
desta tarefa. Por isso: as 4 chaves continuam as mesmas, só o RÓTULO de "medio"
(agora "Moderado", em riskAlgorithm.ts) mudou.

## Mudanças
1. risk_score / risk_level passam a aceitar NULL — estado "dados insuficientes"
   real em vez de score fabricado.
2. probability, impact — os dois componentes separados do modelo
   (Risk Score = Probabilidade × Impacto / 100), guardados individualmente para a
   interface explicar o cálculo.
3. has_sufficient_data, missing_factors — o que faltou para calcular a
   probabilidade.
4. risk_company_summary_v recriada: mesmas colunas + insufficient_count.
*/

ALTER TABLE product_risk_scores ALTER COLUMN risk_score DROP NOT NULL;
ALTER TABLE product_risk_scores ALTER COLUMN risk_level DROP NOT NULL;

ALTER TABLE product_risk_scores ADD COLUMN IF NOT EXISTS probability numeric CHECK (probability >= 0 AND probability <= 100);
ALTER TABLE product_risk_scores ADD COLUMN IF NOT EXISTS impact numeric CHECK (impact >= 0 AND impact <= 100);
ALTER TABLE product_risk_scores ADD COLUMN IF NOT EXISTS has_sufficient_data boolean NOT NULL DEFAULT true;
ALTER TABLE product_risk_scores ADD COLUMN IF NOT EXISTS missing_factors text[] NOT NULL DEFAULT '{}';

-- CREATE OR REPLACE VIEW não aceita inserir uma coluna no meio da lista
-- existente (Postgres rejeita o rename implícito por posição) — por isso dropa
-- e recria em vez de substituir (mesmo padrão da migration 098).
DROP VIEW IF EXISTS risk_company_summary_v;

CREATE VIEW risk_company_summary_v
WITH (security_invoker = true) AS
SELECT
  company_id,
  ROUND(AVG(risk_score) FILTER (WHERE has_sufficient_data), 1)  AS avg_risk,
  COUNT(*)                                                       AS total_scored,
  COUNT(*) FILTER (WHERE risk_level = 'critico')                 AS critico_count,
  COUNT(*) FILTER (WHERE risk_level = 'alto')                    AS alto_count,
  COUNT(*) FILTER (WHERE risk_level = 'medio')                   AS medio_count,
  COUNT(*) FILTER (WHERE risk_level = 'baixo')                   AS baixo_count,
  COUNT(*) FILTER (WHERE NOT has_sufficient_data)                AS insufficient_count
FROM product_risk_scores
GROUP BY company_id;
