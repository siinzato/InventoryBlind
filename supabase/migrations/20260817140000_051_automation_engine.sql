-- ─────────────────────────────────────────────────────────────────────────────
-- 051 — Automation Engine
--
-- Trigger → Condições → Ações, definido como DADO e interpretado por um motor.
-- Nenhuma automação é código: o usuário compõe blocos e o engine executa.
--
-- ── A decisão que mais importa: como os módulos emitem eventos ──────────────
-- Por TRIGGER de banco nas tabelas que já existem. Nenhuma função, RPC ou
-- arquivo dos módulos atuais é alterado — physical_count_items e
-- physical_count_sessions passam a emitir eventos sem saber que o engine existe.
--
-- A alternativa seria editar pc_register_count / pc_finalize_session para chamar
-- o engine. Rejeitada: são o caminho crítico da contagem, já foram substituídas
-- duas vezes (041 e 049), e acoplar automação a elas significa que um defeito no
-- engine pode impedir alguém de contar estoque.
--
-- ── Fila, não execução inline ───────────────────────────────────────────────
-- O trigger só INSERE em automation_events. Não avalia condição, não executa
-- ação, não chama HTTP. Custo de uma inserção, dentro da transação da contagem.
-- Assim uma automação mal configurada não tem como derrubar o fluxo que a
-- originou — que é o requisito de desacoplamento.
--
-- O consumo é feito pela Edge Function `automation-run`. pg_net não está
-- instalado neste projeto, então o cron não consegue chamar HTTP; a função é
-- invocada pelo cliente autenticado. Eventos não processados permanecem
-- pendentes e são consumidos na próxima passagem — nada se perde, só atrasa.
--
-- ── Grafo em JSON, e por quê ────────────────────────────────────────────────
-- `workflow` guarda nodes e edges como jsonb em vez de duas tabelas. Tipos de
-- node vão crescer (delay, switch, loop, agent), e cada um traria colunas novas
-- ou uma tabela de parâmetros genérica. O grafo é lido inteiro sempre e nunca
-- consultado por dentro, então normalizar não daria nada em troca. A validação
-- estrutural fica no TypeScript (workflow.ts), onde é testável.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. automations
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS automations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL DEFAULT get_my_company_id()::uuid
    REFERENCES companies(id) ON DELETE CASCADE,

  name text NOT NULL CHECK (length(btrim(name)) > 0),
  description text,

  -- draft nasce como padrão: uma automação recém-criada não age até passar pela
  -- validação e ser ativada. É o que impede uma configuração pela metade de
  -- executar (§32 do briefing).
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'inactive', 'error')),

  -- Duplicado do workflow de propósito. É a chave de busca quando um evento
  -- chega: o engine precisa achar automações por (empresa, trigger, ativo) sem
  -- abrir o jsonb de cada uma. Mantido em sincronia pelo trigger abaixo.
  trigger_type text NOT NULL,

  -- { nodes: [...], edges: [...] }. Forma validada em TypeScript; aqui só o
  -- mínimo que impede lixo entrar.
  workflow jsonb NOT NULL DEFAULT '{"nodes":[],"edges":[]}'::jsonb
    CHECK (jsonb_typeof(workflow -> 'nodes') = 'array' AND jsonb_typeof(workflow -> 'edges') = 'array'),

  -- Incrementada a cada gravação do workflow. Serve para uma execução registrar
  -- contra qual versão rodou — sem isso, um log antigo aponta para um grafo que
  -- já não existe e fica impossível de interpretar.
  version integer NOT NULL DEFAULT 1,

  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_executed_at timestamptz,
  execution_count integer NOT NULL DEFAULT 0
);

-- O índice que o engine usa a cada evento (§39: filtrar por tenant + trigger +
-- ativo, nunca varrer todas). Parcial porque só automações ativas são candidatas.
CREATE INDEX IF NOT EXISTS automations_dispatch_idx
  ON automations (company_id, trigger_type)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS automations_company_idx ON automations (company_id, created_at DESC);

