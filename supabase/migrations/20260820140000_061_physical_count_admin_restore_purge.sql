/*
# Contagem Física — restaurar, excluir rascunho e restringir a reabertura

## Summary
Completa os controles administrativos abertos pela 059:

1. `pc_admin_restore_session` — devolve ao histórico uma sessão arquivada.
2. `pc_admin_hard_delete_draft_session` — a ÚNICA exclusão física do módulo, e
   só para rascunho sem dependências (nenhum evento de contagem, nenhuma
   recontagem filha, nenhum evento de sincronização com ERP, nenhuma avaliação
   automática registrada). Os itens do rascunho vão por CASCADE — eles são o
   conteúdo do próprio rascunho, não uma dependência externa.
3. `pc_reopen_session` passa a exigir owner/admin.

## MUDANÇA DE PERMISSÃO — manager perde a reabertura
A 039 permitia owner/admin/manager em pc_reopen_session. Reabrir uma contagem
finalizada zera o result_status de todos os itens, ou seja, desfaz o fechamento —
é ação administrativa, não operacional. Passa a ser owner/admin.
`pc_approve_session` NÃO muda: aprovar continua com owner/admin/manager, porque
é parte do fluxo operacional de fechamento.

## Auditoria
As três ações gravam em audit_logs dentro da própria transação. A reabertura
passa a ser auditada (antes não era registrada em lugar nenhum), com
`physical_count.session_reopened`.
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. pc_admin_restore_session
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pc_admin_restore_session(
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
    RAISE EXCEPTION 'Apenas owner ou admin podem restaurar uma contagem.';
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
  IF v_before.deleted_at IS NULL THEN
    RAISE EXCEPTION 'Esta contagem não está arquivada.';
  END IF;

  UPDATE physical_count_sessions
  SET deleted_at      = NULL,
      deleted_by      = NULL,
      deletion_reason = NULL,
      updated_at      = now()
  WHERE id = p_session_id;

  SELECT email INTO v_email FROM profiles WHERE id = auth.uid();

  INSERT INTO audit_logs (
    company_id, user_id, user_email, action, resource_type, resource_id, description, metadata
  ) VALUES (
    v_before.company_id,
    auth.uid(),
    coalesce(v_email, ''),
    'physical_count.session_restored',
    'physical_count_session',
    p_session_id::text,
    'Contagem física restaurada ao histórico visível.',
    jsonb_build_object(
      'sessionId',           p_session_id,
      'range',               v_before.street_from || ' → ' || v_before.street_to,
      'status',              v_before.status,
      'totalItems',          v_before.total_items,
      -- Por que estava fora, para a restauração se explicar sozinha.
      'previousDeletedAt',     v_before.deleted_at,
      'previousDeletedBy',     v_before.deleted_by,
      'previousDeletionReason', v_before.deletion_reason,
      'reason',              v_reason,
      'restoredBy',          auth.uid(),
      'restoredAt',          now()
    )
  );
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.pc_admin_restore_session(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pc_admin_restore_session(uuid, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.pc_admin_restore_session(uuid, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. pc_admin_hard_delete_draft_session
--
-- Exclusão física, permitida só onde não destrói prova: rascunho que nunca foi
-- contado. Qualquer dependência derruba a operação com mensagem específica, em
-- vez de uma recusa genérica — quem chamou precisa saber o que impede.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pc_admin_hard_delete_draft_session(
  p_session_id uuid,
  p_reason     text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_company   text;
  v_role      text;
  v_email     text;
  v_reason    text;
  v_before    physical_count_sessions%ROWTYPE;
  v_events    integer;
  v_children  integer;
  v_erp       integer;
  v_recounts  integer;
  v_items     integer;
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
    RAISE EXCEPTION 'Apenas owner ou admin podem excluir definitivamente uma contagem.';
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
  IF v_before.status <> 'draft' THEN
    RAISE EXCEPTION 'Só um rascunho pode ser excluído definitivamente. Esta contagem já foi iniciada — use a remoção do histórico.';
  END IF;

  SELECT count(*) INTO v_events   FROM physical_count_events WHERE session_id = p_session_id;
  IF v_events > 0 THEN
    RAISE EXCEPTION 'Esta contagem já tem % registro(s) de contagem e não pode ser excluída definitivamente.', v_events;
  END IF;

  SELECT count(*) INTO v_children FROM physical_count_sessions WHERE linked_session_id = p_session_id;
  IF v_children > 0 THEN
    RAISE EXCEPTION 'Esta contagem tem % recontagem(ns) vinculada(s) e não pode ser excluída definitivamente.', v_children;
  END IF;

  SELECT count(*) INTO v_erp      FROM erp_sync_events WHERE session_id = p_session_id;
  IF v_erp > 0 THEN
    RAISE EXCEPTION 'Esta contagem tem histórico de sincronização com o ERP e não pode ser excluída definitivamente.';
  END IF;

  SELECT count(*) INTO v_recounts
  FROM physical_count_recount_events
  WHERE source_session_id = p_session_id OR recount_session_id = p_session_id;
  IF v_recounts > 0 THEN
    RAISE EXCEPTION 'Esta contagem tem avaliação automática de recontagem registrada e não pode ser excluída definitivamente.';
  END IF;

  SELECT count(*) INTO v_items FROM physical_count_items WHERE session_id = p_session_id;

  -- Auditoria ANTES do DELETE: depois da exclusão não há de onde ler os dados,
  -- e a mesma transação garante que não existe exclusão sem registro.
  SELECT email INTO v_email FROM profiles WHERE id = auth.uid();

  INSERT INTO audit_logs (
    company_id, user_id, user_email, action, resource_type, resource_id, description, metadata
  ) VALUES (
    v_before.company_id,
    auth.uid(),
    coalesce(v_email, ''),
    'physical_count.session_hard_deleted',
    'physical_count_session',
    p_session_id::text,
    'Rascunho de contagem física excluído definitivamente.',
    jsonb_build_object(
      'sessionId',   p_session_id,
      'range',       v_before.street_from || ' → ' || v_before.street_to,
      'streetFrom',  v_before.street_from,
      'streetTo',    v_before.street_to,
      'warehouse',   v_before.warehouse,
      'area',        v_before.area,
      'observation', v_before.observation,
      'countNumber', v_before.count_number,
      'status',      v_before.status,
      'totalItems',  v_before.total_items,
      -- Quantos itens foram junto por CASCADE, para o número não ficar implícito.
      'cascadedItems', v_items,
      'createdAt',   v_before.created_at,
      'createdBy',   v_before.created_by,
      'reason',      v_reason,
      'deletedBy',   auth.uid(),
      'deletedAt',   now()
    )
  );

  DELETE FROM physical_count_sessions WHERE id = p_session_id;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.pc_admin_hard_delete_draft_session(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pc_admin_hard_delete_draft_session(uuid, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.pc_admin_hard_delete_draft_session(uuid, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. pc_reopen_session — owner/admin, e agora auditada
--
-- Corpo idêntico ao da 059 (verificado contra a definição viva do banco antes de
-- aplicar a 059), com duas mudanças: o papel exigido e o INSERT de auditoria.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pc_reopen_session(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_company      text;
  v_role         text;
  v_email        text;
  v_sess_company uuid;
  v_status       text;
  v_deleted_at   timestamptz;
BEGIN
  v_company := get_my_company_id();
  v_role    := get_my_role();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No active company';
  END IF;
  IF v_role IS NULL OR v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Apenas owner ou admin podem reabrir uma contagem.';
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

  SELECT email INTO v_email FROM profiles WHERE id = auth.uid();

  INSERT INTO audit_logs (
    company_id, user_id, user_email, action, resource_type, resource_id, description, metadata
  ) VALUES (
    v_sess_company,
    auth.uid(),
    coalesce(v_email, ''),
    'physical_count.session_reopened',
    'physical_count_session',
    p_session_id::text,
    'Contagem física reaberta — o resultado anterior foi desfeito.',
    jsonb_build_object(
      'sessionId',      p_session_id,
      'previousStatus', v_status,
      'reopenedBy',     auth.uid(),
      'reopenedAt',     now()
    )
  );
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.pc_reopen_session(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.pc_reopen_session(uuid) TO authenticated;
