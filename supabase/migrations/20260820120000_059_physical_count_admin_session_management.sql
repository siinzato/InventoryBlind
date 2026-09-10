/*
# Contagem Física Digital — gerenciamento administrativo das sessões

## Summary
owner/admin passam a poder (1) corrigir as informações administrativas de uma
sessão (depósito, área, observação) e (2) remover uma sessão do histórico
visível. As duas coisas passam obrigatoriamente por RPC SECURITY DEFINER, que
revalida papel, empresa e estado da sessão no servidor — a tela apenas esconde
os botões, o que não é barreira nenhuma.

## Exclusão é lógica, nunca hard delete
`deleted_at`/`deleted_by`/`deletion_reason` em physical_count_sessions. Nenhuma
linha é apagada: physical_count_items, physical_count_events, erp_sync_events e
physical_count_recount_events continuam intactos, então uma contagem removida da
lista segue auditável por quem tem acesso a audit_logs. A sessão sai da lista e
deixa de aceitar qualquer operação.

## Policies revistas
- `pc_sessions_delete` (039) permitia DELETE direto para owner/admin/manager.
  REMOVIDA: um hard delete levaria os itens e os eventos por CASCADE, ou seja,
  apagaria a própria prova da contagem. A remoção administrativa agora existe e
  é lógica; não há caso de uso legítimo para o DELETE direto.
- `pc_sessions_update` (039) permitia UPDATE direto de QUALQUER coluna para
  qualquer usuário autenticado da empresa — inclusive status, aprovação, datas e
  (a partir desta migration) deleted_at. REMOVIDA depois de verificar que
  ninguém depende dela:
    * o frontend só lê a tabela (listSessions/getSession em
      physicalCountService.ts); todo o resto do ciclo de vida é RPC
      (pc_create_session, pc_start_session, pc_register_count,
      pc_flag_found_elsewhere, pc_finalize_session, pc_create_recount_session,
      pc_reopen_session, pc_approve_session) e SECURITY DEFINER ignora RLS;
    * as ações de automação que escrevem na tabela (append de observação e
      atribuição de responsável, em supabase/functions/automation-run) usam o
      adminClient com service_role, que também ignora RLS.
  A policy de SELECT e a de INSERT ficam como estão.

## RPCs operacionais
Todas as que recebem uma sessão passam a recusar sessão removida. Os corpos são
cópias fiéis da última versão vigente (039 para a maioria, 041 para
pc_flag_found_elsewhere, 049 para pc_finalize_session) com a checagem
acrescentada na consulta que a função já fazia — nenhuma regra existente muda.

## Auditoria
Registrada dentro das RPCs, na mesma transação da alteração — não há caminho em
que a mudança aconteça e o registro não. Ações novas:
`physical_count.session_updated` e `physical_count.session_deleted`.
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Colunas de exclusão lógica
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE physical_count_sessions
  ADD COLUMN IF NOT EXISTS deleted_at      timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by      uuid,
  ADD COLUMN IF NOT EXISTS deletion_reason text;

-- Índice parcial: a listagem do histórico passa a ser sempre
-- "empresa + não removidas, mais recentes primeiro".
CREATE INDEX IF NOT EXISTS pc_sessions_company_active_idx
  ON physical_count_sessions (company_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Fechar a escrita direta (ver o cabeçalho para a análise)
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "pc_sessions_delete" ON physical_count_sessions;
DROP POLICY IF EXISTS "pc_sessions_update" ON physical_count_sessions;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. pc_admin_update_session — só depósito, área e observação
--
-- A faixa de localização não entra de propósito: os itens da sessão foram
-- resolvidos a partir dela na criação, então mudar a faixa depois descreveria
-- uma contagem que não foi a que aconteceu. Mesmo raciocínio para número da
-- contagem, status, quantidades, saldo ERP, datas, aprovação e vínculo de
-- recontagem. `company_id` nunca é aceito do cliente.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pc_admin_update_session(
  p_session_id  uuid,
  p_warehouse   text,
  p_area        text,
  p_observation text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_company         text;
  v_role            text;
  v_email           text;
  v_before          physical_count_sessions%ROWTYPE;
  v_new_warehouse   text;
  v_new_area        text;
  v_new_observation text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Nenhum usuário autenticado nesta requisição.';
  END IF;

  v_company := get_my_company_id();
  v_role    := get_my_role();

  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Nenhuma empresa ativa para este usuário.';
  END IF;
  IF v_role IS NULL OR v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Apenas owner ou admin podem editar as informações da contagem.';
  END IF;

  SELECT * INTO v_before FROM physical_count_sessions WHERE id = p_session_id FOR UPDATE;

  IF v_before.id IS NULL THEN
    RAISE EXCEPTION 'Contagem não encontrada.';
  END IF;
  IF v_before.company_id::text <> v_company THEN
    RAISE EXCEPTION 'Esta contagem pertence a outra empresa.';
  END IF;
  IF v_before.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Esta contagem foi removida do histórico e não pode ser editada.';
  END IF;

  v_new_warehouse   := nullif(btrim(coalesce(p_warehouse,   '')), '');
  v_new_area        := nullif(btrim(coalesce(p_area,        '')), '');
  v_new_observation := nullif(btrim(coalesce(p_observation, '')), '');

  UPDATE physical_count_sessions
  SET warehouse   = v_new_warehouse,
      area        = v_new_area,
      observation = v_new_observation,
      updated_at  = now()
  WHERE id = p_session_id;

  SELECT email INTO v_email FROM profiles WHERE id = auth.uid();

  INSERT INTO audit_logs (
    company_id, user_id, user_email, action, resource_type, resource_id, description, metadata
  ) VALUES (
    v_before.company_id,
    auth.uid(),
    coalesce(v_email, ''),
    'physical_count.session_updated',
    'physical_count_session',
    p_session_id::text,
    'Informações administrativas da contagem física alteradas.',
    jsonb_build_object(
      'sessionId', p_session_id,
      'changedAt', now(),
      'changedBy', auth.uid(),
      'before', jsonb_build_object(
        'warehouse',   v_before.warehouse,
        'area',        v_before.area,
        'observation', v_before.observation
      ),
      'after', jsonb_build_object(
        'warehouse',   v_new_warehouse,
        'area',        v_new_area,
        'observation', v_new_observation
      )
    )
  );
END;
$fn$;

-- `FROM PUBLIC` sozinho não basta: o Supabase mantém default privileges que
-- concedem EXECUTE explicitamente a `anon` em toda função nova do schema public,
-- e grant explícito não é removido revogando de PUBLIC. Verificado no banco com
-- has_function_privilege('anon', ...). Mesmo padrão da migration 013 para
-- get_my_company_id/get_my_role.
REVOKE EXECUTE ON FUNCTION public.pc_admin_update_session(uuid, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pc_admin_update_session(uuid, text, text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.pc_admin_update_session(uuid, text, text, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. pc_admin_delete_session — exclusão lógica, com justificativa obrigatória
--
-- Os três campos são preenchidos no mesmo UPDATE: não existe estado em que a
-- sessão saia do histórico sem que se saiba quem a removeu e por quê.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pc_admin_delete_session(
  p_session_id uuid,
  p_reason     text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_company text;
  v_role    text;
  v_email   text;
  v_reason  text;
  v_before  physical_count_sessions%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Nenhum usuário autenticado nesta requisição.';
  END IF;

  v_company := get_my_company_id();
  v_role    := get_my_role();

  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Nenhuma empresa ativa para este usuário.';
  END IF;
  IF v_role IS NULL OR v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Apenas owner ou admin podem remover uma contagem do histórico.';
  END IF;

  v_reason := btrim(coalesce(p_reason, ''));
  IF char_length(v_reason) < 5 THEN
    RAISE EXCEPTION 'A justificativa precisa ter pelo menos 5 caracteres.';
  END IF;

  SELECT * INTO v_before FROM physical_count_sessions WHERE id = p_session_id FOR UPDATE;

  IF v_before.id IS NULL THEN
    RAISE EXCEPTION 'Contagem não encontrada.';
  END IF;
  IF v_before.company_id::text <> v_company THEN
    RAISE EXCEPTION 'Esta contagem pertence a outra empresa.';
  END IF;
  IF v_before.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Esta contagem já foi removida do histórico.';
  END IF;

  UPDATE physical_count_sessions
  SET deleted_at      = now(),
      deleted_by      = auth.uid(),
      deletion_reason = v_reason,
      updated_at      = now()
  WHERE id = p_session_id;

  SELECT email INTO v_email FROM profiles WHERE id = auth.uid();

  INSERT INTO audit_logs (
    company_id, user_id, user_email, action, resource_type, resource_id, description, metadata
  ) VALUES (
    v_before.company_id,
    auth.uid(),
    coalesce(v_email, ''),
    'physical_count.session_deleted',
    'physical_count_session',
    p_session_id::text,
    'Contagem física removida do histórico visível.',
    jsonb_build_object(
      'sessionId',   p_session_id,
      'range',       v_before.street_from || ' → ' || v_before.street_to,
      'streetFrom',  v_before.street_from,
      'streetTo',    v_before.street_to,
      'warehouse',   v_before.warehouse,
      'countNumber', v_before.count_number,
      'status',      v_before.status,
      'totalItems',  v_before.total_items,
      'reason',      v_reason,
      'deletedBy',   auth.uid(),
      'deletedAt',   now()
    )
  );
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.pc_admin_delete_session(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pc_admin_delete_session(uuid, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.pc_admin_delete_session(uuid, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RPCs operacionais — recusar sessão removida
--
-- Cada função abaixo é a última versão vigente com a checagem acrescentada na
-- consulta que ela já fazia (nenhuma consulta nova, nenhuma regra alterada).
-- ─────────────────────────────────────────────────────────────────────────────

-- 5.1 pc_start_session (base: 039)
CREATE OR REPLACE FUNCTION public.pc_start_session(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_company      text;
  v_sess_company uuid;
  v_status       text;
  v_count_number smallint;
  v_deleted_at   timestamptz;
BEGIN
  v_company := get_my_company_id();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No active company';
  END IF;

  SELECT company_id, status, count_number, deleted_at
  INTO v_sess_company, v_status, v_count_number, v_deleted_at
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
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'Session already started';
  END IF;
  IF v_count_number <> 1 THEN
    RAISE EXCEPTION 'Only the first count is started this way — recount sessions start already in_progress';
  END IF;

  UPDATE physical_count_items i
  SET erp_quantity_snapshot = p.stock_quantity, updated_at = now()
  FROM products p
  WHERE i.session_id = p_session_id AND i.product_id = p.id;

  UPDATE physical_count_sessions
  SET status = 'in_progress', started_at = now(), started_by = auth.uid(), updated_at = now()
  WHERE id = p_session_id;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.pc_start_session(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.pc_start_session(uuid) TO authenticated;

-- 5.2 pc_register_count (base: 039)
CREATE OR REPLACE FUNCTION public.pc_register_count(
  p_item_id         uuid,
  p_mode            text,
  p_quantity        numeric,
  p_source          text,
  p_idempotency_key uuid
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_company      text;
  v_item_company uuid;
  v_session_id   uuid;
  v_sess_status  text;
  v_sess_deleted timestamptz;
  v_current      numeric;
  v_new          numeric;
  v_delta        numeric;
  v_existing     numeric;
  v_product_id   uuid;
  v_sku          text;
  v_ean          text;
BEGIN
  v_company := get_my_company_id();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No active company';
  END IF;

  IF p_mode NOT IN ('increment','set') THEN
    RAISE EXCEPTION 'Invalid mode';
  END IF;
  IF p_source NOT IN ('scanner','manual') THEN
    RAISE EXCEPTION 'Invalid source';
  END IF;

  SELECT resulting_quantity INTO v_existing
  FROM physical_count_events WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  SELECT company_id, session_id, coalesce(physical_quantity, 0), product_id, sku, ean
  INTO v_item_company, v_session_id, v_current, v_product_id, v_sku, v_ean
  FROM physical_count_items WHERE id = p_item_id FOR UPDATE;

  IF v_item_company IS NULL THEN
    RAISE EXCEPTION 'Item not found';
  END IF;
  IF v_item_company::text <> v_company THEN
    RAISE EXCEPTION 'Item belongs to another company';
  END IF;

  SELECT status, deleted_at INTO v_sess_status, v_sess_deleted
  FROM physical_count_sessions WHERE id = v_session_id FOR UPDATE;
  IF v_sess_deleted IS NOT NULL THEN
    RAISE EXCEPTION 'Esta contagem foi removida do histórico.';
  END IF;
  IF v_sess_status <> 'in_progress' THEN
    RAISE EXCEPTION 'Session is not in progress';
  END IF;

  IF p_mode = 'increment' THEN
    v_new := v_current + p_quantity;
  ELSE
    v_new := p_quantity;
  END IF;
  IF v_new < 0 THEN
    v_new := 0;
  END IF;

  v_delta := v_new - v_current;

  INSERT INTO physical_count_events (
    company_id, session_id, item_id, product_id, sku, ean,
    delta, resulting_quantity, mode, source, idempotency_key, created_by
  ) VALUES (
    v_item_company, v_session_id, p_item_id, v_product_id, v_sku, v_ean,
    v_delta, v_new, p_mode, p_source, p_idempotency_key, auth.uid()
  );

  UPDATE physical_count_items
  SET physical_quantity = v_new, updated_at = now()
  WHERE id = p_item_id;

  RETURN v_new;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.pc_register_count(uuid, text, numeric, text, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.pc_register_count(uuid, text, numeric, text, uuid) TO authenticated;

-- 5.3 pc_flag_found_elsewhere (base: 041)
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
  v_sess_deleted      timestamptz;
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

  SELECT status, deleted_at INTO v_sess_status, v_sess_deleted
  FROM physical_count_sessions WHERE id = v_session_id FOR UPDATE;
  IF v_sess_deleted IS NOT NULL THEN
    RAISE EXCEPTION 'Esta contagem foi removida do histórico.';
  END IF;
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
GRANT  EXECUTE ON FUNCTION public.pc_flag_found_elsewhere(uuid, text, numeric, uuid) TO authenticated;

-- 5.4 pc_finalize_session (base: 049 — inclui a avaliação de recontagem automática)
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

  RETURN v_final_status;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.pc_finalize_session(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.pc_finalize_session(uuid) TO authenticated;

-- 5.5 pc_create_recount_session (base: 039)
CREATE OR REPLACE FUNCTION public.pc_create_recount_session(
  p_parent_session_id uuid,
  p_responsible_id     uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_company        text;
  v_parent          physical_count_sessions%ROWTYPE;
  v_new_session_id  uuid;
  v_inserted        integer;
BEGIN
  v_company := get_my_company_id();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No active company';
  END IF;

  SELECT * INTO v_parent FROM physical_count_sessions WHERE id = p_parent_session_id FOR UPDATE;

  IF v_parent.id IS NULL THEN
    RAISE EXCEPTION 'Parent session not found';
  END IF;
  IF v_parent.company_id::text <> v_company THEN
    RAISE EXCEPTION 'Parent session belongs to another company';
  END IF;
  IF v_parent.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Esta contagem foi removida do histórico.';
  END IF;
  IF v_parent.status NOT IN ('completed','with_divergences') THEN
    RAISE EXCEPTION 'Parent session must be finalized before creating a recount';
  END IF;
  IF v_parent.count_number >= 3 THEN
    RAISE EXCEPTION 'Maximum of 3 counting rounds reached';
  END IF;

  INSERT INTO physical_count_sessions (
    company_id, root_session_id, linked_session_id, count_number,
    warehouse, area, street_from, street_to, responsible_id, observation, status,
    started_at, started_by
  ) VALUES (
    v_parent.company_id, v_parent.root_session_id, v_parent.id, v_parent.count_number + 1,
    v_parent.warehouse, v_parent.area, v_parent.street_from, v_parent.street_to,
    coalesce(p_responsible_id, v_parent.responsible_id), v_parent.observation, 'in_progress',
    now(), auth.uid()
  )
  RETURNING id INTO v_new_session_id;

  INSERT INTO physical_count_items (
    session_id, company_id, product_id, sku, ean, location,
    erp_quantity_snapshot, erp_source, erp_sync_ref
  )
  SELECT v_new_session_id, company_id, product_id, sku, ean, location,
         erp_quantity_snapshot, erp_source, erp_sync_ref
  FROM physical_count_items
  WHERE session_id = p_parent_session_id AND result_status <> 'ok';

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN
    RAISE EXCEPTION 'Parent session has no divergent items to recount';
  END IF;

  UPDATE physical_count_sessions SET total_items = v_inserted, updated_at = now() WHERE id = v_new_session_id;

  RETURN v_new_session_id;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.pc_create_recount_session(uuid, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.pc_create_recount_session(uuid, uuid) TO authenticated;

-- 5.6 pc_reopen_session (base: 039)
CREATE OR REPLACE FUNCTION public.pc_reopen_session(p_session_id uuid)
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
    RAISE EXCEPTION 'Only manager or admin can reopen a session';
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
    RAISE EXCEPTION 'Only a finalized session can be reopened';
  END IF;

  UPDATE physical_count_sessions
  SET status = 'in_progress', finished_at = NULL, finished_by = NULL, updated_at = now()
  WHERE id = p_session_id;

  UPDATE physical_count_items
  SET result_status = NULL, updated_at = now()
  WHERE session_id = p_session_id;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.pc_reopen_session(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.pc_reopen_session(uuid) TO authenticated;

-- 5.7 pc_approve_session (base: 039)
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
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.pc_approve_session(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.pc_approve_session(uuid) TO authenticated;

-- 5.8 pc_record_erp_sync_event (base: 039)
CREATE OR REPLACE FUNCTION public.pc_record_erp_sync_event(
  p_session_id        uuid,
  p_item_id           uuid,
  p_product_id        uuid,
  p_sku               text,
  p_provider          text,
  p_previous_quantity numeric,
  p_final_quantity    numeric,
  p_adjustment        numeric,
  p_request_payload   jsonb,
  p_response_payload  jsonb,
  p_success           boolean,
  p_pending           boolean,
  p_error_message     text,
  p_idempotency_key   uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_company      text;
  v_role         text;
  v_sess_company uuid;
  v_approved_at  timestamptz;
  v_deleted_at   timestamptz;
  v_event_id     uuid;
BEGIN
  v_company := get_my_company_id();
  v_role    := get_my_role();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No active company';
  END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Only owner or admin can record an ERP sync event';
  END IF;

  SELECT company_id, approved_at, deleted_at INTO v_sess_company, v_approved_at, v_deleted_at
  FROM physical_count_sessions WHERE id = p_session_id;

  IF v_sess_company IS NULL THEN
    RAISE EXCEPTION 'Session not found';
  END IF;
  IF v_sess_company::text <> v_company THEN
    RAISE EXCEPTION 'Session belongs to another company';
  END IF;
  IF v_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Esta contagem foi removida do histórico.';
  END IF;
  IF v_approved_at IS NULL THEN
    RAISE EXCEPTION 'Session must be approved before syncing to ERP';
  END IF;

  INSERT INTO erp_sync_events (
    company_id, session_id, item_id, product_id, sku, provider,
    previous_quantity, final_quantity, adjustment,
    request_payload, response_payload, success, pending, error_message,
    idempotency_key, created_by
  ) VALUES (
    v_sess_company, p_session_id, p_item_id, p_product_id, p_sku, p_provider,
    p_previous_quantity, p_final_quantity, p_adjustment,
    p_request_payload, p_response_payload, p_success, p_pending, p_error_message,
    p_idempotency_key, auth.uid()
  )
  ON CONFLICT (idempotency_key) DO UPDATE SET id = erp_sync_events.id
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.pc_record_erp_sync_event(
  uuid, uuid, uuid, text, text, numeric, numeric, numeric, jsonb, jsonb, boolean, boolean, text, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pc_record_erp_sync_event(
  uuid, uuid, uuid, text, text, numeric, numeric, numeric, jsonb, jsonb, boolean, boolean, text, uuid
) TO authenticated;
