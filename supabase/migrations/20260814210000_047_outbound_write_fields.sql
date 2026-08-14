-- ─────────────────────────────────────────────────────────────────────────────
-- 047 — Campos que faltavam para o caminho de escrita no ERP
--
-- A migration 044 criou integration_stock_adjustments para o fluxo de contagem
-- física: contou, divergiu, aprovou, ajusta. Esse fluxo é sempre um ajuste de
-- saldo em UM depósito, então duas coisas não existiam na tabela — e sem elas
-- devolução e retirada de Full não têm como ser representadas:
--
--   movement_reason   O QUE o lançamento significa. O guard usa isso para aplicar
--                     a regra de direção (MOVEMENT_DIRECTION): devolução só pode
--                     aumentar, retirada só pode diminuir, retirada de Full tem de
--                     ser neutra no total. Sem a coluna, todo lançamento chegava
--                     como 'count_adjustment' e a regra que impede uma devolução
--                     de −6 remover estoque não tinha o que verificar.
--
--   target_warehouse_id  O depósito de DESTINO. Uma retirada de Full é uma
--                     transferência do depósito Full para o geral; com um único
--                     campo de depósito não há como dizer para onde as unidades
--                     vão, e um transfer sem destino é a forma mais rápida de
--                     perder saldo — sai de um lugar e não entra em nenhum.
--
-- Ambas nullable, e não há backfill: as linhas existentes são de contagem física e
-- movement_reason NULL é lido como 'count_adjustment' pelo código. Preencher em
-- massa uma intenção que ninguém declarou seria inventar histórico.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE integration_stock_adjustments
  ADD COLUMN IF NOT EXISTS movement_reason text,
  ADD COLUMN IF NOT EXISTS target_warehouse_id text;

-- Os sete valores de MovementReason em src/lib/integrations/sync/stockWriteGuard.ts.
-- Duplicar a lista no banco é proposital: um valor desconhecido chegando aqui
-- viraria um lançamento cuja direção permitida ninguém sabe, e é melhor recusar o
-- INSERT do que descobrir isso na hora de escrever no ERP.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'integration_stock_adjustments'::regclass
       AND conname = 'integration_stock_adjustments_movement_reason_check'
  ) THEN
    ALTER TABLE integration_stock_adjustments
      ADD CONSTRAINT integration_stock_adjustments_movement_reason_check
      CHECK (
        movement_reason IS NULL OR movement_reason = ANY (ARRAY[
          'count_adjustment', 'return', 'full_withdrawal', 'withdrawal',
          'loss', 'found', 'reconciliation'
        ])
      );
  END IF;
END $$;

-- Um transfer sem destino é inválido por construção, não por convenção. A
-- constraint existe porque a alternativa — confiar que o código sempre preenche —
-- falha em silêncio, e a falha custa saldo.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'integration_stock_adjustments'::regclass
       AND conname = 'integration_stock_adjustments_transfer_target_check'
  ) THEN
    ALTER TABLE integration_stock_adjustments
      ADD CONSTRAINT integration_stock_adjustments_transfer_target_check
      CHECK (
        write_kind <> 'transfer'
        OR (external_warehouse_id IS NOT NULL AND target_warehouse_id IS NOT NULL)
      );
  END IF;
END $$;

-- Origem e destino iguais significa que o mapeamento de depósitos está errado.
-- Tiny aceitaria as duas pernas e o saldo terminaria igual, mas dois movimentos
-- falsos ficariam no histórico do produto para sempre.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'integration_stock_adjustments'::regclass
       AND conname = 'integration_stock_adjustments_transfer_distinct_check'
  ) THEN
    ALTER TABLE integration_stock_adjustments
      ADD CONSTRAINT integration_stock_adjustments_transfer_distinct_check
      CHECK (
        write_kind <> 'transfer'
        OR external_warehouse_id IS DISTINCT FROM target_warehouse_id
      );
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Índice do claim de escrita
--
-- A função de escrita busca ajustes aprovados e ainda não enviados. Parcial porque
-- só essas linhas são candidatas: uma vez confirmadas elas nunca voltam a ser
-- lidas por esse caminho, e mantê-las no índice cresceria para sempre.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS integration_stock_adjustments_claimable_idx
  ON integration_stock_adjustments (connection_id, approved_at)
  WHERE sync_status = 'pending' AND approved_at IS NOT NULL;

COMMENT ON COLUMN integration_stock_adjustments.movement_reason IS
  'Semântica do lançamento (MovementReason). NULL é lido como count_adjustment. Determina a direção permitida no stockWriteGuard.';
COMMENT ON COLUMN integration_stock_adjustments.target_warehouse_id IS
  'Depósito de destino. Obrigatório quando write_kind = transfer (ex.: retirada de Full: do depósito Full para o geral).';
