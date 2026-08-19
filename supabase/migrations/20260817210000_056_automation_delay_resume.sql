-- ─────────────────────────────────────────────────────────────────────────────
-- 056 — Retomada de execução, para o node de espera
--
-- ── O problema ──────────────────────────────────────────────────────────────
-- Uma Edge Function tem teto de tempo. "Espere 30 minutos e então avise" não pode
-- ser um sleep: a função morreria antes, e a execução ficaria eternamente
-- `running`.
--
-- ── A solução ───────────────────────────────────────────────────────────────
-- O node de espera INTERROMPE a execução. Grava um evento com hora marcada que
-- carrega o ponto de retomada e o contexto acumulado; a execução atual termina como
-- bem-sucedida até ali. Quando a hora chega, o mesmo caminho de fila que trata
-- qualquer evento retoma o workflow no node seguinte.
--
-- Uma execução dividida em duas, portanto — e ligadas por
-- `resumed_from_execution_id`, senão o histórico mostraria duas execuções soltas e
-- ninguém entenderia que são a mesma automação continuando.
--
-- ── Por que reusar automation_events e não criar uma fila de espera ─────────
-- O claim, o reaper, a proteção contra loop, a idempotência e o log já existem para
-- eventos. Uma segunda fila duplicaria todos eles, e duas filas divergem.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Evento com hora marcada
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE automation_events
  -- NULL = para agora. Só o evento de retomada preenche.
  ADD COLUMN IF NOT EXISTS scheduled_for timestamptz,
  -- O ponto de retomada: qual automação, a partir de qual node, e o que as ações
  -- anteriores produziram. Sem o contexto, a segunda metade do workflow perderia
  -- `actions.<id>` e uma interpolação que dependia da primeira metade viraria
  -- "(indisponível)".
  ADD COLUMN IF NOT EXISTS resume_automation_id uuid REFERENCES automations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS resume_node_id text,
  ADD COLUMN IF NOT EXISTS resume_execution_id uuid REFERENCES automation_executions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resume_actions jsonb;

-- O índice de claim precisa refletir a hora marcada, senão um evento de espera
-- seria consumido imediatamente e a espera não existiria.
DROP INDEX IF EXISTS automation_events_pending_idx;
CREATE INDEX IF NOT EXISTS automation_events_pending_idx
  ON automation_events (company_id, coalesce(scheduled_for, created_at))
  WHERE status = 'pending';

ALTER TABLE automation_executions
  -- Liga a continuação à execução que a originou.
  ADD COLUMN IF NOT EXISTS resumed_from_execution_id uuid REFERENCES automation_executions(id) ON DELETE SET NULL,
  -- Node em que esta execução começou. NULL = começou no gatilho.
  ADD COLUMN IF NOT EXISTS resumed_at_node_id text;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Claim respeitando a hora marcada
--
-- Substitui a versão da 051. Duas mudanças: só reivindica o que já venceu, e ordena
-- pela hora efetiva — sem isso, um evento agendado para amanhã seria pego hoje
-- porque foi CRIADO antes de um evento imediato.
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS automation_claim_events(uuid, integer);

CREATE FUNCTION automation_claim_events(p_company_id uuid, p_limit integer DEFAULT 20)
RETURNS TABLE (
  id uuid, company_id uuid, event_type text, payload jsonb,
  source_table text, source_id uuid,
  origin_execution_id uuid, origin_automation_id uuid, depth integer, created_at timestamptz,
  resume_automation_id uuid, resume_node_id text, resume_execution_id uuid, resume_actions jsonb
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
       -- A trava da espera.
       AND (e.scheduled_for IS NULL OR e.scheduled_for <= now())
     ORDER BY coalesce(e.scheduled_for, e.created_at)
     LIMIT greatest(1, least(coalesce(p_limit, 20), 100))
     FOR UPDATE SKIP LOCKED
  )
  UPDATE automation_events e
     SET status = 'processing'
    FROM claimed c
   WHERE e.id = c.id
  RETURNING e.id, e.company_id, e.event_type, e.payload,
            e.source_table, e.source_id,
            e.origin_execution_id, e.origin_automation_id, e.depth, e.created_at,
            e.resume_automation_id, e.resume_node_id, e.resume_execution_id, e.resume_actions;
END;
$fn$;

