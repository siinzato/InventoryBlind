/*
# Configurações Avançadas — Webhooks de saída (Fase 3/3): eventos reais

## Summary
Liga os dois eventos da v1 (physical_count.finalized, physical_count.approved)
às RPCs que já resolvem company_id/papel a partir do usuário autenticado no
servidor: `pc_finalize_session` e `pc_approve_session` (última definição:
migration 059). O corpo de cada função é reproduzido INTEGRALMENTE — nenhuma
regra de negócio muda — só uma chamada a `company_webhook_enqueue_event` é
acrescentada antes do RETURN, dentro de um bloco que nunca pode derrubar a
finalização/aprovação em si (mesmo padrão defensivo já usado ali para a
avaliação de recontagem automática, migration 049).
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- pc_finalize_session — corpo idêntico à migration 059, mais o enfileiramento
-- do evento physical_count.finalized.
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
  v_deleted_at   timestamptz;
  v_pending      integer;
  v_divergent    integer;
  v_final_status text;
BEGIN
  v_company := get_my_company_id();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No active company';
  END IF;

  SELECT company_id, status, deleted_at INTO v_sess_company, v_status, v_deleted_at
  FROM physical_count_sessions WHERE id = p_session_id FOR UPDATE;

  IF v_sess_company IS NULL THEN
    RAISE EXCEPTION 'Session not found';
  END IF;
  IF v_sess_company::text <> v_company THEN
    RAISE EXCEPTION 'Session belongs to another company';
  END IF;
  IF v_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Esta contagem foi removida do histórico.';
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

  -- Herdado da 049: a avaliação automática não pode derrubar o fechamento.
  BEGIN
    PERFORM pc_evaluate_auto_recount(p_session_id);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- NOVO (065): mesmo tratamento defensivo — um webhook mal configurado
  -- (URL fora do ar, etc.) nunca pode impedir a sessão de ser finalizada.
  BEGIN
    PERFORM company_webhook_enqueue_event(
      v_company::uuid,
      'physical_count.finalized',
      jsonb_build_object(
        'session_id', p_session_id,
        'status', v_final_status,
        'divergent_items', v_divergent
      )
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN v_final_status;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.pc_finalize_session(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.pc_finalize_session(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- pc_approve_session — corpo idêntico à migration 059, mais o enfileiramento
-- do evento physical_count.approved.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pc_approve_session(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_company      text;
  v_role         text;
  v_sess_company uuid;
  v_status       text;
  v_deleted_at   timestamptz;
BEGIN
  v_company := get_my_company_id();
  v_role    := get_my_role();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No active company';
  END IF;
  IF v_role NOT IN ('owner','admin','manager') THEN
    RAISE EXCEPTION 'Only manager or admin can approve a session';
  END IF;

  SELECT company_id, status, deleted_at INTO v_sess_company, v_status, v_deleted_at
  FROM physical_count_sessions WHERE id = p_session_id FOR UPDATE;

  IF v_sess_company IS NULL THEN
    RAISE EXCEPTION 'Session not found';
  END IF;
  IF v_sess_company::text <> v_company THEN
    RAISE EXCEPTION 'Session belongs to another company';
  END IF;
  IF v_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Esta contagem foi removida do histórico.';
  END IF;
  IF v_status NOT IN ('completed','with_divergences') THEN
    RAISE EXCEPTION 'Only a finalized session can be approved';
  END IF;

  UPDATE physical_count_sessions
  SET approved_by = auth.uid(), approved_at = now(), updated_at = now()
  WHERE id = p_session_id;

  -- NOVO (065): mesmo tratamento defensivo do finalize acima.
  BEGIN
    PERFORM company_webhook_enqueue_event(
      v_company::uuid,
      'physical_count.approved',
      jsonb_build_object('session_id', p_session_id)
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.pc_approve_session(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.pc_approve_session(uuid) TO authenticated;
