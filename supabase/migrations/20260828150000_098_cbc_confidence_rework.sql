/*
# CBC — confiança real + prioridade de contagem separada

## Causa raiz do "76" repetido (achada por leitura de código, sem alterar dados)
`cbcAlgorithm.ts` já era uma fórmula real (não fixture/seed) — mas os 8 fatores
antigos tinham "valores neutros" para SKU sem nenhum histórico (nunca contado,
sem picks, sem ajuste, estoque zerado). Somando esses neutros com os pesos
antigos (25/15/15/15/10/10/5/5) o resultado bate EXATAMENTE 76 sempre que um
produto nunca foi contado e está com estoque zerado — o caso mais comum numa
base de 921 SKUs recém-importada. Não era uma constante no código; era um
"fallback emergente": o algoritmo nunca sabia dizer "não sei", só produzia um
número plausível a partir de zeros. Esta migration + o rework de
`cbcAlgorithm.ts`/`cbcService.ts` trocam isso por um estado explícito
`has_sufficient_data = false` (confidence_score/risk_level NULL), em vez de
inventar uma média.

## Por que NÃO renomeamos risk_level
`RiskLevel` (excelente/bom/medio/critico) é um tipo compartilhado
(src/lib/supabase.ts) também consumido fora do CBC — `WarehousePositionDrawer.tsx`
tem seu próprio `Record<RiskLevel, ...>` para colorir a saúde de confiança no
Digital Twin do Armazém. Renomear os valores do enum quebraria essa tela, fora
do escopo desta tarefa. Por isso: as 4 chaves continuam as mesmas, só os
CORTES de pontuação e os RÓTULOS exibidos pelo CBC mudam (feito em
cbcAlgorithm.ts/ConfidenceBadge.tsx) — `WarehousePositionDrawer.tsx` não
precisou ser tocado.

## Mudanças
1. confidence_score / risk_level passam a aceitar NULL — estado
   "dados insuficientes" real em vez de score fabricado.
2. has_sufficient_data, missing_factors — o que faltou para calcular.
3. priority_score, why_to_count — prioridade de contagem, conceito separado
   de confiança (fórmula própria, nunca igual ao score de confiança).
4. is_manually_scheduled/scheduled_by/scheduled_at — efeito real do botão
   "Programar contagem" (sem criar um segundo sistema de contagens: só marca
   intenção sobre a mesma linha de confiança já existente).
5. cbc_company_summary_v recriada: mesmas colunas + distinct_locations,
   insufficient_count, scheduled_this_week_count.
*/

ALTER TABLE product_confidence_scores ALTER COLUMN confidence_score DROP NOT NULL;
ALTER TABLE product_confidence_scores ALTER COLUMN risk_level DROP NOT NULL;

ALTER TABLE product_confidence_scores ADD COLUMN IF NOT EXISTS has_sufficient_data boolean NOT NULL DEFAULT true;
ALTER TABLE product_confidence_scores ADD COLUMN IF NOT EXISTS missing_factors text[] NOT NULL DEFAULT '{}';
ALTER TABLE product_confidence_scores ADD COLUMN IF NOT EXISTS priority_score numeric CHECK (priority_score >= 0 AND priority_score <= 100);
ALTER TABLE product_confidence_scores ADD COLUMN IF NOT EXISTS why_to_count text;
ALTER TABLE product_confidence_scores ADD COLUMN IF NOT EXISTS is_manually_scheduled boolean NOT NULL DEFAULT false;
ALTER TABLE product_confidence_scores ADD COLUMN IF NOT EXISTS scheduled_by uuid;
ALTER TABLE product_confidence_scores ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;

CREATE INDEX IF NOT EXISTS product_confidence_scores_priority_idx ON product_confidence_scores (priority_score DESC);

-- CREATE OR REPLACE VIEW não aceita inserir uma coluna no meio da lista
-- existente (Postgres tenta casar por posição e rejeita o rename implícito) —
-- por isso dropa e recria em vez de substituir.
DROP VIEW IF EXISTS cbc_company_summary_v;

CREATE VIEW cbc_company_summary_v
WITH (security_invoker = true) AS
SELECT
  s.company_id,
  ROUND(AVG(s.confidence_score) FILTER (WHERE s.has_sufficient_data), 1)           AS avg_confidence,
  COUNT(*)                                                                          AS total_scored,
  COUNT(DISTINCT NULLIF(p.location, ''))                                            AS distinct_locations,
  COUNT(*) FILTER (WHERE s.risk_level = 'excelente')                                AS excelente_count,
  COUNT(*) FILTER (WHERE s.risk_level = 'bom')                                      AS bom_count,
  COUNT(*) FILTER (WHERE s.risk_level = 'medio')                                    AS medio_count,
  COUNT(*) FILTER (WHERE s.risk_level = 'critico')                                  AS critico_count,
  COUNT(*) FILTER (WHERE NOT s.has_sufficient_data)                                 AS insufficient_count,
  COUNT(*) FILTER (WHERE s.next_count_date < CURRENT_DATE)                          AS overdue_count,
  COUNT(*) FILTER (WHERE s.next_count_date >= CURRENT_DATE AND s.next_count_date < CURRENT_DATE + 7) AS due_this_week_count,
  COUNT(*) FILTER (WHERE s.is_manually_scheduled AND s.next_count_date < CURRENT_DATE + 7) AS scheduled_this_week_count
FROM product_confidence_scores s
JOIN products p ON p.id = s.product_id
GROUP BY s.company_id;
