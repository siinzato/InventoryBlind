/*
# Contagem Física Digital — separar "quantidade no local" de "excedente em outro local"

## Summary
Hoje `pc_flag_found_elsewhere` só grava um texto de local (found_location),
sem quantidade — a tela de contagem tinha um único contador ("quantidade
encontrada") misturando o que estava no local esperado com o que apareceu em
outro lugar. Pedido do usuário: dois campos numéricos distintos, para o
operador enxergar de onde veio uma divergência (faltou de verdade vs. estava
só mal-posicionado).

`physical_quantity` continua sendo "quantidade encontrada no local esperado"
(inalterado, mesmo pc_register_count de sempre). Esta migration adiciona
`found_elsewhere_quantity` para a quantidade encontrada em local diferente, e
estende `pc_flag_found_elsewhere` para gravar as duas coisas juntas
(local + quantidade) em vez de só o local. A reconciliação contra o ERP passa
a comparar o TOTAL (physical_quantity + found_elsewhere_quantity) — ver
physicalCountAlgorithm.ts::computeItemResult.
*/

ALTER TABLE physical_count_items
  ADD COLUMN IF NOT EXISTS found_elsewhere_quantity numeric NOT NULL DEFAULT 0;

DROP FUNCTION IF EXISTS public.pc_flag_found_elsewhere(uuid, text, uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- pc_flag_found_elsewhere — agora recebe também a quantidade encontrada nesse
-- local diferente (semântica "set", igual ao modo manual de pc_register_count:
-- reenviar substitui o valor anterior, não soma). Convenção do log de eventos:
-- quando found_location IS NOT NULL, delta/resulting_quantity da linha se
-- referem a found_elsewhere_quantity, não a physical_quantity (que tem seu
-- próprio rastro de eventos com found_location NULL via pc_register_count).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pc_flag_found_elsewhere(
  p_item_id         uuid,
  p_found_location  text,
  p_quantity        numeric,
  p_idempotency_key uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_company           text;
  v_item_company      uuid;
  v_session_id        uuid;
  v_sess_status       text;
  v_current_elsewhere numeric;
  v_product_id        uuid;
  v_sku               text;
  v_ean               text;
  v_existing          uuid;
BEGIN
  v_company := get_my_company_id();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No active company';
  END IF;

  IF p_found_location IS NULL OR btrim(p_found_location) = '' THEN
    RAISE EXCEPTION 'found_location is required';
  END IF;

  IF p_quantity IS NULL OR p_quantity < 0 THEN
    RAISE EXCEPTION 'quantity must be zero or a positive number';
  END IF;

  SELECT id INTO v_existing FROM physical_count_events WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    RETURN;
  END IF;

  SELECT company_id, session_id, coalesce(found_elsewhere_quantity, 0), product_id, sku, ean
  INTO v_item_company, v_session_id, v_current_elsewhere, v_product_id, v_sku, v_ean
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
  SET found_location = btrim(p_found_location),
      found_elsewhere_quantity = p_quantity,
      updated_at = now()
  WHERE id = p_item_id;

  INSERT INTO physical_count_events (
    company_id, session_id, item_id, product_id, sku, ean,
    delta, resulting_quantity, mode, source, found_location, idempotency_key, created_by
  ) VALUES (
    v_item_company, v_session_id, p_item_id, v_product_id, v_sku, v_ean,
    p_quantity - v_current_elsewhere, p_quantity, 'set', 'manual', btrim(p_found_location), p_idempotency_key, auth.uid()
  );
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.pc_flag_found_elsewhere(uuid, text, numeric, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pc_flag_found_elsewhere(uuid, text, numeric, uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- pc_finalize_session — mesma função da 039, só troca o cálculo de
-- result_status para considerar o TOTAL físico (local + excedente em outro
-- local), senão um item com tudo explicado (achado, só que mal-posicionado)
-- continuaria marcado como "faltando" mesmo depois do operador flagar onde
-- ele estava de verdade.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pc_finalize_session(p_session_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_company      text;
  v_sess_company uuid;
  v_status       text;
  v_pending      integer;
  v_divergent    integer;
  v_final_status text;
BEGIN
  v_company := get_my_company_id();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No active company';
  END IF;

  SELECT company_id, status INTO v_sess_company, v_status
  FROM physical_count_sessions WHERE id = p_session_id FOR UPDATE;

  IF v_sess_company IS NULL THEN
    RAISE EXCEPTION 'Session not found';
  END IF;
  IF v_sess_company::text <> v_company THEN
    RAISE EXCEPTION 'Session belongs to another company';
  END IF;
  IF v_status <> 'in_progress' THEN
    RAISE EXCEPTION 'Session is not in progress (cannot finalize twice)';
  END IF;

  SELECT count(*) INTO v_pending
  FROM physical_count_items WHERE session_id = p_session_id AND physical_quantity IS NULL;

  IF v_pending > 0 THEN
    RAISE EXCEPTION 'Cannot finalize: % item(s) not yet counted', v_pending;
  END IF;

  UPDATE physical_count_items i
  SET
    result_status = CASE
      WHEN (i.physical_quantity + i.found_elsewhere_quantity) = i.erp_quantity_snapshot THEN 'ok'
      WHEN (i.physical_quantity + i.found_elsewhere_quantity) < i.erp_quantity_snapshot THEN 'missing'
      ELSE 'surplus'
    END,
    snapshot_product_name = p.name,
    snapshot_sku          = p.sku,
    snapshot_ean           = p.ean,
    updated_at = now()
  FROM products p
  WHERE i.session_id = p_session_id AND i.product_id = p.id;

  SELECT count(*) INTO v_divergent
  FROM physical_count_items
  WHERE session_id = p_session_id AND result_status <> 'ok';

  v_final_status := CASE WHEN v_divergent = 0 THEN 'completed' ELSE 'with_divergences' END;

  UPDATE physical_count_sessions
  SET status = v_final_status, finished_at = now(), finished_by = auth.uid(), updated_at = now()
  WHERE id = p_session_id;

  RETURN v_final_status;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.pc_finalize_session(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pc_finalize_session(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- physical_count_final_result_v — mesma view da 039, count_1/2/3 agora somam
-- o excedente de outro local (NULL + 0 = NULL, então uma rodada ainda não
-- contada continua aparecendo em branco, sem falso zero).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW physical_count_final_result_v
WITH (security_invoker = true) AS
SELECT
  s.root_session_id,
  MAX(s.company_id::text)                                                                          AS company_id,
  i.product_id,
  MAX(i.sku)                                                                                        AS sku,
  MAX(i.ean)                                                                                        AS ean,
  MAX(i.location)                                                                                   AS location,
  MAX(i.erp_quantity_snapshot)                                                                      AS erp_quantity_snapshot,
  MAX(CASE WHEN s.count_number = 1 THEN i.physical_quantity + i.found_elsewhere_quantity END)        AS count_1,
  MAX(CASE WHEN s.count_number = 2 THEN i.physical_quantity + i.found_elsewhere_quantity END)        AS count_2,
  MAX(CASE WHEN s.count_number = 3 THEN i.physical_quantity + i.found_elsewhere_quantity END)        AS count_3,
  MAX(CASE WHEN s.count_number = 1 THEN s.approved_at END) IS NOT NULL
    OR MAX(CASE WHEN s.count_number = 2 THEN s.approved_at END) IS NOT NULL
    OR MAX(CASE WHEN s.count_number = 3 THEN s.approved_at END) IS NOT NULL AS any_round_approved
FROM physical_count_items i
JOIN physical_count_sessions s ON s.id = i.session_id
GROUP BY s.root_session_id, i.product_id;
