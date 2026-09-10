/*
  # 113 — Trava de inventário encerrado (modelo por SKU)

  Complemento da 112. "Inventário encerrado nunca é alterado retroativamente" é uma
  invariante de negócio, então ela mora no banco e não só no serviço: qualquer caminho —
  UI, script, importação, outra sessão — encontra a mesma recusa.

  Duas guardas, ambas em objetos NOVOS (nenhuma função existente é redeclarada):

  1. `inventory_items`: INSERT/UPDATE/DELETE recusado quando o ciclo do item está
     `closed`. Isso protege contagem, quantidade, operador, timestamp e a classificação
     congelada de uma vez, sem precisar enumerar coluna por coluna.

  2. `inventory_cycles`: um ciclo `closed` não volta a `active`. Sem isso a guarda acima
     seria contornável reabrindo o ciclo, e o índice único de ciclo ativo poderia ser
     driblado.

  O ciclo agregado legado (`inventory_brands`) não é afetado: estas tabelas são só do
  modelo por SKU.
*/

CREATE OR REPLACE FUNCTION inventory_items_block_closed_cycle()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_cycle_id uuid := COALESCE(NEW.cycle_id, OLD.cycle_id);
  v_status   text;
BEGIN
  SELECT c.status INTO v_status FROM inventory_cycles c WHERE c.id = v_cycle_id;

  IF v_status = 'closed' THEN
    RAISE EXCEPTION 'Inventario encerrado: os itens do ciclo % nao podem ser alterados', v_cycle_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS inventory_items_closed_guard ON inventory_items;
CREATE TRIGGER inventory_items_closed_guard
  BEFORE INSERT OR UPDATE OR DELETE ON inventory_items
  FOR EACH ROW EXECUTE FUNCTION inventory_items_block_closed_cycle();

CREATE OR REPLACE FUNCTION inventory_cycles_block_reopen()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'closed' AND NEW.status <> 'closed' THEN
    RAISE EXCEPTION 'Ciclo de inventario encerrado nao pode ser reaberto'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inventory_cycles_reopen_guard ON inventory_cycles;
CREATE TRIGGER inventory_cycles_reopen_guard
  BEFORE UPDATE ON inventory_cycles
  FOR EACH ROW EXECUTE FUNCTION inventory_cycles_block_reopen();
