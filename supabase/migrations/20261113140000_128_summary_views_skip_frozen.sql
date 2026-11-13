-- ─────────────────────────────────────────────────────────────────────────────
-- 128 — Resumos de Risco e CBC deixam de contar produto congelado
--
-- A migration 127 criou o congelamento, e o código passou a tirar o produto
-- congelado da folha de contagem, da fila de CBC e da lista de risco. As duas
-- VIEWS de resumo ficaram para trás: continuavam somando sobre todas as linhas
-- das tabelas de nota.
--
-- O resultado era o pior tipo de defeito de interface — um número que não bate
-- com a lista logo abaixo dele. O cabeçalho dizia 4.628 produtos avaliados
-- enquanto a lista na mesma tela mostrava 4.624. Quem olha os dois não sabe
-- qual acreditar, e o certo é que nenhum dos dois merece crédito enquanto
-- discordarem.
--
-- ── O que muda ──────────────────────────────────────────────────────────────
-- `risk_company_summary_v`: ganha JOIN com products para poder filtrar. A FK
--   de product_risk_scores garante que todo score tem produto, então o JOIN não
--   descarta linha nenhuma por si só — ele só habilita o filtro.
-- `cbc_company_summary_v`: já fazia o JOIN (usa p.location em
--   distinct_locations); ganha só a condição de congelamento.
--
-- Nenhuma COLUNA é adicionada, removida ou reordenada, e por isso aqui cabe
-- CREATE OR REPLACE em vez de DROP + CREATE: substituir preserva os GRANTs e
-- não abre a janela em que a view não existe para quem estiver com a tela
-- aberta. (A 098 precisou dropar porque inseria coluna no meio da lista.)
--
-- ── Como a definição abaixo foi obtida ──────────────────────────────────────
-- NÃO foi transcrita das migrations 098/099 assumindo que ainda valem. O corpo
-- vivo foi conferido por EFEITO contra as tabelas base, com a sessão real do
-- app: total_scored, baixo_count e insufficient_count do risco, e
-- total_scored, bom_count, medio_count e insufficient_count do CBC, todos
-- recalculados por contagem direta e todos idênticos ao que a view devolvia
-- (4.628 / 6 / 4.622 e 4.628 / 3 / 3 / 4.622). O conjunto de colunas devolvido
-- pela view viva também bate exatamente — 8 no risco, 12 no CBC. Uma cláusula
-- extra escondida no corpo teria feito algum desses números divergir.
--
-- ── Efeito esperado ─────────────────────────────────────────────────────────
-- Com 4 produtos congelados hoje, os dois `total_scored` passam de 4.628 para
-- 4.624, e `insufficient_count` de 4.622 para 4.618 (os quatro congelados estão
-- sem dados suficientes). Nenhuma nota é apagada: descongelar devolve o produto
-- à contagem imediatamente.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW risk_company_summary_v
WITH (security_invoker = true) AS
SELECT
  s.company_id,
  ROUND(AVG(s.risk_score) FILTER (WHERE s.has_sufficient_data), 1)  AS avg_risk,
  COUNT(*)                                                          AS total_scored,
  COUNT(*) FILTER (WHERE s.risk_level = 'critico')                  AS critico_count,
  COUNT(*) FILTER (WHERE s.risk_level = 'alto')                     AS alto_count,
  COUNT(*) FILTER (WHERE s.risk_level = 'medio')                    AS medio_count,
  COUNT(*) FILTER (WHERE s.risk_level = 'baixo')                    AS baixo_count,
  COUNT(*) FILTER (WHERE NOT s.has_sufficient_data)                 AS insufficient_count
FROM product_risk_scores s
JOIN products p ON p.id = s.product_id
WHERE p.frozen_at IS NULL
GROUP BY s.company_id;

CREATE OR REPLACE VIEW cbc_company_summary_v
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
WHERE p.frozen_at IS NULL
GROUP BY s.company_id;

COMMENT ON VIEW risk_company_summary_v IS
  'Resumo de risco por empresa. Produto congelado (products.frozen_at) fica de fora, para o cabecalho nao discordar da lista da mesma tela.';
COMMENT ON VIEW cbc_company_summary_v IS
  'Resumo de CBC por empresa. Produto congelado (products.frozen_at) fica de fora, para o cabecalho nao discordar da lista da mesma tela.';
