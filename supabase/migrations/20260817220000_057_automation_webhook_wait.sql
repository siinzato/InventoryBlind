-- ─────────────────────────────────────────────────────────────────────────────
-- 057 — Espera por chamada externa
--
-- O node `webhook_wait` para a execução até um sistema externo chamar de volta. A
-- mecânica é a mesma do node de espera (056): grava onde continuar e encerra. A
-- diferença é o gatilho da retomada — tempo lá, POST autenticado aqui.
--
-- ── Por que uma tabela e não só um evento agendado ──────────────────────────
-- A retomada por tempo é um evento com hora marcada; o claim resolve. A retomada por
-- chamada externa precisa de um TOKEN que o sistema de fora apresente, e de um prazo
-- para não ficar pendente para sempre. Guardar isso num evento pendente significaria
-- consultar a fila por token — caminho quente varrido por chave secundária.
--
-- ── O prazo é obrigatório ───────────────────────────────────────────────────
-- Sem ele, um sistema externo que nunca responde deixa uma espera aberta para sempre
-- e o histórico enche de linhas que ninguém consegue fechar. Vencido, o cron converte
-- a espera em retomada — o workflow continua, e o node seguinte pode verificar que a
-- resposta não veio.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS automation_pending_waits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  automation_id uuid NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  execution_id uuid NOT NULL REFERENCES automation_executions(id) ON DELETE CASCADE,

  -- Apresentado pelo sistema externo para retomar. Aleatório de 32 bytes: é
  -- credencial de uso único, e adivinhá-lo retomaria o workflow de outra empresa.
  token text NOT NULL UNIQUE,

  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  resume_node_id text NOT NULL,
  resume_actions jsonb NOT NULL DEFAULT '{}'::jsonb,
  depth integer NOT NULL DEFAULT 0,

  status text NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'resumed', 'expired')),
  expires_at timestamptz NOT NULL,
  resumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- O caminho do cron: esperas vencidas. Parcial porque uma espera resolvida nunca
-- volta por aqui.
CREATE INDEX IF NOT EXISTS automation_pending_waits_due_idx
  ON automation_pending_waits (expires_at)
  WHERE status = 'waiting';

CREATE INDEX IF NOT EXISTS automation_pending_waits_execution_idx
  ON automation_pending_waits (execution_id);