ALTER TABLE automations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='automations' AND policyname='automations_select') THEN
    CREATE POLICY automations_select ON automations FOR SELECT TO authenticated
      USING ((company_id)::text = get_my_company_id());
  END IF;

  -- Escrita restrita. Uma automação executa ações reais sobre o estoque, então
  -- quem pode criá-la é quem já pode aprovar contagem.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='automations' AND policyname='automations_insert') THEN
    CREATE POLICY automations_insert ON automations FOR INSERT TO authenticated
      WITH CHECK (
        (company_id)::text = get_my_company_id()
        AND get_my_role() = ANY (ARRAY['owner','admin','manager'])
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='automations' AND policyname='automations_update') THEN
    CREATE POLICY automations_update ON automations FOR UPDATE TO authenticated
      USING (
        (company_id)::text = get_my_company_id()
        AND get_my_role() = ANY (ARRAY['owner','admin','manager'])
      )
      WITH CHECK ((company_id)::text = get_my_company_id());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='automations' AND policyname='automations_delete') THEN
    CREATE POLICY automations_delete ON automations FOR DELETE TO authenticated
      USING (
        (company_id)::text = get_my_company_id()
        AND get_my_role() = ANY (ARRAY['owner','admin'])
      );
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. automation_events — a fila
--
-- Um evento por fato ocorrido, independente de existir automação interessada.
-- Gravar sempre é mais simples e mais barato do que consultar automações dentro
-- de um trigger na transação da contagem; o engine descarta o que não interessa.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS automation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  event_type text NOT NULL,
  -- Contexto do evento. É a raiz do `trigger.*` que as condições e as ações
  -- leem (§21). Só campos de domínio, nunca dado sensível.
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Registro que originou o evento, para diagnóstico e para idempotência.
  source_table text,
  source_id uuid,

  -- ── Proteção contra loop (§13) ────────────────────────────────────────────
  -- Um evento nascido de uma ação de automação carrega quem o originou e a
  -- profundidade. O engine recusa acima do limite, e recusa uma automação
  -- reagindo a evento que ela mesma produziu.
  origin_execution_id uuid,
  origin_automation_id uuid,
  depth integer NOT NULL DEFAULT 0,

  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'processed', 'skipped', 'failed')),
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Claim da fila. Parcial: um evento processado nunca volta por este caminho.
CREATE INDEX IF NOT EXISTS automation_events_pending_idx
  ON automation_events (company_id, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS automation_events_type_idx
  ON automation_events (company_id, event_type, created_at DESC);

ALTER TABLE automation_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='automation_events' AND policyname='automation_events_select') THEN
    CREATE POLICY automation_events_select ON automation_events FOR SELECT TO authenticated
      USING ((company_id)::text = get_my_company_id());
  END IF;
END $$;

-- Sem policy de INSERT/UPDATE para authenticated: eventos nascem só dos triggers
-- e são consumidos pela Edge Function com service_role. Um cliente que pudesse
-- inserir aqui fabricaria eventos e faria o engine agir sobre fatos inventados.

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. automation_executions
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS automation_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  automation_id uuid NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  -- NULL em execução manual, que não tem evento de origem.
  event_id uuid REFERENCES automation_events(id) ON DELETE SET NULL,

  -- Versão do workflow no momento da execução. Um log sem isto aponta para um
  -- grafo que pode já ter mudado.
  automation_version integer NOT NULL DEFAULT 1,

  trigger_type text NOT NULL,
  trigger_source text NOT NULL DEFAULT 'event'
    CHECK (trigger_source IN ('event', 'manual', 'schedule', 'webhook')),

  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'success', 'partial', 'failed', 'cancelled')),

  -- Modo de teste: as ações não são aplicadas, só decididas e registradas (§33).
  dry_run boolean NOT NULL DEFAULT false,

  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,

  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms integer,

  triggered_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  depth integer NOT NULL DEFAULT 0
);

