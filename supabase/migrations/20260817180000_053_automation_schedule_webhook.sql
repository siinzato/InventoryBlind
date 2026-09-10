-- ─────────────────────────────────────────────────────────────────────────────
-- 053 — Gatilho agendado e webhook de entrada
--
-- Os dois gatilhos que não nascem de uma mudança em tabela. Ambos produzem eventos
-- no mesmo formato de automation_events, então o engine, a validação e o histórico
-- não mudam nada — é a propriedade que o registry existe para garantir.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Agendamento
--
-- ── Por que presets e não expressão cron ────────────────────────────────────
-- Interpretar cron exige calcular a próxima ocorrência, o que em plpgsql é um
-- gerador de datas com casos de borda (dia 31, fevereiro, horário de verão). O
-- briefing pede "todos os dias às 08:00 / a cada hora / toda segunda", e três
-- formas estruturadas cobrem isso com aritmética que se lê inteira.
--
-- ── Fuso ───────────────────────────────────────────────────────────────────
-- Guardado por automação, com America/Sao_Paulo como padrão. UTC faria "todos os
-- dias às 08:00" disparar às 5h da manhã para um cliente brasileiro — o tipo de
-- decisão que parece detalhe até alguém receber alerta de madrugada.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE automations
  ADD COLUMN IF NOT EXISTS schedule_kind text
    CHECK (schedule_kind IS NULL OR schedule_kind IN ('interval_minutes', 'daily', 'weekly')),
  ADD COLUMN IF NOT EXISTS schedule_minutes integer CHECK (schedule_minutes IS NULL OR schedule_minutes >= 5),
  ADD COLUMN IF NOT EXISTS schedule_hour integer CHECK (schedule_hour IS NULL OR (schedule_hour BETWEEN 0 AND 23)),
  ADD COLUMN IF NOT EXISTS schedule_minute integer CHECK (schedule_minute IS NULL OR (schedule_minute BETWEEN 0 AND 59)),
  -- 0 = domingo, igual a EXTRACT(DOW).
  ADD COLUMN IF NOT EXISTS schedule_weekday integer CHECK (schedule_weekday IS NULL OR (schedule_weekday BETWEEN 0 AND 6)),
  ADD COLUMN IF NOT EXISTS schedule_timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  -- Quando o próximo disparo é devido. Materializado em vez de recalculado a cada
  -- passagem do cron: é o que permite um índice e uma consulta trivial, e é também o
  -- que garante que um atraso do agendador não produza vários disparos em rajada.
  ADD COLUMN IF NOT EXISTS schedule_next_run_at timestamptz;

-- Índice do agendador. Parcial: só automações ativas com hora marcada.
CREATE INDEX IF NOT EXISTS automations_schedule_due_idx
  ON automations (schedule_next_run_at)
  WHERE status = 'active' AND trigger_type = 'schedule' AND schedule_next_run_at IS NOT NULL;

/** Próximo disparo depois de `p_from`.
 *
 *  Sempre estritamente no futuro em relação a `p_from`: um disparo calculado como
 *  "agora" seria reconsumido na mesma passagem do cron e a automação rodaria em laço.
 *
 *  Para daily/weekly a conta é feita no fuso da automação e o resultado volta para
 *  timestamptz — sem isso, "08:00" significaria 08:00 UTC. */
CREATE OR REPLACE FUNCTION automation_next_schedule_run(
  p_kind text,
  p_minutes integer,
  p_hour integer,
  p_minute integer,
  p_weekday integer,
  p_timezone text,
  p_from timestamptz DEFAULT now()
)
RETURNS timestamptz
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $fn$
DECLARE
  v_tz    text := coalesce(nullif(p_timezone, ''), 'America/Sao_Paulo');
  v_local timestamp;
  v_next  timestamp;
  v_delta integer;
