/*
# Classificação ABC+XYZ — fonte real de vendas + "sem classificação" real

## Causa raiz investigada (leitura de código + contagem no banco, sem alterar dados)
`abcXyzService.ts` calculava valor movimentado a partir de `full_operation_items`
(picks do Full Manager) — essa tabela está VAZIA (0 linhas) neste workspace.
Resultado: quantidade movimentada = 0 para todo produto, `value_moved` = 0 para
todos, e `classifyABCBatch` tinha um branch explícito "total <= 0 → todos C";
`classifyXYZ` também caía em "menos de 2 meses com movimento → Z" para todos.
Daí o "1.023 produtos em CZ" e "R$ 0 sempre" mesmo com preço de custo cadastrado
— o problema nunca foi o preço, foi a fonte de movimento estar sempre vazia.
`sales_records` (vendas importadas, migration 077) tem dados reais por
company_id/SKU/product_id e é a fonte usada agora.

## Por que NÃO viramos multi-período no schema
Mantém-se UMA linha por produto (mesma unicidade de antes, `product_id UNIQUE`)
— o período apenas decide qual janela entra no próximo recálculo, sobrescrevendo
o resultado atual. Uma segunda dimensão (product_id, period) quebraria 3
leitores existentes fora do escopo desta tarefa que fazem `.maybeSingle()`
assumindo uma linha por produto: cbcService.ts (classe ABC para intervalo-alvo
de contagem), riskService.ts e warehouseTwinService.ts (Impacto/Digital Twin).

## Mudanças
1. abc_class/xyz_class/abc_xyz_class passam a aceitar NULL — "sem classificação"
   real (motivo em unclassified_reason) em vez de forçar C/Z sem dado.
2. period, source, quantity_moved, unit_cost_used, weeks_with_data,
   weeks_without_sale, unclassified_reason — os componentes que a interface
   precisa para explicar cada classe (ou a ausência dela).
3. product_abc_xyz_history ganha period, para "mudaram de classe" comparar
   sempre dentro do mesmo período.
4. abc_xyz_company_summary_v recriada: só agrega linhas classificadas
   (abc_xyz_class não nulo) — "sem classificação" é contado à parte pelo app.
*/

ALTER TABLE product_abc_xyz_classifications ALTER COLUMN abc_class DROP NOT NULL;
ALTER TABLE product_abc_xyz_classifications ALTER COLUMN xyz_class DROP NOT NULL;
ALTER TABLE product_abc_xyz_classifications ALTER COLUMN abc_xyz_class DROP NOT NULL;

ALTER TABLE product_abc_xyz_classifications ADD COLUMN IF NOT EXISTS period text NOT NULL DEFAULT '12m' CHECK (period IN ('90d','6m','12m'));
ALTER TABLE product_abc_xyz_classifications ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'sales_records';
ALTER TABLE product_abc_xyz_classifications ADD COLUMN IF NOT EXISTS quantity_moved numeric NOT NULL DEFAULT 0;
ALTER TABLE product_abc_xyz_classifications ADD COLUMN IF NOT EXISTS unit_cost_used numeric;
ALTER TABLE product_abc_xyz_classifications ADD COLUMN IF NOT EXISTS weeks_with_data integer NOT NULL DEFAULT 0;
ALTER TABLE product_abc_xyz_classifications ADD COLUMN IF NOT EXISTS weeks_without_sale integer NOT NULL DEFAULT 0;
ALTER TABLE product_abc_xyz_classifications ADD COLUMN IF NOT EXISTS unclassified_reason text
  CHECK (unclassified_reason IN ('sem_movimento','sem_custo','fonte_desconectada','historico_insuficiente','sku_nao_associado'));

ALTER TABLE product_abc_xyz_history ADD COLUMN IF NOT EXISTS period text NOT NULL DEFAULT '12m' CHECK (period IN ('90d','6m','12m'));

-- CREATE OR REPLACE VIEW não aceita mudar a condição de agregação de forma
-- incompatível com o plano anterior de forma segura — dropa e recria (mesmo
-- padrão das migrations 098/099).
DROP VIEW IF EXISTS abc_xyz_company_summary_v;

CREATE VIEW abc_xyz_company_summary_v
WITH (security_invoker = true) AS
SELECT
  company_id,
  abc_xyz_class,
  COUNT(*)          AS sku_count,
  SUM(value_moved)  AS total_value_moved
FROM product_abc_xyz_classifications
WHERE abc_xyz_class IS NOT NULL
GROUP BY company_id, abc_xyz_class;
