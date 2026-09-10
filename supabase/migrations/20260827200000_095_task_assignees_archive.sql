/*
# Arquivamento de tarefas concluídas (Kanban → coluna Concluído)

## Contexto
O Kanban de "Meu Trabalho" reflete a PRÓPRIA participação do usuário em
task_assignees (não o status agregado da tarefa). Arquivar uma tarefa
concluída deve, portanto, afetar só a própria linha de responsável do
usuário — nunca a tarefa inteira nem a visão de outros responsáveis.

## Modelo
Uma única coluna nova, `task_assignees.archived_at timestamptz`, com três
estados:
  - NULL           → nunca arquivada. Elegível ao corte automático de 7 dias
                     (calculado no client a partir de completed_at — sem
                     cron: ver computeIsAssigneeArchived em taskDomain.ts).
  - valor no passado → arquivada explicitamente (ação "Arquivar agora" ou
                     em lote). Some do board, aparece no drawer "Arquivadas".
  - 'infinity'     → restaurada explicitamente. Fica de fora do corte
                     automático para sempre (sentinela padrão do Postgres
                     para "nunca", não precisa de coluna extra para guardar
                     essa decisão).

Isso resolve arquivamento automático "no carregamento/consulta" sem
infraestrutura nova: o corte de 7 dias é só uma regra de leitura no client
sobre completed_at; a coluna só é escrita por ação explícita do usuário
(arquivar ou restaurar).
*/

ALTER TABLE task_assignees ADD COLUMN IF NOT EXISTS archived_at timestamptz NULL;

-- ── task_archive_my_assignment — "Arquivar agora" num card concluído ────────
CREATE OR REPLACE FUNCTION public.task_archive_my_assignment(p_task_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_assignee_id uuid;
  v_status text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado.'; END IF;

  SELECT id, status INTO v_assignee_id, v_status
  FROM task_assignees WHERE task_id = p_task_id AND user_id = v_uid;
  IF v_assignee_id IS NULL THEN RAISE EXCEPTION 'Você não é responsável por esta tarefa.'; END IF;
  IF v_status <> 'done' THEN RAISE EXCEPTION 'Só é possível arquivar tarefas concluídas.'; END IF;

  UPDATE task_assignees SET archived_at = now() WHERE id = v_assignee_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.task_archive_my_assignment(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.task_archive_my_assignment(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.task_archive_my_assignment(uuid) TO authenticated;

-- ── task_restore_my_assignment — drawer "Arquivadas" → Restaurar ───────────
CREATE OR REPLACE FUNCTION public.task_restore_my_assignment(p_task_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_assignee_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado.'; END IF;

  SELECT id INTO v_assignee_id FROM task_assignees WHERE task_id = p_task_id AND user_id = v_uid;
  IF v_assignee_id IS NULL THEN RAISE EXCEPTION 'Você não é responsável por esta tarefa.'; END IF;

  -- 'infinity' (não NULL) para nunca mais cair no corte automático de 7 dias.
  UPDATE task_assignees SET archived_at = 'infinity'::timestamptz WHERE id = v_assignee_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.task_restore_my_assignment(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.task_restore_my_assignment(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.task_restore_my_assignment(uuid) TO authenticated;

-- ── task_archive_my_done_eligible — "Arquivar concluídas" em lote ──────────
CREATE OR REPLACE FUNCTION public.task_archive_my_done_eligible()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_count integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado.'; END IF;

  UPDATE task_assignees
  SET archived_at = now()
  WHERE user_id = v_uid
    AND status = 'done'
    AND (archived_at IS NULL OR archived_at = 'infinity'::timestamptz);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$fn$;

REVOKE ALL ON FUNCTION public.task_archive_my_done_eligible() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.task_archive_my_done_eligible() FROM anon;
GRANT EXECUTE ON FUNCTION public.task_archive_my_done_eligible() TO authenticated;