BEGIN
  IF p_kind IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_kind = 'interval_minutes' THEN
    -- Mínimo de 5 minutos, igual ao CHECK. Sem piso, um intervalo de 1 minuto
    -- competiria com o próprio cron do despacho.
    RETURN p_from + make_interval(mins => greatest(5, coalesce(p_minutes, 60)));
  END IF;

  v_local := p_from AT TIME ZONE v_tz;

  IF p_kind = 'daily' THEN
    v_next := date_trunc('day', v_local)
              + make_interval(hours => coalesce(p_hour, 8), mins => coalesce(p_minute, 0));
    IF v_next <= v_local THEN
      v_next := v_next + interval '1 day';
    END IF;
    RETURN v_next AT TIME ZONE v_tz;
  END IF;

  IF p_kind = 'weekly' THEN
    v_next := date_trunc('day', v_local)
              + make_interval(hours => coalesce(p_hour, 8), mins => coalesce(p_minute, 0));
    -- Distância até o dia da semana pedido, em 0..6.
    v_delta := (coalesce(p_weekday, 1) - EXTRACT(DOW FROM v_local)::integer + 7) % 7;
    v_next := v_next + make_interval(days => v_delta);
    IF v_next <= v_local THEN
      v_next := v_next + interval '7 days';
    END IF;
    RETURN v_next AT TIME ZONE v_tz;
  END IF;

  RETURN NULL;
END;
$fn$;

/** Emite `schedule.tick` para cada automação agendada devida e reagenda.
 *
 *  O reagendamento parte de `now()`, não do horário devido: se o agendador ficou
 *  parado duas horas, isto produz UM disparo e volta ao ritmo, em vez de disparar
 *  todas as ocorrências perdidas de uma vez. Recuperar histórico não é o que uma
 *  automação de rotina quer — ela quer o estado atual. */
CREATE OR REPLACE FUNCTION automation_emit_due_schedules()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_row     record;
  v_emitted integer := 0;
BEGIN
  FOR v_row IN
    SELECT id, company_id, name, schedule_kind, schedule_minutes, schedule_hour,
           schedule_minute, schedule_weekday, schedule_timezone
      FROM automations
     WHERE status = 'active'
       AND trigger_type = 'schedule'
       AND schedule_next_run_at IS NOT NULL
       AND schedule_next_run_at <= now()
     -- Duas passagens simultâneas do agendador não pegam a mesma automação.
     FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM automation_emit_event(
      v_row.company_id,
      'schedule.tick',
      jsonb_build_object(
        'schedule', jsonb_build_object(
          'automationId', v_row.id,
          'automationName', v_row.name,
          'kind', v_row.schedule_kind,
          'firedAt', now(),
          'timezone', v_row.schedule_timezone
        )
      ),
      'automations',
      v_row.id
    );

    UPDATE automations
       SET schedule_next_run_at = automation_next_schedule_run(
             v_row.schedule_kind, v_row.schedule_minutes, v_row.schedule_hour,
             v_row.schedule_minute, v_row.schedule_weekday, v_row.schedule_timezone, now()
           )
     WHERE id = v_row.id;

    v_emitted := v_emitted + 1;
  END LOOP;

  RETURN v_emitted;
END;
$fn$;

REVOKE ALL ON FUNCTION automation_emit_due_schedules() FROM PUBLIC, anon, authenticated;

/** Recalcula a próxima execução quando o agendamento muda.
 *
 *  Em trigger e não no cliente: o cálculo depende do fuso e do relógio do servidor,
 *  e deixar o navegador enviar `schedule_next_run_at` permitiria adiantar o disparo
 *  de outra empresa mandando uma data no passado. */
CREATE OR REPLACE FUNCTION automation_refresh_schedule()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
BEGIN
  IF NEW.trigger_type <> 'schedule' OR NEW.status <> 'active' THEN
    -- Automação não agendada, ou inativa, não tem próximo disparo. Limpar é o que
    -- tira a linha do índice parcial e do laço do agendador.
    NEW.schedule_next_run_at := NULL;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT'
     OR OLD.status <> 'active'
     OR OLD.schedule_kind IS DISTINCT FROM NEW.schedule_kind
     OR OLD.schedule_minutes IS DISTINCT FROM NEW.schedule_minutes
     OR OLD.schedule_hour IS DISTINCT FROM NEW.schedule_hour
     OR OLD.schedule_minute IS DISTINCT FROM NEW.schedule_minute
     OR OLD.schedule_weekday IS DISTINCT FROM NEW.schedule_weekday
     OR OLD.schedule_timezone IS DISTINCT FROM NEW.schedule_timezone
  THEN
    NEW.schedule_next_run_at := automation_next_schedule_run(
      NEW.schedule_kind, NEW.schedule_minutes, NEW.schedule_hour,
      NEW.schedule_minute, NEW.schedule_weekday, NEW.schedule_timezone, now()
    );
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS automations_refresh_schedule ON automations;
CREATE TRIGGER automations_refresh_schedule
  BEFORE INSERT OR UPDATE ON automations
  FOR EACH ROW EXECUTE FUNCTION automation_refresh_schedule();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Webhook de entrada