REVOKE ALL ON FUNCTION automation_claim_events(uuid, integer) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Empresas com trabalho VENCIDO
--
-- Substitui a versão da 052 pelo mesmo motivo: uma empresa cujo único evento está
-- agendado para amanhã não tem trabalho hoje, e listá-la faria o worker abrir
-- conexão e claim para não achar nada.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION automation_companies_with_pending_events(p_limit integer DEFAULT 25)
RETURNS TABLE (company_id uuid, pending_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT e.company_id, count(*)
    FROM automation_events e
   WHERE e.status = 'pending'
     AND (e.scheduled_for IS NULL OR e.scheduled_for <= now())
   GROUP BY e.company_id
   ORDER BY min(coalesce(e.scheduled_for, e.created_at))
   LIMIT greatest(1, least(coalesce(p_limit, 25), 100));
$fn$;

REVOKE ALL ON FUNCTION automation_companies_with_pending_events(integer) FROM PUBLIC, anon, authenticated;

-- O despacho por cron também: sem isto, o cron faria uma chamada HTTP por minuto
-- enquanto existisse qualquer evento futuro na fila.
CREATE OR REPLACE FUNCTION automation_dispatch_pending()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_pending integer;
  v_url     text;
  v_secret  text;
  v_request bigint;
BEGIN
  SELECT count(*) INTO v_pending
    FROM automation_events
   WHERE status = 'pending'
     AND (scheduled_for IS NULL OR scheduled_for <= now());

  IF v_pending = 0 THEN
    RETURN NULL;
  END IF;

  SELECT value INTO v_url FROM automation_runtime_config WHERE key = 'functions_base_url';
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'automation_cron_secret';

  IF v_url IS NULL OR v_secret IS NULL THEN
    RAISE WARNING 'automation_dispatch_pending: configuração ausente (url=%, segredo=%)',
      v_url IS NOT NULL, v_secret IS NOT NULL;
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url => v_url || '/automation-run',
    body => jsonb_build_object('mode', 'cron'),
    headers => jsonb_build_object(
      'Content-Type', 'application/json',
      'x-automation-cron-secret', v_secret
    ),
    timeout_milliseconds => 55000
  ) INTO v_request;

  RETURN v_request;
END;
$fn$;

REVOKE ALL ON FUNCTION automation_dispatch_pending() FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Agendar a retomada
--
-- Chamada pelo engine ao encontrar um node de espera. Recebe o contexto acumulado
-- para a continuação não perder o que as ações anteriores produziram.
--
-- A profundidade é PRESERVADA, não incrementada: a espera é a mesma automação
-- continuando, não um encadeamento novo. Incrementar faria três esperas em série
-- estourarem o limite anti-loop e a automação parar no meio sem motivo.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION automation_schedule_resume(
  p_company_id uuid,
  p_automation_id uuid,
  p_execution_id uuid,
  p_event_type text,
  p_payload jsonb,
  p_resume_node_id text,
  p_resume_actions jsonb,
  p_delay_minutes integer,
  p_depth integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_id uuid;
BEGIN
  IF p_resume_node_id IS NULL OR p_resume_node_id = '' THEN
    -- Nada depois da espera. Não agenda nada: a execução terminou ali, e um evento
    -- de retomada sem destino só produziria uma execução vazia.
    RETURN NULL;
  END IF;

  INSERT INTO automation_events (
    company_id, event_type, payload, source_table, source_id,
    origin_execution_id, origin_automation_id, depth,
    scheduled_for, resume_automation_id, resume_node_id, resume_execution_id, resume_actions
  ) VALUES (
    p_company_id, p_event_type, coalesce(p_payload, '{}'::jsonb),
    'automation_delay', p_automation_id,
    p_execution_id, p_automation_id, coalesce(p_depth, 0),
    now() + make_interval(mins => greatest(1, coalesce(p_delay_minutes, 5))),
    p_automation_id, p_resume_node_id, p_execution_id, coalesce(p_resume_actions, '{}'::jsonb)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION automation_schedule_resume(uuid, uuid, uuid, text, jsonb, text, jsonb, integer, integer) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Um evento de retomada pertence a UMA automação
--
-- A proteção contra auto-disparo do engine recusaria a retomada, porque
-- origin_automation_id é a própria automação. O engine trata evento de retomada
-- como caso próprio — e este índice garante que não existam dois eventos de
-- retomada para a mesma execução, o que duplicaria a segunda metade do workflow.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS automation_events_resume_unique_idx
  ON automation_events (resume_execution_id, resume_node_id)
  WHERE resume_execution_id IS NOT NULL;

COMMENT ON COLUMN automation_events.scheduled_for IS
  'Hora marcada. NULL = imediato. O claim só reivindica o que venceu — é o que faz a espera existir.';
COMMENT ON COLUMN automation_events.resume_actions IS
  'Contexto de actions acumulado até a espera. Sem ele, a segunda metade do workflow perde as saídas da primeira.';