-- ── Idempotência (§12) ──────────────────────────────────────────────────────
-- Uma execução por (automação, evento). Se o mesmo evento for processado duas
-- vezes — reentrega, duas abas, retry — a segunda tentativa colide aqui e não
-- cria uma segunda recontagem. Execução manual tem event_id NULL e por isso não
-- entra no índice: testar duas vezes é intencional.
CREATE UNIQUE INDEX IF NOT EXISTS automation_executions_idempotency_idx
  ON automation_executions (automation_id, event_id)
  WHERE event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS automation_executions_history_idx
  ON automation_executions (company_id, started_at DESC);

CREATE INDEX IF NOT EXISTS automation_executions_by_automation_idx
  ON automation_executions (automation_id, started_at DESC);

ALTER TABLE automation_executions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='automation_executions' AND policyname='automation_executions_select') THEN
    CREATE POLICY automation_executions_select ON automation_executions FOR SELECT TO authenticated
      USING ((company_id)::text = get_my_company_id());
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. automation_node_executions
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS automation_node_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  execution_id uuid NOT NULL REFERENCES automation_executions(id) ON DELETE CASCADE,

  node_id text NOT NULL,
  node_type text NOT NULL,
  node_label text,

  -- `sequence` porque started_at tem resolução insuficiente: nodes de um mesmo
  -- workflow terminam no mesmo milissegundo e a ordem do log fica indefinida.
  sequence integer NOT NULL,

  status text NOT NULL CHECK (status IN ('success', 'failed', 'skipped')),
  -- Resultado da avaliação, para nodes de condição/branch.
  condition_result boolean,

  output jsonb,
  error_message text,
  attempts integer NOT NULL DEFAULT 1,

  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms integer
);

CREATE INDEX IF NOT EXISTS automation_node_executions_by_execution_idx
  ON automation_node_executions (execution_id, sequence);

ALTER TABLE automation_node_executions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='automation_node_executions' AND policyname='automation_node_executions_select') THEN
    CREATE POLICY automation_node_executions_select ON automation_node_executions FOR SELECT TO authenticated
      USING ((company_id)::text = get_my_company_id());
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. automation_notifications
--
-- O projeto não tem sistema de notificação — verificado antes de criar isto, e é
-- a razão pela qual as ações "notificar responsável" / "criar alerta" do briefing
-- não teriam onde escrever. integration_alerts existe mas é do domínio de
-- integrações (tem connection_id) e usá-la para contagem seria desvio de
-- responsabilidade.
--
-- Tabela pequena e própria do módulo, com RLS. In-app, não e-mail: não há
-- provedor de e-mail no projeto e o briefing (§9) pede para não construir um.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS automation_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  -- NULL = para toda a empresa (nenhum responsável identificado no contexto).
  recipient_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  title text NOT NULL,
  body text,
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),

  -- De onde veio, para o usuário poder abrir a execução que a gerou.
  execution_id uuid REFERENCES automation_executions(id) ON DELETE SET NULL,
  automation_id uuid REFERENCES automations(id) ON DELETE SET NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,

  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS automation_notifications_unread_idx
  ON automation_notifications (company_id, created_at DESC)
  WHERE read_at IS NULL;