--
-- Um segredo por automação, guardado numa tabela inalcançável pelo cliente. A
-- verificação reusa webhookVerification.ts, o mesmo módulo das integrações: HMAC
-- sobre o corpo cru, janela de frescor e unicidade do evento. Os três juntos —
-- assinatura sozinha permite replay, timestamp sozinho permite forja.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS automation_webhook_secrets (
  automation_id uuid PRIMARY KEY REFERENCES automations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  secret text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz
);

ALTER TABLE automation_webhook_secrets ENABLE ROW LEVEL SECURITY;

-- Nenhuma policy, para nenhum comando: a tabela é inalcançável por `authenticated`
-- mesmo com RLS ligada. O cliente cria e lê o segredo por RPC, que devolve o valor
-- UMA vez na criação e nunca mais — mesma disciplina de integration_credentials.
REVOKE ALL ON TABLE automation_webhook_secrets FROM PUBLIC, anon, authenticated;

/** Cria ou rotaciona o segredo e devolve o valor.
 *
 *  É a única vez que o segredo sai do banco para o cliente: quem o perder tem de
 *  rotacionar, porque não há caminho de leitura. Rotacionar invalida o anterior na
 *  hora — é o que torna a rotação útil depois de um vazamento. */
CREATE OR REPLACE FUNCTION automation_create_webhook_secret(p_automation_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_company text;
  v_secret  text;
  v_owner   uuid;
BEGIN
  v_company := get_my_company_id();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Nenhuma empresa ativa na sessão';
  END IF;

  IF get_my_role() <> ALL (ARRAY['owner','admin','manager']) THEN
    RAISE EXCEPTION 'Apenas owner, admin ou manager podem gerar o segredo do webhook';
  END IF;

  SELECT company_id INTO v_owner FROM automations WHERE id = p_automation_id;
  IF v_owner IS NULL OR v_owner::text <> v_company THEN
    -- Mesma resposta para inexistente e de outra empresa.
    RAISE EXCEPTION 'Automação não encontrada';
  END IF;

  v_secret := encode(extensions.gen_random_bytes(32), 'hex');

  INSERT INTO automation_webhook_secrets (automation_id, company_id, secret)
  VALUES (p_automation_id, v_owner, v_secret)
  ON CONFLICT (automation_id) DO UPDATE
    SET secret = excluded.secret, rotated_at = now();

  RETURN v_secret;
END;
$fn$;

REVOKE ALL ON FUNCTION automation_create_webhook_secret(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION automation_create_webhook_secret(uuid) TO authenticated;

/** Existe segredo configurado? Para a tela mostrar o estado sem poder ler o valor. */
CREATE OR REPLACE FUNCTION automation_has_webhook_secret(p_automation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM automation_webhook_secrets s
     WHERE s.automation_id = p_automation_id
       AND s.company_id::text = get_my_company_id()
  );
$fn$;

REVOKE ALL ON FUNCTION automation_has_webhook_secret(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION automation_has_webhook_secret(uuid) TO authenticated;

-- ── Registro das entregas ───────────────────────────────────────────────────
-- Guarda o hash do corpo, não o corpo. É o suficiente para detectar replay e não
-- acumula payload de terceiro no nosso banco.
CREATE TABLE IF NOT EXISTS automation_webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  automation_id uuid NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  payload_hash text NOT NULL,
  event_id uuid REFERENCES automation_events(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('accepted', 'duplicate', 'rejected')),
  reason text,
  received_at timestamptz NOT NULL DEFAULT now()
);

-- A trava de replay. Duas entregas com o mesmo corpo para a mesma automação colidem
-- aqui, e o índice — não uma consulta prévia — é o que resolve concorrência.
CREATE UNIQUE INDEX IF NOT EXISTS automation_webhook_deliveries_replay_idx
  ON automation_webhook_deliveries (automation_id, payload_hash)
  WHERE status = 'accepted';

CREATE INDEX IF NOT EXISTS automation_webhook_deliveries_recent_idx
  ON automation_webhook_deliveries (company_id, received_at DESC);

ALTER TABLE automation_webhook_deliveries ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='automation_webhook_deliveries' AND policyname='automation_webhook_deliveries_select') THEN
    CREATE POLICY automation_webhook_deliveries_select ON automation_webhook_deliveries
      FOR SELECT TO authenticated
      USING ((company_id)::text = get_my_company_id());
  END IF;
END $$;

/** Resolve a automação de um webhook e devolve o segredo, para a função verificar.
 *
 *  Devolve o segredo porque o HMAC precisa ser calculado sobre o corpo cru, que só
 *  a função tem — diferente do segredo do cron, que é comparado dentro do banco.
 *  Só service_role executa. */
CREATE OR REPLACE FUNCTION automation_resolve_webhook(p_automation_id uuid)
RETURNS TABLE (automation_id uuid, company_id uuid, secret text, is_active boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT a.id, a.company_id, s.secret, (a.status = 'active')
    FROM automations a
    JOIN automation_webhook_secrets s ON s.automation_id = a.id
   WHERE a.id = p_automation_id
     AND a.trigger_type = 'webhook';
$fn$;

REVOKE ALL ON FUNCTION automation_resolve_webhook(uuid) FROM PUBLIC, anon, authenticated;

/** Registra a entrega e, quando aceita, emite o evento — na mesma transação.
 *
 *  Juntos de propósito: gravar a entrega e emitir o evento em chamadas separadas
 *  abriria a janela em que a entrega consta como aceita e o evento não existe, ou o
 *  contrário. A colisão do índice de replay devolve `duplicate` sem emitir nada. */
CREATE OR REPLACE FUNCTION automation_accept_webhook(
  p_automation_id uuid,
  p_company_id uuid,
  p_payload_hash text,
  p_payload jsonb
)
RETURNS TABLE (delivery_status text, event_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_event uuid;
BEGIN
  BEGIN
    v_event := automation_emit_event(
      p_company_id, 'webhook.received', coalesce(p_payload, '{}'::jsonb),
      'automation_webhook_deliveries', p_automation_id, NULL, NULL, 0
    );

    INSERT INTO automation_webhook_deliveries (
      company_id, automation_id, payload_hash, event_id, status
    ) VALUES (
      p_company_id, p_automation_id, p_payload_hash, v_event, 'accepted'
    );

    RETURN QUERY SELECT 'accepted'::text, v_event;

  EXCEPTION WHEN unique_violation THEN
    -- Replay. O evento emitido acima morre com o rollback do bloco, então não sobra
    -- evento órfão para o engine consumir.
    INSERT INTO automation_webhook_deliveries (
      company_id, automation_id, payload_hash, status, reason
    ) VALUES (
      p_company_id, p_automation_id, p_payload_hash, 'duplicate', 'replay'
    );

    RETURN QUERY SELECT 'duplicate'::text, NULL::uuid;
  END;
END;
$fn$;

REVOKE ALL ON FUNCTION automation_accept_webhook(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;

/** Registra uma entrega recusada, sem emitir evento.
 *
 *  Só é chamada DEPOIS de a assinatura conferir — uma entrega não autenticada não
 *  grava nada, senão o endereço público viraria um jeito de encher a tabela. */
CREATE OR REPLACE FUNCTION automation_reject_webhook(
  p_automation_id uuid,
  p_company_id uuid,
  p_payload_hash text,
  p_reason text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  INSERT INTO automation_webhook_deliveries (company_id, automation_id, payload_hash, status, reason)
  VALUES (p_company_id, p_automation_id, p_payload_hash, 'rejected', left(coalesce(p_reason, ''), 200));
$fn$;

REVOKE ALL ON FUNCTION automation_reject_webhook(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Agendamento do agendador
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('automation-emit-due-schedules')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'automation-emit-due-schedules');
    -- A cada minuto: o disparo agendado só precisa ser preciso ao minuto, e o custo
    -- é uma consulta sobre um índice parcial que normalmente está vazio.
    PERFORM cron.schedule('automation-emit-due-schedules', '* * * * *',
      $cron$SELECT automation_emit_due_schedules();$cron$);
  END IF;
END $$;

COMMENT ON COLUMN automations.schedule_next_run_at IS
  'Materializado pelo trigger automations_refresh_schedule. Nunca aceito do cliente: uma data no passado enviada pelo navegador adiantaria o disparo.';
COMMENT ON TABLE automation_webhook_secrets IS
  'Segredo HMAC por automação. Sem policy para authenticated — o valor sai uma vez na criação, via RPC, e nunca mais.';
