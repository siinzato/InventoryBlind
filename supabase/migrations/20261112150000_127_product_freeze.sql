-- ─────────────────────────────────────────────────────────────────────────────
-- 127 — Congelar produto que sumiu da fonte de saldo
--
-- Hoje 1.771 dos 4.628 produtos do catálogo não vêm mais na fonte de saldo do
-- Tiny — foram excluídos de lá pela equipe. Eles continuam entrando nas folhas
-- de contagem com a célula de saldo vazia, que o operador lê como "conte e
-- escreva aqui" em vez de "este produto não existe mais".
--
-- ── Por que congelar e não excluir ──────────────────────────────────────────
-- Excluir não é uma opção hoje, e isso não é preferência: `inventory_items`
-- referencia products com FK RESTRICT, e os 1.771 têm linha lá. O banco recusa.
-- Se a restrição fosse contornada, 12 tabelas em CASCADE sumiriam junto — entre
-- elas 155 itens de contagem FÍSICA, feitos por gente, sem deixar rastro.
-- Congelar preserva tudo isso e é reversível com um clique.
--
-- ── Por que colunas e não uma tabela de status ──────────────────────────────
-- O estado é um atributo do produto, um por produto, sem histórico próprio
-- pedido. Tabela separada obrigaria todo SELECT de catálogo a um JOIN a mais
-- para responder "este produto está ativo?".
--
-- ── Compatibilidade ─────────────────────────────────────────────────────────
-- Aditiva e INERTE. Colunas nulas em todas as 4.628 linhas: nada está congelado
-- ao fim desta migration, e enquanto nada estiver, nenhuma consulta existente
-- muda de resultado. Nenhuma policy, função ou tabela foi alterada.
--
-- `frozen_reason` distingue o congelamento automático (sugerido pela importação)
-- do manual. A diferença importa: se o SKU voltar à fonte, só faz sentido
-- oferecer o descongelamento de quem foi congelado POR ter sumido dela.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS frozen_at timestamptz,
  ADD COLUMN IF NOT EXISTS frozen_reason text,
  ADD COLUMN IF NOT EXISTS frozen_by uuid;

DO $$
BEGIN
  -- Motivo fechado em vez de texto livre: a aplicação precisa distinguir os dois
  -- casos de forma confiável, e texto livre divergiria com o tempo.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'products'::regclass AND conname = 'products_frozen_reason_check'
  ) THEN
    ALTER TABLE products ADD CONSTRAINT products_frozen_reason_check
      CHECK (frozen_reason IS NULL OR frozen_reason IN ('sem_fonte_de_saldo', 'manual'));
  END IF;

  -- Estado congelado sem data, ou data sem motivo, seria um produto num limbo que
  -- nenhuma tela saberia exibir. Os dois andam juntos ou nenhum existe.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'products'::regclass AND conname = 'products_frozen_pair_check'
  ) THEN
    ALTER TABLE products ADD CONSTRAINT products_frozen_pair_check
      CHECK ((frozen_at IS NULL) = (frozen_reason IS NULL));
  END IF;
END $$;

-- Índice parcial: só as linhas congeladas entram. A tela de gestão lista essas,
-- e um índice sobre a coluna inteira ocuparia espaço para indexar 4.628 nulos.
CREATE INDEX IF NOT EXISTS products_frozen_at_idx
  ON products (frozen_at) WHERE frozen_at IS NOT NULL;

COMMENT ON COLUMN products.frozen_at IS
  'Quando o produto foi congelado. NULL = ativo. Congelado sai das folhas de contagem e das filas de CBC/risco, mas mantem todo o historico.';
COMMENT ON COLUMN products.frozen_reason IS
  'sem_fonte_de_saldo = sumiu da fonte na importacao. manual = decisao direta de alguem.';