ALTER TABLE automation_pending_waits ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='automation_pending_waits' AND policyname='automation_pending_waits_select') THEN
    -- Sem a coluna `token` no que o cliente lê? A policy não filtra coluna, então a
    -- tela usa uma view/consulta explícita sem o token. O token aparece uma vez no
    -- log do node de espera, que é onde o usuário o copia.
    CREATE POLICY automation_pending_waits_select ON automation_pending_waits
      FOR SELECT TO authenticated
      USING ((company_id)::text = get_my_company_id());
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Registrar a espera
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION automation_create_wait(
  p_company_id uuid,
  p_automation_id uuid,
  p_execution_id uuid,
  p_event_type text,
  p_payload jsonb,
  p_resume_node_id text,
  p_resume_actions jsonb,
  p_timeout_minutes integer,
  p_depth integer
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_token text;
BEGIN
  IF p_resume_node_id IS NULL OR p_resume_node_id = '' THEN
    -- Nada depois da espera: não há o que retomar, e uma espera sem destino só
    -- produziria uma execução vazia quando alguém a acionasse.
    RETURN NULL;
  END IF;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  INSERT INTO automation_pending_waits (
    company_id, automation_id, execution_id, token, event_type, payload,
    resume_node_id, resume_actions, depth, expires_at
  ) VALUES (
    p_company_id, p_automation_id, p_execution_id, v_token, p_event_type,
    coalesce(p_payload, '{}'::jsonb), p_resume_node_id, coalesce(p_resume_actions, '{}'::jsonb),
    coalesce(p_depth, 0),
    now() + make_interval(mins => greatest(1, least(coalesce(p_timeout_minutes, 60), 60 * 24 * 7)))
  );

  RETURN v_token;
END;
$fn$;

REVOKE ALL ON FUNCTION automation_create_wait(uuid, uuid, uuid, text, jsonb, text, jsonb, integer, integer) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Retomar por token
--
-- Emite o evento de retomada e fecha a espera na MESMA transação. Separado, haveria
-- janela em que a espera consta resolvida e o evento não existe — ou o contrário.
--
-- `p_external_payload` é o que o sistema externo mandou. Entra no contexto sob
-- `trigger.waitResult`, então o node seguinte pode decidir com base na resposta em vez
-- de só saber que ela chegou.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION automation_resume_wait(p_token text, p_external_payload jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE (resumed boolean, reason text, event_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_wait automation_pending_waits%ROWTYPE;
  v_event uuid;
  v_payload jsonb;
BEGIN
  SELECT * INTO v_wait
  FROM automation_pending_waits
  WHERE token = p_token
  -- FOR UPDATE: duas chamadas simultâneas com o mesmo token não devem produzir duas
  -- retomadas. A segunda encontra status já 'resumed'.
  FOR UPDATE;

  IF v_wait.id IS NULL THEN
    RETURN QUERY SELECT false, 'not_found'::text, NULL::uuid;
    RETURN;
  END IF;

  IF v_wait.status <> 'waiting' THEN
    RETURN QUERY SELECT false, v_wait.status, NULL::uuid;
    RETURN;
  END IF;

  IF v_wait.expires_at <= now() THEN
    UPDATE automation_pending_waits SET status = 'expired' WHERE id = v_wait.id;
    RETURN QUERY SELECT false, 'expired'::text, NULL::uuid;
    RETURN;
  END IF;

  -- A resposta externa entra no contexto ao lado do payload original do gatilho.
  v_payload := v_wait.payload || jsonb_build_object(
    'waitResult', jsonb_build_object(
      'received', true,
      'receivedAt', now(),
      'body', coalesce(p_external_payload, '{}'::jsonb)
    )
  );

  INSERT INTO automation_events (
    company_id, event_type, payload, source_table, source_id,
    origin_execution_id, origin_automation_id, depth,
    resume_automation_id, resume_node_id, resume_execution_id, resume_actions
  ) VALUES (
    v_wait.company_id, v_wait.event_type, v_payload,
    'automation_pending_waits', v_wait.id,
    v_wait.execution_id, v_wait.automation_id, v_wait.depth,
    v_wait.automation_id, v_wait.resume_node_id, v_wait.execution_id, v_wait.resume_actions
  )
  RETURNING id INTO v_event;

  UPDATE automation_pending_waits
     SET status = 'resumed', resumed_at = now()
   WHERE id = v_wait.id;

  RETURN QUERY SELECT true, 'resumed'::text, v_event;
END;
$fn$;

REVOKE ALL ON FUNCTION automation_resume_wait(text, jsonb) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Vencer as esperas
--
-- Uma espera vencida CONTINUA o workflow em vez de abandoná-lo, com
-- `waitResult.received = false`. O node seguinte pode então tratar o caso "não
-- responderam" — que é informação, não ausência de informação. Abandonar deixaria o
-- fluxo pela metade sem ninguém saber.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION automation_expire_waits()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_wait  record;
  v_count integer := 0;
BEGIN
  FOR v_wait IN
    SELECT * FROM automation_pending_waits
     WHERE status = 'waiting' AND expires_at <= now()
     FOR UPDATE SKIP LOCKED
  LOOP
    INSERT INTO automation_events (
      company_id, event_type, payload, source_table, source_id,
      origin_execution_id, origin_automation_id, depth,
      resume_automation_id, resume_node_id, resume_execution_id, resume_actions
    ) VALUES (
      v_wait.company_id, v_wait.event_type,
      v_wait.payload || jsonb_build_object(
        'waitResult', jsonb_build_object('received', false, 'reason', 'timeout', 'receivedAt', now())
      ),
      'automation_pending_waits', v_wait.id,
      v_wait.execution_id, v_wait.automation_id, v_wait.depth,
      v_wait.automation_id, v_wait.resume_node_id, v_wait.execution_id, v_wait.resume_actions
    );

    UPDATE automation_pending_waits SET status = 'expired' WHERE id = v_wait.id;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$fn$;

REVOKE ALL ON FUNCTION automation_expire_waits() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('automation-expire-waits')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'automation-expire-waits');
    PERFORM cron.schedule('automation-expire-waits', '* * * * *',
      $cron$SELECT automation_expire_waits();$cron$);
  END IF;
END $$;

COMMENT ON TABLE automation_pending_waits IS
  'Execuções pausadas esperando chamada externa. O token é credencial de uso único; o prazo garante que nenhuma espera fique aberta para sempre.';