ALTER TABLE automation_notifications ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='automation_notifications' AND policyname='automation_notifications_select') THEN
    -- Empresa inteira, não só o destinatário: uma notificação de automação é
    -- trabalho que apareceu para a operação, e esconder de quem não é o
    -- destinatário nominal faz a equipe descobrir a tarefa sem saber a origem.
    CREATE POLICY automation_notifications_select ON automation_notifications FOR SELECT TO authenticated
      USING ((company_id)::text = get_my_company_id());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='automation_notifications' AND policyname='automation_notifications_update') THEN
    -- Só para marcar como lida.
    CREATE POLICY automation_notifications_update ON automation_notifications FOR UPDATE TO authenticated
      USING ((company_id)::text = get_my_company_id())
      WITH CHECK ((company_id)::text = get_my_company_id());
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Emissores
--
-- Os triggers que fazem os módulos existentes emitirem eventos sem uma linha
-- alterada neles.
--
-- Todos são AFTER e todos engolem exceção: um defeito aqui não pode impedir
-- alguém de registrar contagem. Emitir evento é conveniência; contar estoque não.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION automation_emit_event(
  p_company_id uuid,
  p_event_type text,
  p_payload jsonb,
  p_source_table text DEFAULT NULL,
  p_source_id uuid DEFAULT NULL,
  p_origin_execution_id uuid DEFAULT NULL,
  p_origin_automation_id uuid DEFAULT NULL,
  p_depth integer DEFAULT 0
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_id uuid;
BEGIN
  IF p_company_id IS NULL OR p_event_type IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO automation_events (
    company_id, event_type, payload, source_table, source_id,
    origin_execution_id, origin_automation_id, depth
  ) VALUES (
    p_company_id, p_event_type, coalesce(p_payload, '{}'::jsonb), p_source_table, p_source_id,
    p_origin_execution_id, p_origin_automation_id, coalesce(p_depth, 0)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION automation_emit_event(uuid, text, jsonb, text, uuid, uuid, uuid, integer) FROM PUBLIC, anon, authenticated;

-- ── item contado ────────────────────────────────────────────────────────────
-- Dispara quando physical_quantity passa de nulo para um valor, ou muda de
-- valor. Não dispara em UPDATE que não toca a contagem (finalize grava
-- result_status e snapshots na mesma linha, e isso não é "item contado").
CREATE OR REPLACE FUNCTION automation_on_count_item_counted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_erp   numeric := coalesce(NEW.erp_quantity_snapshot, 0);
  v_total numeric := coalesce(NEW.physical_quantity, 0) + coalesce(NEW.found_elsewhere_quantity, 0);
  v_diff  numeric;
BEGIN
  IF NEW.physical_quantity IS NULL THEN
    RETURN NEW;
  END IF;
  IF OLD.physical_quantity IS NOT NULL
     AND OLD.physical_quantity = NEW.physical_quantity
     AND coalesce(OLD.found_elsewhere_quantity, 0) = coalesce(NEW.found_elsewhere_quantity, 0) THEN
    RETURN NEW;
  END IF;

  v_diff := v_total - v_erp;

  BEGIN
    PERFORM automation_emit_event(
      NEW.company_id,
      'count.item_counted',
      jsonb_build_object(
        'item', jsonb_build_object(
          'id', NEW.id, 'sku', NEW.sku, 'ean', NEW.ean, 'location', NEW.location,
          'productId', NEW.product_id
        ),
        'session', jsonb_build_object('id', NEW.session_id),
        'count', jsonb_build_object(
          'erpQuantity', v_erp,
          'physicalQuantity', NEW.physical_quantity,
          'foundElsewhereQuantity', coalesce(NEW.found_elsewhere_quantity, 0),
          'totalFound', v_total,
          'difference', v_diff,
          'absoluteDifference', abs(v_diff),
          -- Percentual do item. Base = saldo do ERP; na falta dele, o total
          -- encontrado — mesma correção que a 050 fez no limite de recontagem, e
          -- pelo mesmo motivo: com saldo esperado zero o percentual ficaria
          -- indefinido e um desvio de qualquer tamanho mediria 0%.
          'variancePercentage', CASE
            WHEN v_erp > 0 THEN round((abs(v_diff) / v_erp) * 100, 2)
            WHEN v_total > 0 THEN 100
            ELSE 0
          END,
          'isDivergent', v_diff <> 0
        )
      ),
      'physical_count_items',
      NEW.id
    );
  EXCEPTION WHEN OTHERS THEN
    -- Contar estoque não pode falhar por causa de automação.
    NULL;
  END;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS automation_count_item_counted ON physical_count_items;
CREATE TRIGGER automation_count_item_counted
  AFTER UPDATE ON physical_count_items
  FOR EACH ROW EXECUTE FUNCTION automation_on_count_item_counted();

-- ── sessão de contagem mudou de status ──────────────────────────────────────
-- Um trigger, vários tipos de evento, decididos pelo status de destino. Assim
-- adicionar um status novo no futuro é uma linha aqui, não um trigger novo.
CREATE OR REPLACE FUNCTION automation_on_count_session_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_event text;
  v_m     RECORD;
BEGIN
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  v_event := CASE NEW.status
    WHEN 'in_progress'      THEN 'count.session_started'
    WHEN 'completed'        THEN 'count.session_finalized'
    WHEN 'with_divergences' THEN 'count.session_finalized'
    ELSE NULL
  END;

  IF v_event IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    -- Reusa a medida da 050 em vez de recalcular: é a mesma definição de
    -- divergência que a recontagem automática usa, então uma automação e a 049
    -- não podem discordar sobre o que é 12%.
    SELECT * INTO v_m FROM pc_measure_session_divergence(NEW.id);

    PERFORM automation_emit_event(
      NEW.company_id,
      v_event,
      jsonb_build_object(
        'session', jsonb_build_object(
          'id', NEW.id,
          'rootSessionId', NEW.root_session_id,
          'countNumber', NEW.count_number,
          'warehouse', NEW.warehouse,
          'area', NEW.area,
          'streetFrom', NEW.street_from,
          'streetTo', NEW.street_to,
          'responsibleId', NEW.responsible_id,
          'status', NEW.status,
          'totalItems', NEW.total_items,
          'previousStatus', OLD.status
        ),
        'divergence', jsonb_build_object(
          'countedItems', coalesce(v_m.counted_items, 0),
          'divergentItems', coalesce(v_m.divergent_items, 0),
          'absoluteUnitDeviation', coalesce(v_m.absolute_unit_deviation, 0),
          'erpTotal', coalesce(v_m.erp_total, 0),
          'physicalTotal', coalesce(v_m.physical_total, 0),
          'divergentItemPercentage', CASE
            WHEN coalesce(v_m.counted_items, 0) > 0
            THEN round((v_m.divergent_items::numeric / v_m.counted_items) * 100, 2)
            ELSE 0 END,
          'unitDeviationPercentage', CASE
            WHEN coalesce(v_m.erp_total, 0) > 0
              THEN round((v_m.absolute_unit_deviation / v_m.erp_total) * 100, 2)
            WHEN coalesce(v_m.physical_total, 0) > 0 THEN 100
            ELSE 0 END,
          'hasDivergence', coalesce(v_m.divergent_items, 0) > 0
        )
      ),
      'physical_count_sessions',
      NEW.id
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS automation_count_session_status ON physical_count_sessions;
CREATE TRIGGER automation_count_session_status
  AFTER UPDATE OF status ON physical_count_sessions
  FOR EACH ROW EXECUTE FUNCTION automation_on_count_session_status();

-- ── sessão de contagem criada ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION automation_on_count_session_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  BEGIN
    PERFORM automation_emit_event(
      NEW.company_id,
      'count.session_created',
      jsonb_build_object(
        'session', jsonb_build_object(
          'id', NEW.id,
          'rootSessionId', NEW.root_session_id,
          'linkedSessionId', NEW.linked_session_id,
          'countNumber', NEW.count_number,
          'warehouse', NEW.warehouse,
          'area', NEW.area,
          'responsibleId', NEW.responsible_id,
          'status', NEW.status,
          'totalItems', NEW.total_items,
          -- Distingue rodada seguinte de contagem nova. Uma automação que reage a
          -- "contagem criada" quase sempre NÃO quer reagir à recontagem que ela
          -- mesma pediu — e sem este campo não teria como saber.
          'isRecount', NEW.count_number > 1
        )
      ),
      'physical_count_sessions',
      NEW.id
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS automation_count_session_created ON physical_count_sessions;
CREATE TRIGGER automation_count_session_created
  AFTER INSERT ON physical_count_sessions
  FOR EACH ROW EXECUTE FUNCTION automation_on_count_session_created();

-- ── divergência de estoque detectada (integrações) ─────────────────────────
CREATE OR REPLACE FUNCTION automation_on_stock_conflict()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF NEW.status <> 'open' THEN
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM automation_emit_event(
      NEW.company_id,
      'stock.discrepancy_detected',
      jsonb_build_object(
        'conflict', jsonb_build_object(
          'id', NEW.id,
          'connectionId', NEW.connection_id,
          'entityType', NEW.entity_type,
          'externalId', NEW.external_id
        )
      ),
      'integration_sync_conflicts',
      NEW.id
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS automation_stock_conflict ON integration_sync_conflicts;
CREATE TRIGGER automation_stock_conflict
  AFTER INSERT ON integration_sync_conflicts
  FOR EACH ROW EXECUTE FUNCTION automation_on_stock_conflict();

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Claim da fila
--
-- FOR UPDATE SKIP LOCKED, mesmo padrão de integration_claim_due_jobs (045): dois
-- consumidores simultâneos nunca pegam o mesmo evento (§40).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION automation_claim_events(p_company_id uuid, p_limit integer DEFAULT 20)
RETURNS TABLE (
  id uuid, company_id uuid, event_type text, payload jsonb,
  source_table text, source_id uuid,
  origin_execution_id uuid, origin_automation_id uuid, depth integer, created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT e.id
      FROM automation_events e
     WHERE e.company_id = p_company_id
       AND e.status = 'pending'
     ORDER BY e.created_at
     LIMIT greatest(1, least(coalesce(p_limit, 20), 100))
     FOR UPDATE SKIP LOCKED
  )
  UPDATE automation_events e
     SET status = 'processing'
    FROM claimed c
   WHERE e.id = c.id
  RETURNING e.id, e.company_id, e.event_type, e.payload,
            e.source_table, e.source_id,
            e.origin_execution_id, e.origin_automation_id, e.depth, e.created_at;
END;
$fn$;

REVOKE ALL ON FUNCTION automation_claim_events(uuid, integer) FROM PUBLIC, anon, authenticated;

-- Devolve à fila eventos travados em `processing` — um worker que morreu no meio
-- deixaria o evento parado para sempre.
CREATE OR REPLACE FUNCTION automation_reap_stuck_events(p_older_than_minutes integer DEFAULT 15)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_count integer;
BEGIN
  UPDATE automation_events
     SET status = 'pending'
   WHERE status = 'processing'
     AND created_at < now() - make_interval(mins => greatest(1, coalesce(p_older_than_minutes, 15)));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Ação: criar recontagem, com empresa explícita
--
-- pc_create_recount_session (039) resolve a empresa por get_my_company_id(), que
-- depende de JWT. O engine roda com service_role e sem sessão de usuário quando
-- consome a fila, então precisa de uma variante que receba a empresa.
--
-- Duplica a lógica de inserção da 039 — de propósito, e é a escolha menos má. As
-- alternativas eram falsificar as claims do JWT via set_config (frágil e
-- perigoso) ou executar ações com o JWT de quem disparou o evento (aí uma
-- automação faria mais ou menos coisa dependendo de quem contou o item).
--
-- As MESMAS regras de negócio são mantidas: pai finalizado, máximo de 3 rodadas,
-- só itens divergentes, snapshot do ERP copiado do pai e nunca relido.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION automation_action_create_recount(
  p_company_id uuid,
  p_parent_session_id uuid,
  p_responsible_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_parent   physical_count_sessions%ROWTYPE;
  v_new_id   uuid;
  v_inserted integer;
BEGIN
  SELECT * INTO v_parent
  FROM physical_count_sessions
  WHERE id = p_parent_session_id
  FOR UPDATE;

  IF v_parent.id IS NULL THEN
    RAISE EXCEPTION 'Sessão de origem não encontrada';
  END IF;
  -- A barreira de tenant: service_role ignora RLS, então esta comparação é o que
  -- impede a automação da empresa A tocar a contagem da empresa B.
  IF v_parent.company_id <> p_company_id THEN
    RAISE EXCEPTION 'Sessão de origem pertence a outra empresa';
  END IF;
  IF v_parent.status NOT IN ('completed','with_divergences') THEN
    RAISE EXCEPTION 'A contagem de origem precisa estar finalizada para gerar recontagem';
  END IF;
  IF v_parent.count_number >= 3 THEN
    RAISE EXCEPTION 'Limite de 3 rodadas de contagem atingido';
  END IF;

  INSERT INTO physical_count_sessions (
    company_id, root_session_id, linked_session_id, count_number,
    warehouse, area, street_from, street_to, responsible_id, observation, status,
    started_at
  ) VALUES (
    v_parent.company_id, v_parent.root_session_id, v_parent.id, v_parent.count_number + 1,
    v_parent.warehouse, v_parent.area, v_parent.street_from, v_parent.street_to,
    coalesce(p_responsible_id, v_parent.responsible_id), v_parent.observation, 'in_progress',
    now()
  )
  RETURNING id INTO v_new_id;

  INSERT INTO physical_count_items (
    session_id, company_id, product_id, sku, ean, location,
    erp_quantity_snapshot, erp_source, erp_sync_ref
  )
  SELECT v_new_id, company_id, product_id, sku, ean, location,
         erp_quantity_snapshot, erp_source, erp_sync_ref
  FROM physical_count_items
  WHERE session_id = p_parent_session_id AND result_status <> 'ok';

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN
    RAISE EXCEPTION 'A contagem de origem não tem itens divergentes para recontar';
  END IF;

  UPDATE physical_count_sessions
     SET total_items = v_inserted, updated_at = now()
   WHERE id = v_new_id;

  RETURN v_new_id;
END;
$fn$;

REVOKE ALL ON FUNCTION automation_action_create_recount(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Contadores da automação
--
-- Feito por RPC e não por UPDATE do cliente: o contador precisa subir mesmo
-- quando quem executou é o service_role sem sessão.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION automation_bump_execution_counters(p_automation_id uuid, p_executed_at timestamptz)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  UPDATE automations
     SET execution_count = execution_count + 1,
         last_executed_at = coalesce(p_executed_at, now())
   WHERE id = p_automation_id;
$fn$;

REVOKE ALL ON FUNCTION automation_bump_execution_counters(uuid, timestamptz) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. version + updated_at
--
-- A versão sobe só quando o workflow muda de fato. Ativar/desativar não é versão
-- nova, e um log apontando para a versão 12 depois de onze cliques em
-- ativar/desativar não diria nada.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION automation_touch_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
BEGIN
  NEW.updated_at := now();
  IF NEW.workflow IS DISTINCT FROM OLD.workflow THEN
    NEW.version := OLD.version + 1;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS automations_touch_version ON automations;
CREATE TRIGGER automations_touch_version
  BEFORE UPDATE ON automations
  FOR EACH ROW EXECUTE FUNCTION automation_touch_version();

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. Limpeza agendada
--
-- pg_cron já está instalado (046). Eventos processados e execuções antigas não
-- servem para nada depois de um tempo e a fila é caminho quente.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION automation_prune_history(p_days integer DEFAULT 30)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM automation_events
   WHERE status IN ('processed', 'skipped')
     AND created_at < now() - make_interval(days => greatest(1, coalesce(p_days, 30)));
  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Node executions caem por cascade.
  DELETE FROM automation_executions
   WHERE started_at < now() - make_interval(days => greatest(1, coalesce(p_days, 30)) * 3);

  RETURN v_count;
END;
$fn$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('automation-reap-stuck-events')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'automation-reap-stuck-events');
    PERFORM cron.schedule('automation-reap-stuck-events', '*/10 * * * *',
      $cron$SELECT automation_reap_stuck_events(15);$cron$);

    PERFORM cron.unschedule('automation-prune-history')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'automation-prune-history');
    PERFORM cron.schedule('automation-prune-history', '41 3 * * *',
      $cron$SELECT automation_prune_history(30);$cron$);
  END IF;
END $$;

COMMENT ON TABLE automations IS
  'Definição de automação: trigger + grafo (nodes/edges em jsonb) interpretado pelo engine. Nenhuma regra é código.';
COMMENT ON TABLE automation_events IS
  'Fila durável. Emitida por triggers nas tabelas de domínio, consumida pela Edge Function automation-run.';
COMMENT ON COLUMN automations.trigger_type IS
  'Duplicado do workflow para permitir busca indexada por (empresa, trigger, ativo) sem abrir o jsonb.';
