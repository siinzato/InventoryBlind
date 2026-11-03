/*
# Meu Trabalho → Central de Execução Operacional Logística — Etapa 1: Fundação

Evolui o módulo de Tarefas já existente (070_task_management.sql +
071_task_notifications_channel.sql). Nada aqui é destrutivo: todo campo é
aditivo com default seguro, nenhuma coluna é renomeida, nenhum valor de enum
existente é removido. Tarefas já criadas continuam funcionando sem qualquer
backfill manual.

## Por que "pausado"/"bloqueado" vivem em task_assignees, não em tasks
Pausa e bloqueio são sempre a experiência de UM responsável (o operador que
está executando aquela parte). `task_assignees` já é "uma linha por
responsável" desde 070 — pausar/bloquear é só um novo valor de `status` ali,
igual a todo/in_progress/done já eram. O agregado em `tasks.status` continua
sendo cacheado pelo mesmo trigger, agora também enxergando pausado/bloqueado.
Isso evita bifurcar o modelo em "tarefa pessoal tem bloqueio, corporativa
tem outro mecanismo" — os dois usam exatamente a mesma coluna.

## Por que tempo é uma tabela de segmentos, não contadores incrementais
"Tempo ativo/pausado/bloqueado" somado a partir de um contador (`total_seconds
+= now() - last_change`) quebra sob concorrência (dois updates simultâneos
perdem incremento) e não é auditável. `task_time_segments` é append-only: cada
transição fecha o segmento aberto (`ended_at = now()`) e abre um novo. A
duração de cada tipo é sempre `sum(ended_at - started_at)` — sem contador para
divergir, e com histórico completo para auditoria.

## Por que task_templates é um catálogo global (sem company_id)
Os modelos operacionais (inventário cíclico, auditoria de endereço etc.) são
metadados de processo, não dados de uma empresa — mesmo texto/checklist para
todas. Fica somente-leitura para authenticated (sem policy de escrita: é
conteúdo do produto, mantido por migration, não por uma tela de administração
nesta etapa). Se no futuro uma empresa precisar customizar um modelo, a rota
natural é um `company_id` opcional aqui — não implementado agora porque não
foi pedido e adicionaria uma tela de administração fora do escopo desta etapa.

## Por que válida/reabertura ficam em tasks, não em task_assignees
Validação e reabertura são decisões sobre a TAREFA como um todo (a entrega
está correta? precisa refazer?), não sobre a participação individual — por
isso `task_validate`/`task_reopen` operam em `tasks.status`, nunca em
`task_assignees`. Reabrir uma tarefa compartilhada reseta a participação de
TODOS os responsáveis (a entrega inteira volta a ser trabalho pendente); é
uma escolha deliberada, documentada aqui, não um efeito colateral.
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. tasks — colunas novas (todas aditivas, com default seguro)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS template_key text,
  ADD COLUMN IF NOT EXISTS template_version integer,
  ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS area text,
  ADD COLUMN IF NOT EXISTS location_from text,
  ADD COLUMN IF NOT EXISTS location_to text,
  ADD COLUMN IF NOT EXISTS sku_or_line text,
  ADD COLUMN IF NOT EXISTS planned_quantity numeric,
  ADD COLUMN IF NOT EXISTS executed_quantity numeric,
  ADD COLUMN IF NOT EXISTS quantity_unit text,
  ADD COLUMN IF NOT EXISTS estimated_duration_minutes integer,
  ADD COLUMN IF NOT EXISTS requires_validation boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tool_key text,
  ADD COLUMN IF NOT EXISTS reopened_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS completion_note text,
  ADD COLUMN IF NOT EXISTS result jsonb NOT NULL DEFAULT '{}'::jsonb;

-- status: 'todo'/'in_progress'/'done'/'cancelled' já existiam — soma-se
-- 'paused'/'blocked'/'validated'. Nenhum valor antigo é removido.
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_status_check
  CHECK (status IN ('todo', 'in_progress', 'paused', 'blocked', 'done', 'validated', 'cancelled'));

CREATE INDEX IF NOT EXISTS tasks_template_key_idx ON tasks (template_key) WHERE template_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS tasks_area_idx ON tasks (company_id, area) WHERE area IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. task_assignees — colunas de bloqueio/pausa (por responsável)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE task_assignees
  ADD COLUMN IF NOT EXISTS block_reason text,
  ADD COLUMN IF NOT EXISTS block_note text,
  ADD COLUMN IF NOT EXISTS blocked_at timestamptz,
  ADD COLUMN IF NOT EXISTS blocked_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS expected_resolver_user_id uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS paused_at timestamptz;

ALTER TABLE task_assignees DROP CONSTRAINT IF EXISTS task_assignees_status_check;
ALTER TABLE task_assignees ADD CONSTRAINT task_assignees_status_check
  CHECK (status IN ('todo', 'in_progress', 'paused', 'blocked', 'done'));

ALTER TABLE task_assignees DROP CONSTRAINT IF EXISTS task_assignees_block_reason_check;
ALTER TABLE task_assignees ADD CONSTRAINT task_assignees_block_reason_check
  CHECK (block_reason IS NULL OR block_reason IN (
    'falta_estoque', 'produto_nao_localizado', 'divergencia_sistema', 'endereco_bloqueado',
    'material_avariado', 'equipamento_indisponivel', 'sistema_indisponivel', 'aguardando_decisao',
    'dependencia_outra_equipe', 'falta_informacao', 'outro'
  ));

CREATE INDEX IF NOT EXISTS task_assignees_block_reason_idx ON task_assignees (company_id, block_reason) WHERE block_reason IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. task_time_segments — append-only; tempo ativo/pausado/bloqueado real
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS task_time_segments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id       uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  assignee_id   uuid NOT NULL REFERENCES task_assignees(id) ON DELETE CASCADE,
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id),
  segment_type  text NOT NULL CHECK (segment_type IN ('active', 'paused', 'blocked')),
  started_at    timestamptz NOT NULL DEFAULT now(),
  ended_at      timestamptz
);

CREATE INDEX IF NOT EXISTS task_time_segments_assignee_idx ON task_time_segments (assignee_id, ended_at);
CREATE INDEX IF NOT EXISTS task_time_segments_task_idx ON task_time_segments (task_id);

ALTER TABLE task_time_segments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "task_time_segments_select" ON task_time_segments;
CREATE POLICY "task_time_segments_select" ON task_time_segments FOR SELECT TO authenticated
  USING (task_is_visible_to_me(task_id));

-- Sem INSERT/UPDATE para authenticated: só as RPCs de transição (via os
-- helpers internos abaixo) abrem/fecham segmento.

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. task_templates — catálogo global, somente leitura para o app
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS task_templates (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key                       text UNIQUE NOT NULL,
  name                      text NOT NULL,
  operation_type            text NOT NULL,
  version                   integer NOT NULL DEFAULT 1,
  is_active                 boolean NOT NULL DEFAULT true,
  default_priority          text NOT NULL DEFAULT 'medium' CHECK (default_priority IN ('low', 'medium', 'high', 'urgent')),
  default_duration_minutes  integer,
  requires_validation       boolean NOT NULL DEFAULT false,
  evidence_required         boolean NOT NULL DEFAULT false,
  checklist_template        jsonb NOT NULL DEFAULT '[]'::jsonb,
  payload_schema            jsonb NOT NULL DEFAULT '[]'::jsonb,
  allowed_block_reasons      text[],
  tool_key                  text,
  created_at                timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE task_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "task_templates_select" ON task_templates;
CREATE POLICY "task_templates_select" ON task_templates FOR SELECT TO authenticated USING (true);

INSERT INTO task_templates (key, name, operation_type, default_priority, default_duration_minutes, requires_validation, evidence_required, checklist_template, payload_schema, tool_key) VALUES
  ('cyclic_inventory', 'Inventário cíclico', 'inventory', 'medium', 45, true, false,
    '[]'::jsonb,
    '[{"key":"area","label":"Área","type":"text"},{"key":"location_from","label":"Endereço inicial","type":"text"},{"key":"location_to","label":"Endereço final","type":"text"},{"key":"sku_or_line","label":"SKU ou linha","type":"text"},{"key":"planned_quantity","label":"Quantidade de endereços","type":"number"}]'::jsonb,
    'full-manager'),
  ('address_audit', 'Auditoria de endereço', 'audit', 'medium', 20, true, true,
    '[]'::jsonb,
    '[{"key":"area","label":"Área","type":"text"},{"key":"location_from","label":"Endereço","type":"text"}]'::jsonb,
    null),
  ('replenishment', 'Reposição', 'replenishment', 'medium', 30, false, false,
    '[]'::jsonb,
    '[{"key":"area","label":"Área","type":"text"},{"key":"location_from","label":"Endereço de origem","type":"text"},{"key":"location_to","label":"Endereço de destino","type":"text"},{"key":"sku_or_line","label":"SKU ou linha","type":"text"},{"key":"planned_quantity","label":"Quantidade planejada","type":"number"}]'::jsonb,
    null),
  ('receiving', 'Recebimento', 'receiving', 'high', 60, true, true,
    '[]'::jsonb,
    '[{"key":"area","label":"Área/doca","type":"text"},{"key":"planned_quantity","label":"Quantidade esperada","type":"number"},{"key":"quantity_unit","label":"Unidade","type":"text"}]'::jsonb,
    'nfe-conference'),
  ('conference', 'Conferência', 'conference', 'high', 40, true, true,
    '[]'::jsonb,
    '[{"key":"area","label":"Área","type":"text"},{"key":"planned_quantity","label":"Quantidade a conferir","type":"number"}]'::jsonb,
    'nfe-conference'),
  ('pending_picking', 'Separação pendente', 'picking', 'high', 25, false, false,
    '[]'::jsonb,
    '[{"key":"area","label":"Área","type":"text"},{"key":"location_from","label":"Endereço inicial","type":"text"},{"key":"location_to","label":"Endereço final","type":"text"},{"key":"sku_or_line","label":"SKU ou linha","type":"text"}]'::jsonb,
    null),
  ('damage_handling', 'Tratamento de avaria', 'damage', 'high', 20, true, true,
    '[]'::jsonb,
    '[{"key":"area","label":"Área","type":"text"},{"key":"sku_or_line","label":"SKU ou linha","type":"text"},{"key":"planned_quantity","label":"Quantidade avariada","type":"number"}]'::jsonb,
    null),
  ('organization_5s', 'Organização/5S', 'organization', 'low', 30, false, true,
    '["Separar","Organizar","Limpar","Padronizar","Sustentar"]'::jsonb,
    '[{"key":"area","label":"Área","type":"text"}]'::jsonb,
    null),
  ('supply_count', 'Contagem de insumos', 'count', 'low', 20, false, false,
    '[]'::jsonb,
    '[{"key":"area","label":"Área","type":"text"},{"key":"sku_or_line","label":"Insumo","type":"text"},{"key":"planned_quantity","label":"Quantidade contada","type":"number"},{"key":"quantity_unit","label":"Unidade","type":"text"}]'::jsonb,
    null),
  ('equipment_check', 'Verificação de equipamentos', 'maintenance', 'medium', 15, false, false,
    '[]'::jsonb,
    '[{"key":"area","label":"Área","type":"text"}]'::jsonb,
    null),
  ('divergence_handling', 'Tratamento de divergência', 'divergence', 'high', 30, true, true,
    '[]'::jsonb,
    '[{"key":"area","label":"Área","type":"text"},{"key":"sku_or_line","label":"SKU ou linha","type":"text"},{"key":"planned_quantity","label":"Quantidade divergente","type":"number"}]'::jsonb,
    'spreadsheet-comparator'),
  ('shift_closing', 'Fechamento de turno', 'shift', 'medium', 15, true, false,
    '["Conferir pendências","Repassar bloqueios em aberto","Registrar observações do turno"]'::jsonb,
    '[{"key":"area","label":"Área","type":"text"}]'::jsonb,
    null),
  ('generic', 'Tarefa genérica', 'generic', 'medium', null, false, false,
    '[]'::jsonb, '[]'::jsonb, null)
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. task_module_settings — preferências por empresa (mesmo formato de
--    rca_settings: uma linha por empresa, upsert via RPC)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS task_module_settings (
  company_id                    uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  due_soon_threshold_minutes    integer NOT NULL DEFAULT 120 CHECK (due_soon_threshold_minutes > 0),
  pause_note_required           boolean NOT NULL DEFAULT false,
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  updated_by                    uuid REFERENCES auth.users(id)
);

ALTER TABLE task_module_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "task_module_settings_select" ON task_module_settings;
CREATE POLICY "task_module_settings_select" ON task_module_settings FOR SELECT TO authenticated
  USING (company_id::text = get_my_company_id());

-- Sem INSERT/UPDATE direto — task_module_settings_upsert valida o papel.

CREATE OR REPLACE FUNCTION public.task_module_settings_upsert(p_due_soon_threshold_minutes integer, p_pause_note_required boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_company uuid := (get_my_company_id())::uuid;
  v_role    text := get_my_role();
BEGIN
  IF v_role NOT IN ('owner', 'admin', 'manager') THEN RAISE EXCEPTION 'Somente gestores podem alterar estas preferências.'; END IF;
  IF p_due_soon_threshold_minutes IS NULL OR p_due_soon_threshold_minutes <= 0 THEN RAISE EXCEPTION 'Limite inválido.'; END IF;

  INSERT INTO task_module_settings (company_id, due_soon_threshold_minutes, pause_note_required, updated_by)
  VALUES (v_company, p_due_soon_threshold_minutes, p_pause_note_required, auth.uid())
  ON CONFLICT (company_id) DO UPDATE SET
    due_soon_threshold_minutes = EXCLUDED.due_soon_threshold_minutes,
    pause_note_required = EXCLUDED.pause_note_required,
    updated_at = now(), updated_by = EXCLUDED.updated_by;
END;
$fn$;

REVOKE ALL ON FUNCTION public.task_module_settings_upsert(integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.task_module_settings_upsert(integer, boolean) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Histórico/notificações — novos valores (aditivos)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE task_activity_logs DROP CONSTRAINT IF EXISTS task_activity_logs_action_check;
ALTER TABLE task_activity_logs ADD CONSTRAINT task_activity_logs_action_check
  CHECK (action IN (
    'created', 'edited', 'assigned', 'reassigned', 'started', 'completed',
    'cancelled', 'commented', 'attachment_added',
    'paused', 'resumed', 'blocked', 'unblocked', 'validated', 'reopened', 'priority_changed', 'due_date_changed'
  ));

ALTER TABLE task_notifications DROP CONSTRAINT IF EXISTS task_notifications_type_check;
ALTER TABLE task_notifications ADD CONSTRAINT task_notifications_type_check
  CHECK (type IN (
    'assigned', 'due_date_changed', 'commented', 'due_soon', 'overdue',
    'blocked', 'unblocked', 'validation_pending', 'reopened'
  ));

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Helpers internos de segmento de tempo — nunca expostos via REST
--    (chamados só de dentro de outra função SECURITY DEFINER deste módulo).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.task_close_open_time_segment(p_assignee_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
BEGIN
  UPDATE task_time_segments SET ended_at = now()
  WHERE assignee_id = p_assignee_id AND ended_at IS NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.task_close_open_time_segment(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.task_open_time_segment(p_assignee_id uuid, p_task_id uuid, p_company_id uuid, p_user_id uuid, p_segment_type text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
BEGIN
  INSERT INTO task_time_segments (task_id, assignee_id, company_id, user_id, segment_type)
  VALUES (p_task_id, p_assignee_id, p_company_id, p_user_id, p_segment_type);
END;
$fn$;

REVOKE ALL ON FUNCTION public.task_open_time_segment(uuid, uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Trigger de agregação — estende para pausado/bloqueado; nunca sobrescreve
--    'cancelled' NEM 'validated' (a validação é uma decisão deliberada da
--    liderança sobre a entrega, não um cálculo derivado dos responsáveis).
--    Prioridade do agregado: bloqueada > pausada > em execução > a fazer;
--    concluída só quando TODOS concluíram.
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
  v_blocked integer;
  v_paused integer;
  v_current_status text;
BEGIN
  SELECT status INTO v_current_status FROM tasks WHERE id = v_task_id;
  IF v_current_status IN ('cancelled', 'validated') THEN
    RETURN NULL;
  END IF;

  SELECT
    count(*),
    count(*) FILTER (WHERE status = 'done'),
    count(*) FILTER (WHERE status IN ('in_progress', 'paused', 'blocked', 'done')),
    count(*) FILTER (WHERE status = 'blocked'),
    count(*) FILTER (WHERE status = 'paused')
    INTO v_total, v_done, v_started, v_blocked, v_paused
    FROM task_assignees WHERE task_id = v_task_id;

  UPDATE tasks SET
    status = CASE
      WHEN v_total = 0 THEN 'todo'
      WHEN v_done = v_total THEN 'done'
      WHEN v_blocked > 0 THEN 'blocked'
      WHEN v_paused > 0 THEN 'paused'
      WHEN v_started > 0 THEN 'in_progress'
      ELSE 'todo'
    END,
    updated_at = now()
  WHERE id = v_task_id;

  RETURN NULL;
END;
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. task_set_my_status — mesmo contrato de 070, agora recusa transição a
--    partir de pausada/bloqueada (tem que retomar/desbloquear primeiro) e
--    abre/fecha o segmento de tempo 'active' nas bordas todo↔in_progress↔done.
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
  v_assignee_id    uuid;
  v_current_status text;
BEGIN
  IF p_status NOT IN ('todo', 'in_progress', 'done') THEN RAISE EXCEPTION 'Status inválido.'; END IF;

  SELECT status, company_id INTO v_task_status, v_task_company FROM tasks WHERE id = p_task_id;
  IF v_task_company IS NULL OR v_task_company <> v_company THEN RAISE EXCEPTION 'Tarefa não encontrada.'; END IF;
  IF v_task_status IN ('cancelled', 'validated') THEN RAISE EXCEPTION 'Esta tarefa não pode ser alterada.'; END IF;

  SELECT id, status INTO v_assignee_id, v_current_status FROM task_assignees WHERE task_id = p_task_id AND user_id = v_uid;
  IF v_assignee_id IS NULL THEN RAISE EXCEPTION 'Você não é responsável por esta tarefa.'; END IF;
  IF v_current_status IN ('paused', 'blocked') THEN
    RAISE EXCEPTION 'Continue ou desbloqueie a tarefa antes de alterar o status.';
  END IF;

  UPDATE task_assignees SET
    status = p_status,
    started_at = CASE WHEN p_status IN ('in_progress', 'done') AND started_at IS NULL THEN now() ELSE started_at END,
    completed_at = CASE WHEN p_status = 'done' THEN now() ELSE NULL END
  WHERE id = v_assignee_id;

  IF p_status = 'in_progress' AND v_current_status = 'todo' THEN
    PERFORM task_open_time_segment(v_assignee_id, p_task_id, v_company, v_uid, 'active');
  ELSIF p_status = 'done' THEN
    PERFORM task_close_open_time_segment(v_assignee_id);
  ELSIF p_status = 'todo' AND v_current_status = 'in_progress' THEN
    PERFORM task_close_open_time_segment(v_assignee_id);
  END IF;

  IF p_status IN ('in_progress', 'done') THEN
    INSERT INTO task_activity_logs (task_id, company_id, user_id, action, details)
    VALUES (p_task_id, v_company, v_uid, CASE WHEN p_status = 'done' THEN 'completed' ELSE 'started' END, '{}'::jsonb);
  END IF;
END;
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. task_pause_my_status / task_resume_my_status — só a própria participação
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.task_pause_my_status(p_task_id uuid, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_company        uuid := (get_my_company_id())::uuid;
  v_uid            uuid := auth.uid();
  v_task_status    text;
  v_task_company   uuid;
  v_assignee_id    uuid;
  v_current_status text;
  v_note_required  boolean;
BEGIN
  SELECT status, company_id INTO v_task_status, v_task_company FROM tasks WHERE id = p_task_id;
  IF v_task_company IS NULL OR v_task_company <> v_company THEN RAISE EXCEPTION 'Tarefa não encontrada.'; END IF;
  IF v_task_status IN ('cancelled', 'validated') THEN RAISE EXCEPTION 'Esta tarefa não pode ser pausada.'; END IF;

  SELECT id, status INTO v_assignee_id, v_current_status FROM task_assignees WHERE task_id = p_task_id AND user_id = v_uid;
  IF v_assignee_id IS NULL THEN RAISE EXCEPTION 'Você não é responsável por esta tarefa.'; END IF;
  IF v_current_status <> 'in_progress' THEN RAISE EXCEPTION 'Só é possível pausar uma tarefa em execução.'; END IF;

  SELECT pause_note_required INTO v_note_required FROM task_module_settings WHERE company_id = v_company;
  IF COALESCE(v_note_required, false) AND (p_note IS NULL OR btrim(p_note) = '') THEN
    RAISE EXCEPTION 'Informe o motivo da pausa.';
  END IF;

  PERFORM task_close_open_time_segment(v_assignee_id);
  PERFORM task_open_time_segment(v_assignee_id, p_task_id, v_company, v_uid, 'paused');

  UPDATE task_assignees SET status = 'paused', paused_at = now() WHERE id = v_assignee_id;

  INSERT INTO task_activity_logs (task_id, company_id, user_id, action, details)
  VALUES (p_task_id, v_company, v_uid, 'paused', jsonb_build_object('note', p_note));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.task_resume_my_status(p_task_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_company        uuid := (get_my_company_id())::uuid;
  v_uid            uuid := auth.uid();
  v_task_company   uuid;
  v_assignee_id    uuid;
  v_current_status text;
BEGIN
  SELECT company_id INTO v_task_company FROM tasks WHERE id = p_task_id;
  IF v_task_company IS NULL OR v_task_company <> v_company THEN RAISE EXCEPTION 'Tarefa não encontrada.'; END IF;

  SELECT id, status INTO v_assignee_id, v_current_status FROM task_assignees WHERE task_id = p_task_id AND user_id = v_uid;
  IF v_assignee_id IS NULL THEN RAISE EXCEPTION 'Você não é responsável por esta tarefa.'; END IF;
  IF v_current_status <> 'paused' THEN RAISE EXCEPTION 'Esta tarefa não está pausada.'; END IF;

  PERFORM task_close_open_time_segment(v_assignee_id);
  PERFORM task_open_time_segment(v_assignee_id, p_task_id, v_company, v_uid, 'active');

  UPDATE task_assignees SET status = 'in_progress', paused_at = NULL WHERE id = v_assignee_id;

  INSERT INTO task_activity_logs (task_id, company_id, user_id, action, details)
  VALUES (p_task_id, v_company, v_uid, 'resumed', '{}'::jsonb);
END;
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. task_block_my_status (só a própria participação) / task_unblock_status
--     (a própria OU a gestão, para o "Desbloquear" do painel de exceções)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.task_block_my_status(p_task_id uuid, p_reason text, p_note text DEFAULT NULL, p_expected_resolver uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_company        uuid := (get_my_company_id())::uuid;
  v_uid            uuid := auth.uid();
  v_task_status    text;
  v_task_company   uuid;
  v_assignee_id    uuid;
  v_current_status text;
BEGIN
  IF p_reason NOT IN (
    'falta_estoque', 'produto_nao_localizado', 'divergencia_sistema', 'endereco_bloqueado',
    'material_avariado', 'equipamento_indisponivel', 'sistema_indisponivel', 'aguardando_decisao',
    'dependencia_outra_equipe', 'falta_informacao', 'outro'
  ) THEN
    RAISE EXCEPTION 'Motivo de bloqueio inválido.';
  END IF;
  IF p_reason = 'outro' AND (p_note IS NULL OR btrim(p_note) = '') THEN
    RAISE EXCEPTION 'Descreva o motivo ao selecionar "Outro".';
  END IF;

  SELECT status, company_id INTO v_task_status, v_task_company FROM tasks WHERE id = p_task_id;
  IF v_task_company IS NULL OR v_task_company <> v_company THEN RAISE EXCEPTION 'Tarefa não encontrada.'; END IF;
  IF v_task_status IN ('cancelled', 'validated') THEN RAISE EXCEPTION 'Esta tarefa não pode ser bloqueada.'; END IF;

  SELECT id, status INTO v_assignee_id, v_current_status FROM task_assignees WHERE task_id = p_task_id AND user_id = v_uid;
  IF v_assignee_id IS NULL THEN RAISE EXCEPTION 'Você não é responsável por esta tarefa.'; END IF;
  IF v_current_status = 'blocked' THEN RAISE EXCEPTION 'Esta tarefa já está bloqueada.'; END IF;
  IF v_current_status = 'done' THEN RAISE EXCEPTION 'Tarefa já concluída não pode ser bloqueada.'; END IF;
  IF p_expected_resolver IS NOT NULL AND NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_expected_resolver AND company_id = v_company) THEN
    RAISE EXCEPTION 'Responsável esperado não pertence a esta empresa.';
  END IF;

  PERFORM task_close_open_time_segment(v_assignee_id);
  PERFORM task_open_time_segment(v_assignee_id, p_task_id, v_company, v_uid, 'blocked');

  UPDATE task_assignees SET
    status = 'blocked', block_reason = p_reason, block_note = p_note,
    blocked_at = now(), blocked_by = v_uid, expected_resolver_user_id = p_expected_resolver
  WHERE id = v_assignee_id;

  INSERT INTO task_activity_logs (task_id, company_id, user_id, action, details)
  VALUES (p_task_id, v_company, v_uid, 'blocked', jsonb_build_object('reason', p_reason, 'note', p_note));

  INSERT INTO task_notifications (company_id, user_id, task_id, type, title, message)
  SELECT v_company, p.id, p_task_id, 'blocked', t.title, 'Tarefa bloqueada: ' || t.title
  FROM profiles p, (SELECT title FROM tasks WHERE id = p_task_id) t
  WHERE p.company_id = v_company AND p.role IN ('owner', 'admin', 'manager') AND p.id <> v_uid;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.task_unblock_status(p_task_id uuid, p_user_id uuid DEFAULT NULL, p_resume boolean DEFAULT true)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_company        uuid := (get_my_company_id())::uuid;
  v_role           text := get_my_role();
  v_uid            uuid := auth.uid();
  v_target         uuid := COALESCE(p_user_id, v_uid);
  v_task_company   uuid;
  v_assignee_id    uuid;
  v_current_status text;
  v_new_status     text := CASE WHEN p_resume THEN 'in_progress' ELSE 'todo' END;
BEGIN
  IF p_user_id IS NOT NULL AND p_user_id <> v_uid AND v_role NOT IN ('owner', 'admin', 'manager') THEN
    RAISE EXCEPTION 'Somente gestores podem desbloquear a tarefa de outro responsável.';
  END IF;

  SELECT company_id INTO v_task_company FROM tasks WHERE id = p_task_id;
  IF v_task_company IS NULL OR v_task_company <> v_company THEN RAISE EXCEPTION 'Tarefa não encontrada.'; END IF;

  SELECT id, status INTO v_assignee_id, v_current_status FROM task_assignees WHERE task_id = p_task_id AND user_id = v_target;
  IF v_assignee_id IS NULL THEN RAISE EXCEPTION 'Responsável não encontrado nesta tarefa.'; END IF;
  IF v_current_status <> 'blocked' THEN RAISE EXCEPTION 'Esta tarefa não está bloqueada.'; END IF;

  PERFORM task_close_open_time_segment(v_assignee_id);
  IF v_new_status = 'in_progress' THEN
    PERFORM task_open_time_segment(v_assignee_id, p_task_id, v_company, v_target, 'active');
  END IF;

  UPDATE task_assignees SET
    status = v_new_status, block_reason = NULL, block_note = NULL, blocked_at = NULL, blocked_by = NULL, expected_resolver_user_id = NULL
  WHERE id = v_assignee_id;

  INSERT INTO task_activity_logs (task_id, company_id, user_id, action, details)
  VALUES (p_task_id, v_company, v_uid, 'unblocked', jsonb_build_object('target_user', v_target, 'resumed', p_resume));

  INSERT INTO task_notifications (company_id, user_id, task_id, type, title, message)
  SELECT v_company, p.id, p_task_id, 'unblocked', t.title, 'Bloqueio resolvido: ' || t.title
  FROM profiles p, (SELECT title FROM tasks WHERE id = p_task_id) t
  WHERE p.company_id = v_company AND (p.role IN ('owner', 'admin', 'manager') OR p.id = v_target) AND p.id <> v_uid;
END;
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. task_validate / task_reopen — decisão da liderança sobre a entrega
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.task_validate(p_task_id uuid, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_company uuid := (get_my_company_id())::uuid;
  v_role    text := get_my_role();
  v_uid     uuid := auth.uid();
  v_task    tasks%ROWTYPE;
BEGIN
  IF v_role NOT IN ('owner', 'admin', 'manager') THEN RAISE EXCEPTION 'Somente gestores podem validar tarefas.'; END IF;

  SELECT * INTO v_task FROM tasks WHERE id = p_task_id AND company_id = v_company;
  IF v_task.id IS NULL THEN RAISE EXCEPTION 'Tarefa não encontrada.'; END IF;
  IF NOT v_task.requires_validation THEN RAISE EXCEPTION 'Esta tarefa não exige validação.'; END IF;
  IF v_task.status <> 'done' THEN RAISE EXCEPTION 'Só é possível validar uma tarefa concluída.'; END IF;

  UPDATE tasks SET status = 'validated', updated_at = now() WHERE id = p_task_id;

  INSERT INTO task_activity_logs (task_id, company_id, user_id, action, details)
  VALUES (p_task_id, v_company, v_uid, 'validated', jsonb_build_object('note', p_note));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.task_reopen(p_task_id uuid, p_reason text, p_target_status text DEFAULT 'todo')
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_company uuid := (get_my_company_id())::uuid;
  v_role    text := get_my_role();
  v_uid     uuid := auth.uid();
  v_task    tasks%ROWTYPE;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'Informe o motivo da reabertura.'; END IF;
  IF p_target_status NOT IN ('todo', 'in_progress') THEN RAISE EXCEPTION 'Estado de destino inválido.'; END IF;

  SELECT * INTO v_task FROM tasks WHERE id = p_task_id AND company_id = v_company;
  IF v_task.id IS NULL THEN RAISE EXCEPTION 'Tarefa não encontrada.'; END IF;
  IF v_task.status NOT IN ('done', 'validated') THEN RAISE EXCEPTION 'Só tarefas concluídas ou validadas podem ser reabertas.'; END IF;

  IF v_task.type = 'personal' THEN
    IF v_task.created_by <> v_uid THEN RAISE EXCEPTION 'Somente o criador pode reabrir esta tarefa pessoal.'; END IF;
  ELSE
    IF v_role NOT IN ('owner', 'admin', 'manager') THEN RAISE EXCEPTION 'Somente gestores podem reabrir tarefas corporativas.'; END IF;
  END IF;

  UPDATE tasks SET status = p_target_status, reopened_count = reopened_count + 1, updated_at = now() WHERE id = p_task_id;

  UPDATE task_assignees SET
    status = p_target_status,
    completed_at = NULL,
    started_at = CASE WHEN p_target_status = 'in_progress' AND started_at IS NULL THEN now() ELSE started_at END
  WHERE task_id = p_task_id;

  INSERT INTO task_activity_logs (task_id, company_id, user_id, action, details)
  VALUES (p_task_id, v_company, v_uid, 'reopened', jsonb_build_object('reason', p_reason, 'target_status', p_target_status));

  INSERT INTO task_notifications (company_id, user_id, task_id, type, title, message)
  SELECT v_company, ta.user_id, p_task_id, 'reopened', v_task.title, 'A tarefa "' || v_task.title || '" foi reaberta.'
  FROM task_assignees ta WHERE ta.task_id = p_task_id AND ta.user_id <> v_uid;
END;
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. task_set_priority — edição pontual, mesmo gate de task_update
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.task_set_priority(p_task_id uuid, p_priority text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_company     uuid := (get_my_company_id())::uuid;
  v_role        text := get_my_role();
  v_uid         uuid := auth.uid();
  v_task        tasks%ROWTYPE;
  v_old_priority text;
BEGIN
  IF p_priority NOT IN ('low', 'medium', 'high', 'urgent') THEN RAISE EXCEPTION 'Prioridade inválida.'; END IF;

  SELECT * INTO v_task FROM tasks WHERE id = p_task_id AND company_id = v_company;
  IF v_task.id IS NULL THEN RAISE EXCEPTION 'Tarefa não encontrada.'; END IF;
  IF v_task.status IN ('cancelled', 'validated') THEN RAISE EXCEPTION 'Esta tarefa não pode ser alterada.'; END IF;

  IF v_task.type = 'personal' THEN
    IF v_task.created_by <> v_uid THEN RAISE EXCEPTION 'Somente o criador pode alterar esta tarefa pessoal.'; END IF;
  ELSE
    IF v_role NOT IN ('owner', 'admin', 'manager') THEN RAISE EXCEPTION 'Somente gestores podem alterar a prioridade de tarefas corporativas.'; END IF;
  END IF;

  v_old_priority := v_task.priority;
  UPDATE tasks SET priority = p_priority, updated_at = now() WHERE id = p_task_id;

  INSERT INTO task_activity_logs (task_id, company_id, user_id, action, details)
  VALUES (p_task_id, v_company, v_uid, 'priority_changed', jsonb_build_object('from', v_old_priority, 'to', p_priority));
END;
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 14. task_bulk_assign — Equipe: distribuir várias tarefas para vários
--     responsáveis de uma vez (mesma validação de empresa de task_create)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.task_bulk_assign(p_task_ids uuid[], p_assignee_ids uuid[])
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_company     uuid := (get_my_company_id())::uuid;
  v_role        text := get_my_role();
  v_uid         uuid := auth.uid();
  v_valid_count integer;
  v_task_id     uuid;
  v_added       uuid[];
BEGIN
  IF v_role NOT IN ('owner', 'admin', 'manager') THEN RAISE EXCEPTION 'Somente gestores podem distribuir tarefas em lote.'; END IF;
  IF p_task_ids IS NULL OR array_length(p_task_ids, 1) IS NULL THEN RAISE EXCEPTION 'Selecione ao menos uma tarefa.'; END IF;
  IF p_assignee_ids IS NULL OR array_length(p_assignee_ids, 1) IS NULL THEN RAISE EXCEPTION 'Selecione ao menos um responsável.'; END IF;

  SELECT count(*) INTO v_valid_count FROM profiles WHERE id = ANY(p_assignee_ids) AND company_id = v_company;
  IF v_valid_count <> array_length(p_assignee_ids, 1) THEN RAISE EXCEPTION 'Um ou mais responsáveis não pertencem a esta empresa.'; END IF;

  SELECT count(*) INTO v_valid_count FROM tasks
    WHERE id = ANY(p_task_ids) AND company_id = v_company AND type = 'corporate' AND status NOT IN ('cancelled', 'validated');
  IF v_valid_count <> array_length(p_task_ids, 1) THEN RAISE EXCEPTION 'Uma ou mais tarefas não podem receber novos responsáveis.'; END IF;

  FOREACH v_task_id IN ARRAY p_task_ids LOOP
    SELECT array_agg(u) INTO v_added FROM unnest(p_assignee_ids) AS u
      WHERE NOT EXISTS (SELECT 1 FROM task_assignees WHERE task_id = v_task_id AND user_id = u);

    IF v_added IS NOT NULL THEN
      INSERT INTO task_assignees (task_id, company_id, user_id, status, assigned_by)
      SELECT v_task_id, v_company, u, 'todo', v_uid FROM unnest(v_added) AS u;

      INSERT INTO task_notifications (company_id, user_id, task_id, type, title, message)
      SELECT v_company, u, v_task_id, 'assigned', t.title, 'Nova tarefa atribuída: ' || t.title
      FROM unnest(v_added) AS u, (SELECT title FROM tasks WHERE id = v_task_id) t
      WHERE u <> v_uid;

      INSERT INTO task_activity_logs (task_id, company_id, user_id, action, details)
      SELECT v_task_id, v_company, v_uid, 'assigned', jsonb_build_object('assignee', u) FROM unnest(v_added) AS u;
    END IF;
  END LOOP;
END;
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 15. Grants — mesmo padrão do módulo: só authenticated, nunca anon/service_role
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.task_pause_my_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.task_pause_my_status(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.task_resume_my_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.task_resume_my_status(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.task_block_my_status(uuid, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.task_block_my_status(uuid, text, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.task_unblock_status(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.task_unblock_status(uuid, uuid, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.task_validate(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.task_validate(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.task_reopen(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.task_reopen(uuid, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.task_set_priority(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.task_set_priority(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.task_bulk_assign(uuid[], uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.task_bulk_assign(uuid[], uuid[]) TO authenticated;
