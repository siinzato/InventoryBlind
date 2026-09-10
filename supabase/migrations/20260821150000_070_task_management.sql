/*
# Módulo de Tarefas ("Meu Trabalho") — tabelas, RLS e RPCs

## Modelo
- `tasks` — o registro principal. `type` = 'personal' (só o criador) ou
  'corporate' (criada por owner/admin/manager, atribuída a N usuários).
  `status` é um AGREGADO CACHEADO, nunca a fonte de verdade: é recalculado por
  trigger a partir de `task_assignees` sempre que um responsável muda de
  status (ver seção 6). Isso satisfaz o requisito de que o progresso
  compartilhado nunca dependa só de uma coluna em `tasks`.
- `task_assignees` — uma linha por (tarefa, responsável). Toda tarefa tem pelo
  menos uma linha aqui: pessoal = 1 linha (o próprio criador); corporativa = N
  linhas. `status`/`started_at`/`completed_at` são individuais — é aqui que
  vive o "quem já iniciou, quem concluiu".
- `task_checklist_items`, `task_comments`, `task_attachments`,
  `task_activity_logs`, `task_notifications` — satélites, todos com
  `company_id` próprio (nunca dependem de JOIN para isolamento de empresa).

## Por que RPC para quase tudo
`tasks` e `task_assignees` não têm policy de INSERT/UPDATE para `authenticated`
— só SELECT e (tasks) DELETE para o criador de tarefa pessoal. Toda escrita
estrutural passa por função SECURITY DEFINER que revalida papel, empresa,
tipo e responsável no servidor. Mesmo padrão já usado no motor de contagem
física (migrations 039/059): a tela só esconde botão, quem impede é a função.

## Por que uma função helper em vez de subquery cruzada direta
`tasks_select` precisa saber se o usuário é responsável (consulta
`task_assignees`) e `task_assignees_select` precisa saber se o usuário é
criador da tarefa (consulta `tasks`) — duas tabelas se referenciando uma à
outra dentro das próprias policies é exatamente a recursão de RLS já corrigida
na migration 010 ("replace recursive subqueries with... SECURITY DEFINER
functions that bypass RLS for inner lookups"). `task_is_visible_to_me()` é
STABLE SECURITY DEFINER: suas consultas internas ignoram RLS, então não há
ciclo, e o mesmo helper é reaproveitado nas policies de SELECT das 6 tabelas.

## Responsáveis e conteúdo estrutural
Responsável de tarefa corporativa nunca tem UPDATE direto em `tasks` nem em
`task_assignees` — só a RPC `task_set_my_status` (que só toca a própria linha
em `task_assignees`) e `task_toggle_checklist_item` (só `is_done`/
`completed_by`/`completed_at` do item, não a estrutura do checklist).

## Sem recorrência, sem service_role no cliente
Não implementado nesta versão, conforme pedido. Nenhuma função aqui usa
service_role — todas rodam como SECURITY DEFINER validando auth.uid() e
company_id explicitamente, o mesmo padrão de todo o restante do projeto.
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. tasks
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tasks (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  type                 text NOT NULL CHECK (type IN ('personal', 'corporate')),
  title                text NOT NULL,
  description          text,
  category             text,
  priority             text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  due_date             date,
  due_time             time,
  status               text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done', 'cancelled')),
  created_by           uuid NOT NULL REFERENCES auth.users(id),
  cancelled_at         timestamptz,
  cancelled_by         uuid REFERENCES auth.users(id),
  cancellation_reason  text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tasks_company_idx      ON tasks (company_id);
CREATE INDEX IF NOT EXISTS tasks_created_by_idx   ON tasks (created_by);
CREATE INDEX IF NOT EXISTS tasks_due_date_idx     ON tasks (company_id, due_date) WHERE status NOT IN ('done', 'cancelled');
CREATE INDEX IF NOT EXISTS tasks_company_status_idx ON tasks (company_id, status);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. task_assignees
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS task_assignees (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id       uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done')),
  assigned_at   timestamptz NOT NULL DEFAULT now(),
  assigned_by   uuid REFERENCES auth.users(id),
  started_at    timestamptz,
  completed_at  timestamptz,
  UNIQUE (task_id, user_id)
);

CREATE INDEX IF NOT EXISTS task_assignees_task_idx    ON task_assignees (task_id);
CREATE INDEX IF NOT EXISTS task_assignees_user_idx    ON task_assignees (user_id, status);
CREATE INDEX IF NOT EXISTS task_assignees_company_idx ON task_assignees (company_id);

ALTER TABLE task_assignees ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. task_checklist_items
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS task_checklist_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id       uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  label         text NOT NULL,
  is_done       boolean NOT NULL DEFAULT false,
  position      integer NOT NULL DEFAULT 0,
  completed_by  uuid REFERENCES auth.users(id),
  completed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_checklist_items_task_idx ON task_checklist_items (task_id, position);

ALTER TABLE task_checklist_items ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. task_comments
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS task_comments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id),
  body        text NOT NULL CHECK (btrim(body) <> ''),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_comments_task_idx ON task_comments (task_id, created_at);

ALTER TABLE task_comments ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. task_attachments
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS task_attachments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id       uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  uploaded_by   uuid NOT NULL REFERENCES auth.users(id),
  file_name     text NOT NULL,
  storage_path  text NOT NULL,
  file_size     bigint,
  mime_type     text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_attachments_task_idx ON task_attachments (task_id);

ALTER TABLE task_attachments ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. task_activity_logs — só escrita via RPC/trigger, nunca INSERT direto
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS task_activity_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES auth.users(id),
  action      text NOT NULL CHECK (action IN (
    'created', 'edited', 'assigned', 'reassigned', 'started', 'completed',
    'cancelled', 'commented', 'attachment_added'
  )),
  details     jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_activity_logs_task_idx ON task_activity_logs (task_id, created_at);

ALTER TABLE task_activity_logs ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. task_notifications — central simples, só o próprio usuário
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS task_notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  task_id     uuid REFERENCES tasks(id) ON DELETE CASCADE,
  type        text NOT NULL CHECK (type IN ('assigned', 'due_date_changed', 'commented', 'due_soon')),
  message     text NOT NULL,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_notifications_user_idx ON task_notifications (user_id, read_at, created_at DESC);

ALTER TABLE task_notifications ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Helper — visibilidade de tarefa (evita recursão de RLS entre tasks/task_assignees)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.task_is_visible_to_me(p_task_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM tasks t
    WHERE t.id = p_task_id
      AND t.company_id::text = get_my_company_id()
      AND (get_my_role() = ANY(ARRAY['owner', 'admin', 'manager']) OR t.created_by = auth.uid())
  )
  OR EXISTS (
    SELECT 1 FROM task_assignees ta
    JOIN tasks t2 ON t2.id = ta.task_id
    WHERE ta.task_id = p_task_id AND ta.user_id = auth.uid() AND t2.company_id::text = get_my_company_id()
  );
$$;

REVOKE ALL ON FUNCTION public.task_is_visible_to_me(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.task_is_visible_to_me(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Policies — tasks
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "tasks_select" ON tasks;
CREATE POLICY "tasks_select" ON tasks FOR SELECT TO authenticated
  USING (task_is_visible_to_me(id));

-- Sem policy de INSERT/UPDATE: toda escrita estrutural passa por task_create/
-- task_update/task_cancel (SECURITY DEFINER). Só a exclusão de tarefa PESSOAL
-- pelo próprio criador é liberada direto, por ser uma operação simples e sem
-- validação cruzada — igual ao restante da tarefa, é só dele.
DROP POLICY IF EXISTS "tasks_delete_own_personal" ON tasks;
CREATE POLICY "tasks_delete_own_personal" ON tasks FOR DELETE TO authenticated
  USING (company_id::text = get_my_company_id() AND type = 'personal' AND created_by = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Policies — task_assignees (sem INSERT/UPDATE/DELETE: só RPC)
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "task_assignees_select" ON task_assignees;
CREATE POLICY "task_assignees_select" ON task_assignees FOR SELECT TO authenticated
  USING (task_is_visible_to_me(task_id));

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. Policies — task_checklist_items
--     Leitura: quem vê a tarefa. Escrita estrutural (criar/renomear/excluir
--     item): criador (pessoal) ou gestão (corporativa) — marcar "concluído"
--     por um responsável comum passa pela RPC task_toggle_checklist_item.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "task_checklist_items_select" ON task_checklist_items;
CREATE POLICY "task_checklist_items_select" ON task_checklist_items FOR SELECT TO authenticated
  USING (task_is_visible_to_me(task_id));

DROP POLICY IF EXISTS "task_checklist_items_insert" ON task_checklist_items;
CREATE POLICY "task_checklist_items_insert" ON task_checklist_items FOR INSERT TO authenticated
  WITH CHECK (
    company_id::text = get_my_company_id()
    AND EXISTS (
      SELECT 1 FROM tasks t WHERE t.id = task_checklist_items.task_id
        AND (get_my_role() = ANY(ARRAY['owner', 'admin', 'manager']) OR t.created_by = auth.uid())
    )
  );

DROP POLICY IF EXISTS "task_checklist_items_update" ON task_checklist_items;
CREATE POLICY "task_checklist_items_update" ON task_checklist_items FOR UPDATE TO authenticated
  USING (
    company_id::text = get_my_company_id()
    AND EXISTS (
      SELECT 1 FROM tasks t WHERE t.id = task_checklist_items.task_id
        AND (get_my_role() = ANY(ARRAY['owner', 'admin', 'manager']) OR t.created_by = auth.uid())
    )
  );

DROP POLICY IF EXISTS "task_checklist_items_delete" ON task_checklist_items;
CREATE POLICY "task_checklist_items_delete" ON task_checklist_items FOR DELETE TO authenticated
  USING (
    company_id::text = get_my_company_id()
    AND EXISTS (
      SELECT 1 FROM tasks t WHERE t.id = task_checklist_items.task_id
        AND (get_my_role() = ANY(ARRAY['owner', 'admin', 'manager']) OR t.created_by = auth.uid())
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. Policies — task_comments (imutáveis: sem UPDATE/DELETE nesta versão)
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "task_comments_select" ON task_comments;
CREATE POLICY "task_comments_select" ON task_comments FOR SELECT TO authenticated
  USING (task_is_visible_to_me(task_id));

DROP POLICY IF EXISTS "task_comments_insert" ON task_comments;
CREATE POLICY "task_comments_insert" ON task_comments FOR INSERT TO authenticated
  WITH CHECK (company_id::text = get_my_company_id() AND user_id = auth.uid() AND task_is_visible_to_me(task_id));

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. Policies — task_attachments
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "task_attachments_select" ON task_attachments;
CREATE POLICY "task_attachments_select" ON task_attachments FOR SELECT TO authenticated
  USING (task_is_visible_to_me(task_id));

DROP POLICY IF EXISTS "task_attachments_insert" ON task_attachments;
CREATE POLICY "task_attachments_insert" ON task_attachments FOR INSERT TO authenticated
  WITH CHECK (company_id::text = get_my_company_id() AND uploaded_by = auth.uid() AND task_is_visible_to_me(task_id));

-- ─────────────────────────────────────────────────────────────────────────────
-- 14. Policies — task_activity_logs (só leitura para authenticated; escrita é
--     sempre via RPC/trigger SECURITY DEFINER, que ignora RLS)
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "task_activity_logs_select" ON task_activity_logs;
CREATE POLICY "task_activity_logs_select" ON task_activity_logs FOR SELECT TO authenticated
  USING (task_is_visible_to_me(task_id));

-- ─────────────────────────────────────────────────────────────────────────────
-- 15. Policies — task_notifications (cada usuário só vê/marca as próprias)
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "task_notifications_select" ON task_notifications;
CREATE POLICY "task_notifications_select" ON task_notifications FOR SELECT TO authenticated
  USING (company_id::text = get_my_company_id() AND user_id = auth.uid());

DROP POLICY IF EXISTS "task_notifications_update" ON task_notifications;
CREATE POLICY "task_notifications_update" ON task_notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- 16. Trigger — recalcula tasks.status a partir de task_assignees
--     "A fazer": nenhum responsável iniciou. "Em andamento": ao menos um
--     iniciou ou concluiu, mas não todos concluíram. "Concluída": todos
--     concluíram. "Cancelada" nunca é sobrescrita por aqui — só a RPC
--     task_cancel escreve esse status.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.task_assignees_recompute_status()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_task_id uuid := COALESCE(NEW.task_id, OLD.task_id);
  v_total integer;
  v_done integer;
  v_started integer;
  v_current_status text;
BEGIN
  SELECT status INTO v_current_status FROM tasks WHERE id = v_task_id;
  IF v_current_status = 'cancelled' THEN
    RETURN NULL;
  END IF;

  SELECT count(*), count(*) FILTER (WHERE status = 'done'), count(*) FILTER (WHERE status IN ('in_progress', 'done'))
    INTO v_total, v_done, v_started
    FROM task_assignees WHERE task_id = v_task_id;

  UPDATE tasks SET
    status = CASE
      WHEN v_total = 0 THEN 'todo'
      WHEN v_done = v_total THEN 'done'
      WHEN v_started > 0 THEN 'in_progress'
      ELSE 'todo'
    END,
    updated_at = now()
  WHERE id = v_task_id;

  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS task_assignees_recompute_status_trg ON task_assignees;
CREATE TRIGGER task_assignees_recompute_status_trg
  AFTER INSERT OR UPDATE OF status OR DELETE ON task_assignees
  FOR EACH ROW EXECUTE FUNCTION public.task_assignees_recompute_status();

-- ─────────────────────────────────────────────────────────────────────────────
-- 17. Triggers — log automático de comentário/anexo (não depende do client lembrar)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.task_log_comment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
BEGIN
  INSERT INTO task_activity_logs (task_id, company_id, user_id, action, details)
  VALUES (NEW.task_id, NEW.company_id, NEW.user_id, 'commented', jsonb_build_object('comment_id', NEW.id));

  INSERT INTO task_notifications (company_id, user_id, task_id, type, message)
  SELECT NEW.company_id, participant, NEW.task_id, 'commented',
    'Novo comentário em uma tarefa que você acompanha.'
  FROM (
    SELECT created_by AS participant FROM tasks WHERE id = NEW.task_id
    UNION
    SELECT user_id FROM task_assignees WHERE task_id = NEW.task_id
  ) participants
  WHERE participant <> NEW.user_id;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS task_comments_log_trg ON task_comments;
CREATE TRIGGER task_comments_log_trg AFTER INSERT ON task_comments
  FOR EACH ROW EXECUTE FUNCTION public.task_log_comment();

CREATE OR REPLACE FUNCTION public.task_log_attachment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
BEGIN
  INSERT INTO task_activity_logs (task_id, company_id, user_id, action, details)
  VALUES (NEW.task_id, NEW.company_id, NEW.uploaded_by, 'attachment_added', jsonb_build_object('file_name', NEW.file_name));
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS task_attachments_log_trg ON task_attachments;
CREATE TRIGGER task_attachments_log_trg AFTER INSERT ON task_attachments
  FOR EACH ROW EXECUTE FUNCTION public.task_log_attachment();

-- ─────────────────────────────────────────────────────────────────────────────
-- 18. RPC — task_create
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

    INSERT INTO task_notifications (company_id, user_id, task_id, type, message)
    SELECT v_company, u, v_task_id, 'assigned', 'Você recebeu uma nova tarefa: ' || btrim(p_title)
    FROM unnest(v_assignees) AS u WHERE u <> v_uid;
  END IF;

  RETURN v_task_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.task_create(text, text, text, text, text, date, time, uuid[], text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.task_create(text, text, text, text, text, date, time, uuid[], text[]) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 19. RPC — task_update (edição estrutural; p_assignee_ids = NULL não altera responsáveis)
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
    INSERT INTO task_notifications (company_id, user_id, task_id, type, message)
    SELECT v_company, ta.user_id, p_task_id, 'due_date_changed', 'O prazo da tarefa "' || btrim(p_title) || '" foi alterado.'
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

      INSERT INTO task_notifications (company_id, user_id, task_id, type, message)
      SELECT v_company, u, p_task_id, 'assigned', 'Você recebeu uma nova tarefa: ' || btrim(p_title)
      FROM unnest(v_added) AS u WHERE u <> v_uid;
    END IF;

    IF v_added IS NOT NULL OR v_removed IS NOT NULL THEN
      INSERT INTO task_activity_logs (task_id, company_id, user_id, action, details)
      VALUES (p_task_id, v_company, v_uid, 'reassigned', jsonb_build_object('added', v_added, 'removed', v_removed));
    END IF;
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.task_update(uuid, text, text, text, text, date, time, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.task_update(uuid, text, text, text, text, date, time, uuid[]) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 20. RPC — task_set_my_status (o próprio responsável inicia/conclui a própria linha)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.task_set_my_status(p_task_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_company        uuid := (get_my_company_id())::uuid;
  v_uid            uuid := auth.uid();
  v_task_status    text;
  v_task_company   uuid;
BEGIN
  IF p_status NOT IN ('todo', 'in_progress', 'done') THEN RAISE EXCEPTION 'Status inválido.'; END IF;

  SELECT status, company_id INTO v_task_status, v_task_company FROM tasks WHERE id = p_task_id;
  IF v_task_company IS NULL OR v_task_company <> v_company THEN RAISE EXCEPTION 'Tarefa não encontrada.'; END IF;
  IF v_task_status = 'cancelled' THEN RAISE EXCEPTION 'Esta tarefa foi cancelada.'; END IF;

  IF NOT EXISTS (SELECT 1 FROM task_assignees WHERE task_id = p_task_id AND user_id = v_uid) THEN
    RAISE EXCEPTION 'Você não é responsável por esta tarefa.';
  END IF;

  UPDATE task_assignees SET
    status = p_status,
    started_at = CASE WHEN p_status IN ('in_progress', 'done') AND started_at IS NULL THEN now() ELSE started_at END,
    completed_at = CASE WHEN p_status = 'done' THEN now() ELSE NULL END
  WHERE task_id = p_task_id AND user_id = v_uid;

  IF p_status IN ('in_progress', 'done') THEN
    INSERT INTO task_activity_logs (task_id, company_id, user_id, action, details)
    VALUES (p_task_id, v_company, v_uid, CASE WHEN p_status = 'done' THEN 'completed' ELSE 'started' END, '{}'::jsonb);
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.task_set_my_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.task_set_my_status(uuid, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 21. RPC — task_cancel (só gestão, só corporativa)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.task_cancel(p_task_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_company      uuid := (get_my_company_id())::uuid;
  v_role         text := get_my_role();
  v_uid          uuid := auth.uid();
  v_task_company uuid;
  v_task_type    text;
BEGIN
  IF v_role NOT IN ('owner', 'admin', 'manager') THEN RAISE EXCEPTION 'Somente gestores podem cancelar tarefas.'; END IF;

  SELECT company_id, type INTO v_task_company, v_task_type FROM tasks WHERE id = p_task_id;
  IF v_task_company IS NULL OR v_task_company <> v_company THEN RAISE EXCEPTION 'Tarefa não encontrada.'; END IF;
  IF v_task_type <> 'corporate' THEN RAISE EXCEPTION 'Somente tarefas corporativas podem ser canceladas — tarefas pessoais são excluídas pelo próprio criador.'; END IF;

  UPDATE tasks SET status = 'cancelled', cancelled_at = now(), cancelled_by = v_uid, cancellation_reason = p_reason, updated_at = now()
  WHERE id = p_task_id;

  INSERT INTO task_activity_logs (task_id, company_id, user_id, action, details)
  VALUES (p_task_id, v_company, v_uid, 'cancelled', jsonb_build_object('reason', p_reason));
END;
$fn$;

REVOKE ALL ON FUNCTION public.task_cancel(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.task_cancel(uuid, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 22. RPC — task_toggle_checklist_item (responsável marca item concluído)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.task_toggle_checklist_item(p_item_id uuid, p_is_done boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_company uuid := (get_my_company_id())::uuid;
  v_uid     uuid := auth.uid();
  v_task_id uuid;
BEGIN
  SELECT ci.task_id INTO v_task_id
  FROM task_checklist_items ci JOIN tasks t ON t.id = ci.task_id
  WHERE ci.id = p_item_id AND t.company_id = v_company;

  IF v_task_id IS NULL THEN RAISE EXCEPTION 'Item não encontrado.'; END IF;
  IF NOT task_is_visible_to_me(v_task_id) THEN RAISE EXCEPTION 'Sem acesso a esta tarefa.'; END IF;

  UPDATE task_checklist_items SET
    is_done = p_is_done,
    completed_by = CASE WHEN p_is_done THEN v_uid ELSE NULL END,
    completed_at = CASE WHEN p_is_done THEN now() ELSE NULL END
  WHERE id = p_item_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.task_toggle_checklist_item(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.task_toggle_checklist_item(uuid, boolean) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 23. Notificações de vencimento próximo — cron de hora em hora (pura SQL, sem
--     Edge Function/HTTP). Evita duplicar aviso: só gera de novo depois de 24h.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.task_generate_due_soon_notifications()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
BEGIN
  INSERT INTO task_notifications (company_id, user_id, task_id, type, message)
  SELECT t.company_id, ta.user_id, t.id, 'due_soon', 'A tarefa "' || t.title || '" vence em breve.'
  FROM tasks t
  JOIN task_assignees ta ON ta.task_id = t.id
  WHERE t.status NOT IN ('done', 'cancelled')
    AND ta.status <> 'done'
    AND t.due_date IS NOT NULL
    AND t.due_date BETWEEN (now() AT TIME ZONE 'utc')::date AND (now() AT TIME ZONE 'utc')::date + 1
    AND NOT EXISTS (
      SELECT 1 FROM task_notifications n
      WHERE n.task_id = t.id AND n.user_id = ta.user_id AND n.type = 'due_soon' AND n.created_at > now() - interval '24 hours'
    );
END;
$fn$;

REVOKE ALL ON FUNCTION public.task_generate_due_soon_notifications() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('task-due-soon-notifications')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'task-due-soon-notifications');
    PERFORM cron.schedule('task-due-soon-notifications', '0 * * * *',
      $cron$SELECT public.task_generate_due_soon_notifications();$cron$);
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 24. Storage — comprovantes/anexos (mesmo padrão de rca-evidence, 033/037:
--     bucket privado, isolado por pasta {company_id}, mime/tamanho já travados)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
VALUES ('task-attachments', 'task-attachments', false,
  ARRAY['image/png', 'image/jpeg', 'application/pdf'], 10485760)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "task_attachments_bucket_select" ON storage.objects;
CREATE POLICY "task_attachments_bucket_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'task-attachments' AND (storage.foldername(name))[1] = get_my_company_id());

DROP POLICY IF EXISTS "task_attachments_bucket_insert" ON storage.objects;
CREATE POLICY "task_attachments_bucket_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'task-attachments' AND (storage.foldername(name))[1] = get_my_company_id());
