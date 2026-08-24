/*
# Canal de notificações de tarefas — sino próprio no cabeçalho

Complementa a migration 070_task_management.sql (não a substitui). Fecha os
eventos e garantias que faltavam para o segundo canal, exclusivo de tarefas,
pedido para o cabeçalho global (separado do sino de comunicados gerais):
título/prazo de referência nas notificações, tipo "atrasada", sobrevivência
da notificação após a tarefa ser excluída, e Realtime.

## title / reference_date (colunas novas)
- `title`: o título da tarefa no momento do evento — sobrevive mesmo se a
  tarefa pessoal for depois excluída (ver item abaixo) ou o título editado.
- `reference_date` (timestamptz): a que prazo este aviso se refere. Para
  `due_soon`/`overdue` é o instante `due_date + due_time` (mesma convenção
  UTC que o cron de 070 já usava). A proteção contra duplicidade das rotinas
  agendadas passa a comparar (task_id, user_id, type, reference_date) em vez
  de uma janela de 24h corrida — assim, se o prazo for alterado, o novo prazo
  (reference_date diferente) pode gerar um aviso novo, mas o mesmo prazo
  nunca gera dois.

## task_id: CASCADE → SET NULL
Antes, excluir uma tarefa pessoal apagava com ela o próprio histórico de
notificação. O pedido é o oposto: o aviso permanece, e a tela informa que a
tarefa não está mais disponível (task_id nulo é o sinal disso).

## overdue (tipo novo)
Prazo já passou e o responsável ainda não concluiu a própria participação.
Mesmo cron do due_soon, mesma proteção contra duplicidade.

## Realtime
`task_notifications` entra na publicação `supabase_realtime`. A segurança
continua sendo a RLS já existente em 070 (cada usuário só enxerga as próprias
linhas) — o Postgres Changes do Supabase aplica RLS por assinante, não é uma
segunda camada de permissão nova.
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Colunas novas
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE task_notifications ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE task_notifications ADD COLUMN IF NOT EXISTS reference_date timestamptz;

UPDATE task_notifications n SET title = t.title
FROM tasks t WHERE t.id = n.task_id AND n.title IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. task_id: CASCADE → SET NULL (a notificação sobrevive à tarefa excluída)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE task_notifications DROP CONSTRAINT IF EXISTS task_notifications_task_id_fkey;
ALTER TABLE task_notifications ADD CONSTRAINT task_notifications_task_id_fkey
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. type: + 'overdue'
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE task_notifications DROP CONSTRAINT IF EXISTS task_notifications_type_check;
ALTER TABLE task_notifications ADD CONSTRAINT task_notifications_type_check
  CHECK (type IN ('assigned', 'due_date_changed', 'commented', 'due_soon', 'overdue'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Índice de deduplicação (tarefa, usuário, tipo, prazo de referência)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS task_notifications_dedup_idx
  ON task_notifications (task_id, user_id, type, reference_date);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. task_create — mesma lógica de 070, INSERTs de notificação com title
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.task_create(
  p_type          text,
  p_title         text,
  p_description   text,
  p_category      text,
  p_priority      text,
  p_due_date      date,
  p_due_time      time,
  p_assignee_ids  uuid[],
  p_checklist     text[]
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_company     uuid := (get_my_company_id())::uuid;
  v_role        text := get_my_role();
  v_uid         uuid := auth.uid();
  v_task_id     uuid;
  v_assignees   uuid[];
  v_valid_count integer;
  v_item        text;
  v_pos         integer := 0;
BEGIN
  IF v_company IS NULL THEN RAISE EXCEPTION 'Usuário sem empresa vinculada.'; END IF;
  IF p_type NOT IN ('personal', 'corporate') THEN RAISE EXCEPTION 'Tipo de tarefa inválido.'; END IF;
  IF p_title IS NULL OR btrim(p_title) = '' THEN RAISE EXCEPTION 'Título é obrigatório.'; END IF;
  IF p_priority NOT IN ('low', 'medium', 'high', 'urgent') THEN RAISE EXCEPTION 'Prioridade inválida.'; END IF;

  IF p_type = 'corporate' THEN
    IF v_role NOT IN ('owner', 'admin', 'manager') THEN
      RAISE EXCEPTION 'Somente gestores podem criar tarefas corporativas.';
    END IF;
    IF p_assignee_ids IS NULL OR array_length(p_assignee_ids, 1) IS NULL THEN
      RAISE EXCEPTION 'Selecione ao menos um responsável.';
    END IF;
    SELECT count(*) INTO v_valid_count FROM profiles WHERE id = ANY(p_assignee_ids) AND company_id = v_company;
    IF v_valid_count <> array_length(p_assignee_ids, 1) THEN
      RAISE EXCEPTION 'Um ou mais responsáveis não pertencem a esta empresa.';
    END IF;
    v_assignees := p_assignee_ids;
  ELSE
    v_assignees := ARRAY[v_uid];
  END IF;

  INSERT INTO tasks (company_id, type, title, description, category, priority, due_date, due_time, status, created_by)
  VALUES (v_company, p_type, btrim(p_title), p_description, p_category, p_priority, p_due_date, p_due_time, 'todo', v_uid)
  RETURNING id INTO v_task_id;

  INSERT INTO task_assignees (task_id, company_id, user_id, status, assigned_by)
  SELECT v_task_id, v_company, u, 'todo', v_uid FROM unnest(v_assignees) AS u;

  IF p_checklist IS NOT NULL THEN
    FOREACH v_item IN ARRAY p_checklist LOOP
      IF btrim(v_item) <> '' THEN
        INSERT INTO task_checklist_items (task_id, company_id, label, position) VALUES (v_task_id, v_company, btrim(v_item), v_pos);
        v_pos := v_pos + 1;
      END IF;
    END LOOP;
  END IF;

  INSERT INTO task_activity_logs (task_id, company_id, user_id, action, details)
  VALUES (v_task_id, v_company, v_uid, 'created', jsonb_build_object('type', p_type));

  IF p_type = 'corporate' THEN
    INSERT INTO task_activity_logs (task_id, company_id, user_id, action, details)
    SELECT v_task_id, v_company, v_uid, 'assigned', jsonb_build_object('assignee', u) FROM unnest(v_assignees) AS u;

    INSERT INTO task_notifications (company_id, user_id, task_id, type, title, message)
    SELECT v_company, u, v_task_id, 'assigned', btrim(p_title), 'Nova tarefa atribuída: ' || btrim(p_title)
    FROM unnest(v_assignees) AS u WHERE u <> v_uid;
  END IF;

  RETURN v_task_id;
END;
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. task_update — mesma lógica de 070, notificações com title/reference_date
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.task_update(
  p_task_id       uuid,
  p_title         text,
  p_description   text,
  p_category      text,
  p_priority      text,
  p_due_date      date,
  p_due_time      time,
  p_assignee_ids  uuid[] DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_company       uuid := (get_my_company_id())::uuid;
  v_role          text := get_my_role();
  v_uid           uuid := auth.uid();
  v_task          tasks%ROWTYPE;
  v_old_due_date  date;
  v_old_due_time  time;
  v_valid_count   integer;
  v_added         uuid[];
  v_removed       uuid[];
  v_new_reference timestamptz;
BEGIN
  IF p_title IS NULL OR btrim(p_title) = '' THEN RAISE EXCEPTION 'Título é obrigatório.'; END IF;
  IF p_priority NOT IN ('low', 'medium', 'high', 'urgent') THEN RAISE EXCEPTION 'Prioridade inválida.'; END IF;

  SELECT * INTO v_task FROM tasks WHERE id = p_task_id AND company_id = v_company;
  IF v_task.id IS NULL THEN RAISE EXCEPTION 'Tarefa não encontrada.'; END IF;
  IF v_task.status = 'cancelled' THEN RAISE EXCEPTION 'Tarefa cancelada não pode ser editada.'; END IF;

  IF v_task.type = 'personal' THEN
    IF v_task.created_by <> v_uid THEN RAISE EXCEPTION 'Somente o criador pode editar esta tarefa pessoal.'; END IF;
    IF p_assignee_ids IS NOT NULL THEN RAISE EXCEPTION 'Tarefas pessoais não têm responsáveis atribuíveis.'; END IF;
  ELSE
    IF v_role NOT IN ('owner', 'admin', 'manager') THEN RAISE EXCEPTION 'Somente gestores podem editar tarefas corporativas.'; END IF;
  END IF;

  v_old_due_date := v_task.due_date;
  v_old_due_time := v_task.due_time;

  UPDATE tasks SET
    title = btrim(p_title), description = p_description, category = p_category,
    priority = p_priority, due_date = p_due_date, due_time = p_due_time, updated_at = now()
  WHERE id = p_task_id;

  INSERT INTO task_activity_logs (task_id, company_id, user_id, action, details)
  VALUES (p_task_id, v_company, v_uid, 'edited', '{}'::jsonb);

  IF (p_due_date IS DISTINCT FROM v_old_due_date) OR (p_due_time IS DISTINCT FROM v_old_due_time) THEN
    v_new_reference := CASE WHEN p_due_date IS NOT NULL
      THEN (p_due_date + COALESCE(p_due_time, '23:59:59'::time)) AT TIME ZONE 'utc' ELSE NULL END;

    INSERT INTO task_notifications (company_id, user_id, task_id, type, title, message, reference_date)
    SELECT v_company, ta.user_id, p_task_id, 'due_date_changed', btrim(p_title),
      'O prazo da tarefa "' || btrim(p_title) || '" foi alterado' ||
        CASE WHEN p_due_date IS NOT NULL THEN ' para ' || to_char(p_due_date, 'DD/MM') ||
          CASE WHEN p_due_time IS NOT NULL THEN ' às ' || to_char(p_due_time, 'HH24:MI') ELSE '' END
        ELSE '' END || '.',
      v_new_reference
    FROM task_assignees ta WHERE ta.task_id = p_task_id AND ta.user_id <> v_uid;
  END IF;

  IF p_assignee_ids IS NOT NULL AND v_task.type = 'corporate' THEN
    IF array_length(p_assignee_ids, 1) IS NULL THEN RAISE EXCEPTION 'Selecione ao menos um responsável.'; END IF;
    SELECT count(*) INTO v_valid_count FROM profiles WHERE id = ANY(p_assignee_ids) AND company_id = v_company;
    IF v_valid_count <> array_length(p_assignee_ids, 1) THEN RAISE EXCEPTION 'Um ou mais responsáveis não pertencem a esta empresa.'; END IF;

    SELECT array_agg(u) INTO v_added FROM unnest(p_assignee_ids) AS u
      WHERE NOT EXISTS (SELECT 1 FROM task_assignees WHERE task_id = p_task_id AND user_id = u);
    SELECT array_agg(user_id) INTO v_removed FROM task_assignees
      WHERE task_id = p_task_id AND user_id <> ALL(p_assignee_ids);

    IF v_removed IS NOT NULL THEN
      DELETE FROM task_assignees WHERE task_id = p_task_id AND user_id = ANY(v_removed);
    END IF;
    IF v_added IS NOT NULL THEN
      INSERT INTO task_assignees (task_id, company_id, user_id, status, assigned_by)
      SELECT p_task_id, v_company, u, 'todo', v_uid FROM unnest(v_added) AS u;

      INSERT INTO task_notifications (company_id, user_id, task_id, type, title, message)
      SELECT v_company, u, p_task_id, 'assigned', btrim(p_title), 'Nova tarefa atribuída: ' || btrim(p_title)
      FROM unnest(v_added) AS u WHERE u <> v_uid;
    END IF;

    IF v_added IS NOT NULL OR v_removed IS NOT NULL THEN
      INSERT INTO task_activity_logs (task_id, company_id, user_id, action, details)
      VALUES (p_task_id, v_company, v_uid, 'reassigned', jsonb_build_object('added', v_added, 'removed', v_removed));
    END IF;
  END IF;
END;
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. task_log_comment — mesmo trigger de 070, mensagem com nome de quem comentou
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.task_log_comment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_title           text;
  v_commenter_name  text;
BEGIN
  SELECT title INTO v_title FROM tasks WHERE id = NEW.task_id;
  SELECT COALESCE(name, email, 'Alguém') INTO v_commenter_name FROM profiles WHERE id = NEW.user_id;

  INSERT INTO task_activity_logs (task_id, company_id, user_id, action, details)
  VALUES (NEW.task_id, NEW.company_id, NEW.user_id, 'commented', jsonb_build_object('comment_id', NEW.id));

  INSERT INTO task_notifications (company_id, user_id, task_id, type, title, message)
  SELECT NEW.company_id, participant, NEW.task_id, 'commented', v_title,
    COALESCE(v_commenter_name, 'Alguém') || ' comentou na tarefa "' || COALESCE(v_title, '') || '".'
  FROM (
    SELECT created_by AS participant FROM tasks WHERE id = NEW.task_id
    UNION
    SELECT user_id FROM task_assignees WHERE task_id = NEW.task_id
  ) participants
  WHERE participant <> NEW.user_id;

  RETURN NEW;
END;
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Cron — due_soon reescrito com title/reference_date; overdue é novo.
--    Dedup agora é por reference_date exato (não por janela de 24h), então
--    alterar o prazo (reference_date diferente) libera um aviso novo, e o
--    mesmo prazo nunca gera dois.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.task_generate_due_soon_notifications()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_now timestamptz := now();
BEGIN
  INSERT INTO task_notifications (company_id, user_id, task_id, type, title, message, reference_date)
  SELECT t.company_id, ta.user_id, t.id, 'due_soon', t.title,
    'O prazo da tarefa "' || t.title || '" vence em menos de 24 horas.',
    (t.due_date + COALESCE(t.due_time, '23:59:59'::time)) AT TIME ZONE 'utc'
  FROM tasks t
  JOIN task_assignees ta ON ta.task_id = t.id
  WHERE t.status NOT IN ('done', 'cancelled')
    AND ta.status <> 'done'
    AND t.due_date IS NOT NULL
    AND (t.due_date + COALESCE(t.due_time, '23:59:59'::time)) AT TIME ZONE 'utc' BETWEEN v_now AND v_now + interval '24 hours'
    AND NOT EXISTS (
      SELECT 1 FROM task_notifications n
      WHERE n.task_id = t.id AND n.user_id = ta.user_id AND n.type = 'due_soon'
        AND n.reference_date = (t.due_date + COALESCE(t.due_time, '23:59:59'::time)) AT TIME ZONE 'utc'
    );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.task_generate_overdue_notifications()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_now timestamptz := now();
BEGIN
  INSERT INTO task_notifications (company_id, user_id, task_id, type, title, message, reference_date)
  SELECT t.company_id, ta.user_id, t.id, 'overdue', t.title,
    'A tarefa "' || t.title || '" está atrasada.',
    (t.due_date + COALESCE(t.due_time, '23:59:59'::time)) AT TIME ZONE 'utc'
  FROM tasks t
  JOIN task_assignees ta ON ta.task_id = t.id
  WHERE t.status NOT IN ('done', 'cancelled')
    AND ta.status <> 'done'
    AND t.due_date IS NOT NULL
    AND (t.due_date + COALESCE(t.due_time, '23:59:59'::time)) AT TIME ZONE 'utc' < v_now
    AND NOT EXISTS (
      SELECT 1 FROM task_notifications n
      WHERE n.task_id = t.id AND n.user_id = ta.user_id AND n.type = 'overdue'
        AND n.reference_date = (t.due_date + COALESCE(t.due_time, '23:59:59'::time)) AT TIME ZONE 'utc'
    );
END;
$fn$;

REVOKE ALL ON FUNCTION public.task_generate_overdue_notifications() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('task-overdue-notifications')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'task-overdue-notifications');
    PERFORM cron.schedule('task-overdue-notifications', '0 * * * *',
      $cron$SELECT public.task_generate_overdue_notifications();$cron$);
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Realtime — task_notifications entra na publicação padrão do Supabase.
--    A RLS de 070 (user_id = auth.uid()) continua sendo a barreira real.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'task_notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.task_notifications;
  END IF;
END $$;
