/*
# Contagem Física Digital — correção de arquitetura (Etapa 2)

## Summary
A Etapa 1 (039) já usa o campo oficial correto (products.location, o mesmo
que o módulo de Slotting usa) — a investigação confirmou que não existe
tabela paralela de localização nem bug de tabela errada. Esta migration só
adiciona o que estava genuinamente faltando, sem tocar em products,
warehouse_cells ou qualquer estrutura existente:

1. `found_location` em physical_count_items/physical_count_events — registra
   "produto esperado em A, encontrado fisicamente em B" (seção 10 do ticket)
   sem sobrescrever products.location (mover um SKU de verdade continua sendo
   uma ação separada e deliberada do módulo de Slotting).
2. `pc_flag_found_elsewhere` — RPC atômica e idempotente, mesma forma de
   pc_register_count, para gravar esse fato durante a contagem cega.

Marca/linha (inventory_brands) NÃO ganham nenhuma coluna ou FK nova aqui —
não existe hoje uma classificação estável produto→marca (só o rastro
histórico de inventory_count_import_items.product_id, populado quando um
SKU aparece numa importação de contagem manual marcada com uma marca). Isso
é lido pelo frontend como enriquecimento best-effort (src/lib/physicalCount/
physicalCountService.ts::getBrandByProductId), nunca escrito ou copiado para
uma tabela nova — ver o comentário lá para o porquê.
*/

ALTER TABLE physical_count_items
  ADD COLUMN IF NOT EXISTS found_location text;

ALTER TABLE physical_count_events
  ADD COLUMN IF NOT EXISTS found_location text;

-- ─────────────────────────────────────────────────────────────────────────────
-- pc_flag_found_elsewhere — registra que um item da sessão foi encontrado
-- fisicamente num local diferente do esperado (snapshot em `location`).
-- Não altera products.location. Idempotente (mesma chave usada por
-- pc_register_count), atômica, mesmas checagens de empresa/sessão.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pc_flag_found_elsewhere(
  p_item_id         uuid,
  p_found_location  text,
  p_idempotency_key uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_company      text;
  v_item_company uuid;
  v_session_id   uuid;
  v_sess_status  text;
  v_current_qty  numeric;
  v_product_id   uuid;
  v_sku          text;
  v_ean          text;
  v_existing     uuid;
BEGIN
  v_company := get_my_company_id();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No active company';
  END IF;

  IF p_found_location IS NULL OR btrim(p_found_location) = '' THEN
    RAISE EXCEPTION 'found_location is required';
  END IF;

  SELECT id INTO v_existing FROM physical_count_events WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    RETURN;
  END IF;

  SELECT company_id, session_id, physical_quantity, product_id, sku, ean
  INTO v_item_company, v_session_id, v_current_qty, v_product_id, v_sku, v_ean
  FROM physical_count_items WHERE id = p_item_id FOR UPDATE;

  IF v_item_company IS NULL THEN
    RAISE EXCEPTION 'Item not found';
  END IF;
  IF v_item_company::text <> v_company THEN
    RAISE EXCEPTION 'Item belongs to another company';
  END IF;

  SELECT status INTO v_sess_status FROM physical_count_sessions WHERE id = v_session_id FOR UPDATE;
  IF v_sess_status <> 'in_progress' THEN
    RAISE EXCEPTION 'Session is not in progress';
  END IF;

  UPDATE physical_count_items
  SET found_location = btrim(p_found_location), updated_at = now()
  WHERE id = p_item_id;

  INSERT INTO physical_count_events (
    company_id, session_id, item_id, product_id, sku, ean,
    delta, resulting_quantity, mode, source, found_location, idempotency_key, created_by
  ) VALUES (
    v_item_company, v_session_id, p_item_id, v_product_id, v_sku, v_ean,
    0, coalesce(v_current_qty, 0), 'set', 'manual', btrim(p_found_location), p_idempotency_key, auth.uid()
  );
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.pc_flag_found_elsewhere(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pc_flag_found_elsewhere(uuid, text, uuid) TO authenticated;
