/*
# Jobs, Webhooks, Segurança e Observabilidade (Fase 4)

## Summary
Operational infrastructure so a sync can run without a browser open: webhook
receipt with replay protection, a claimable job queue for the scheduler, rate
limit state per connection, and an alert table.

## Architecture chosen, and why
The project has no worker infrastructure, so the options were Edge Functions +
pg_cron, or an external queue. Edge Functions + pg_cron wins here: it adds no new
service to operate, keeps every privileged operation inside the same trust
boundary already established in Fase 1, and pg_cron is available on Supabase
Postgres. A real queue (pgmq/SQS) is worth it once throughput demands it; this
schema does not prevent that move because the job table already models claiming.

## Replay protection
`integration_webhook_events` (migration 042) already carries
UNIQUE (provider_key, external_event_id), which is the replay guard: a redelivered
event violates the constraint and is discarded rather than processed twice. This
migration adds what 042 lacked for a real endpoint:
  - `payload_hash`     so a duplicate can be recognised even when a provider sends
                       no event id, and so payload equality is provable without
                       storing the payload
  - `signature_header` the raw signature we verified against, for forensics
  - `provider_timestamp` + a freshness window, so a captured request cannot be
                       replayed weeks later even with a valid signature
  - `attempts`         redeliveries of the SAME event are counted, not lost

## Payload storage
`payload` stays nullable and is meant to hold only what the handler needs. The
hash is always stored; the body is not required. A webhook body can carry customer
names, addresses and order values, and keeping it forever in a table every
owner/admin can read is a liability with no operational payoff once the event is
processed. `prune_processed_webhook_payloads()` clears bodies after a retention
window while keeping the audit row.

## No credential ever reaches these tables
Webhook secrets live in `integration_webhook_secrets`, which follows the same
pattern as integration_credentials: RLS on, no policy for `authenticated`, grants
revoked. Only the receiver (service_role, server-side) reads it.
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. integration_webhook_events — columns a real endpoint needs
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE integration_webhook_events
  -- SHA-256 of the raw body. Lets us detect a duplicate from a provider that sends
  -- no event id, and prove two deliveries were identical without keeping either.
  ADD COLUMN IF NOT EXISTS payload_hash text,
  ADD COLUMN IF NOT EXISTS signature_header text,
  -- The provider's own timestamp, used for the freshness window below.
  ADD COLUMN IF NOT EXISTS provider_timestamp timestamptz,
  -- Deliveries of the same event. A provider retrying because we answered slowly
  -- is normal; a count climbing into the dozens is a broken handler.
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS error_kind text,
  -- Set when the event produced a sync job, so an event can be traced to its work.
  ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES integration_sync_runs(id) ON DELETE SET NULL;

-- Second replay guard, for providers with no event id: same connection, same
-- topic, same body. Partial so it only constrains rows that actually have a hash.
CREATE UNIQUE INDEX IF NOT EXISTS integration_webhook_events_hash_unique_idx
  ON integration_webhook_events (provider_key, connection_id, event_type, payload_hash)
  WHERE payload_hash IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. integration_webhook_secrets — unreachable through the API
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS integration_webhook_secrets (
  connection_id  uuid PRIMARY KEY REFERENCES integration_connections(id) ON DELETE CASCADE,
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  /** Shared secret used to verify the signature. Same storage posture as
   *  integration_credentials: defence by unreachability, documented in 042. */
  secret         text NOT NULL,
  /** Provider's id for the registered webhook, so it can be removed later. */
  external_webhook_id text,
  topics         text[] NOT NULL DEFAULT '{}',
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);

ALTER TABLE integration_webhook_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON integration_webhook_secrets FROM authenticated, anon;

/** Write-only, exactly like integration_set_credential: a secret can be stored and
 *  never read back by the client. */
CREATE OR REPLACE FUNCTION integration_set_webhook_secret(
  p_connection_id uuid,
  p_secret        text,
  p_topics        text[] DEFAULT '{}'
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_company uuid;
BEGIN
  IF get_my_role() IS NULL OR get_my_role() NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Apenas owner ou admin podem configurar webhooks.';
  END IF;

  IF p_secret IS NULL OR length(trim(p_secret)) = 0 THEN
    RAISE EXCEPTION 'Segredo de webhook vazio.';
  END IF;

  SELECT company_id INTO v_company FROM integration_connections WHERE id = p_connection_id;
  IF v_company IS NULL OR v_company::text <> get_my_company_id() THEN
    RAISE EXCEPTION 'Conexão não encontrada nesta empresa.';
  END IF;

  INSERT INTO integration_webhook_secrets (connection_id, company_id, secret, topics, updated_at)
  VALUES (p_connection_id, v_company, p_secret, coalesce(p_topics, '{}'), now())
  ON CONFLICT (connection_id) DO UPDATE
    SET secret = EXCLUDED.secret, topics = EXCLUDED.topics, updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION integration_set_webhook_secret(uuid, text, text[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION integration_set_webhook_secret(uuid, text, text[]) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Job claiming — the scheduler's primitive
--
-- Two workers must never run the same job. `FOR UPDATE SKIP LOCKED` is the
-- standard Postgres answer: the first transaction locks the row, the second skips
-- it instead of blocking, and neither ends up duplicating a sync. Doing this check
-- in application code would race.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION integration_claim_due_jobs(p_limit integer DEFAULT 5)
RETURNS SETOF integration_sync_runs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH claimable AS (
    SELECT r.id
      FROM integration_sync_runs r
     WHERE r.status = 'pending'
     ORDER BY r.started_at
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  )
  UPDATE integration_sync_runs r
     SET status = 'running'
    FROM claimable c
   WHERE r.id = c.id
  RETURNING r.*;
END;
$$;

-- Only the scheduler (service_role) claims jobs. Never the browser.
REVOKE ALL ON FUNCTION integration_claim_due_jobs(integer) FROM public, anon, authenticated;

/** Enqueue the syncs whose interval has elapsed.
 *
 *  Called by pg_cron. Deliberately enqueues rather than executes: the Edge Function
 *  does the work, and the database's job is only to decide *when*. That keeps a long
 *  provider call out of a cron transaction.
 *
 *  A connection already holding a pending or running job is skipped — an overlapping
 *  schedule must not stack jobs behind a slow provider until the queue is unusable. */
CREATE OR REPLACE FUNCTION integration_enqueue_due_syncs()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_enqueued integer := 0;
  v_connection record;
BEGIN
  FOR v_connection IN
    SELECT c.id, c.company_id, c.sync_interval_minutes, c.last_sync_at
      FROM integration_connections c
     WHERE c.auto_sync_enabled = true
       AND c.status = 'active'
       AND c.credentials_set_at IS NOT NULL
       AND c.sync_interval_minutes IS NOT NULL
       AND (
         c.last_sync_at IS NULL
         OR c.last_sync_at < now() - make_interval(mins => c.sync_interval_minutes)
       )
       AND NOT EXISTS (
         SELECT 1 FROM integration_sync_runs r
          WHERE r.connection_id = c.id
            AND r.status IN ('pending','running')
       )
  LOOP
    INSERT INTO integration_sync_runs (
      company_id, connection_id, sync_type, direction, entity_type,
      trigger_source, status
    ) VALUES (
      v_connection.company_id, v_connection.id, 'incremental', 'inbound', 'stock',
      'schedule', 'pending'
    );
    v_enqueued := v_enqueued + 1;
  END LOOP;

  RETURN v_enqueued;
END;
$$;

REVOKE ALL ON FUNCTION integration_enqueue_due_syncs() FROM public, anon, authenticated;

/** Release jobs a dead worker left behind.
 *
 *  A function killed mid-run leaves `running` forever, and the connection is then
 *  skipped by the enqueuer above — the integration silently stops syncing. Anything
 *  running for longer than the window is failed so the next cycle can retry it. */
CREATE OR REPLACE FUNCTION integration_reap_stuck_jobs(p_stale_minutes integer DEFAULT 30)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH stuck AS (
    UPDATE integration_sync_runs
       SET status = 'failed',
           error_summary = coalesce(error_summary, '') ||
             ' Job interrompido: nenhum worker concluiu dentro da janela esperada.',
           finished_at = now()
     WHERE status = 'running'
       AND started_at < now() - make_interval(mins => p_stale_minutes)
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM stuck;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION integration_reap_stuck_jobs(integer) FROM public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Rate limit state, per connection and operation
--
-- Survives between invocations: an Edge Function is stateless, so what the provider
-- told us about our remaining budget would otherwise be forgotten on every cold
-- start and every run would walk into the same 429.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS integration_rate_limit_state (
  connection_id   uuid NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
  /** '*' for a provider-wide bucket, or a specific operation when the provider
   *  meters them separately. */
  operation       text NOT NULL DEFAULT '*',
  remaining       integer,
  limit_value     integer,
  reset_at        timestamptz,
  /** When the provider last told us to back off. */
  retry_after_until timestamptz,
  observed_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (connection_id, operation)
);

ALTER TABLE integration_rate_limit_state ENABLE ROW LEVEL SECURITY;

-- Readable so the UI can explain "aguardando limite do provedor"; written only
-- server-side.
DROP POLICY IF EXISTS "integration_rate_limit_select" ON integration_rate_limit_state;
CREATE POLICY "integration_rate_limit_select" ON integration_rate_limit_state FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM integration_connections c
     WHERE c.id = integration_rate_limit_state.connection_id
       AND c.company_id::text = get_my_company_id()
  ));

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Alerts
--
-- Detection is a query over data we already record; the value of a table is that
-- an alert can be acknowledged and stop shouting. Unacknowledged alerts of the same
-- kind collapse onto one row so a provider outage does not generate one alert per
-- failed run.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS integration_alerts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL DEFAULT get_my_company_id()::uuid
                  REFERENCES companies(id) ON DELETE CASCADE,
  connection_id uuid REFERENCES integration_connections(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN (
                  'integration_offline',      -- repeated connection failures
                  'credential_expired',
                  'sync_failing',             -- N consecutive failed runs
                  'rate_limited',
                  'webhook_broken',           -- deliveries arriving, none processed
                  'pending_conflicts',        -- review queue not being worked
                  'unmapped_deposits',
                  'stale_sync'                -- auto-sync on, nothing for too long
                )),
  severity      text NOT NULL DEFAULT 'warning' CHECK (severity IN ('info','warning','critical')),
  message       text NOT NULL,
  /** Non-sensitive supporting numbers: counts, timestamps, error kinds. Never a
   *  payload and never a credential. */
  context       jsonb NOT NULL DEFAULT '{}',
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  occurrences   integer NOT NULL DEFAULT 1,
  acknowledged_by uuid,
  acknowledged_at timestamptz,
  resolved_at   timestamptz,
  created_at    timestamptz DEFAULT now()
);

-- One open alert per kind per connection. A provider down for an hour is one
-- problem, not sixty.
CREATE UNIQUE INDEX IF NOT EXISTS integration_alerts_open_unique_idx
  ON integration_alerts (company_id, connection_id, kind)
  WHERE status <> 'resolved';

CREATE INDEX IF NOT EXISTS integration_alerts_open_idx
  ON integration_alerts (company_id, status, severity, last_seen_at DESC);

ALTER TABLE integration_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "integration_alerts_select" ON integration_alerts;
CREATE POLICY "integration_alerts_select" ON integration_alerts FOR SELECT
  TO authenticated USING (company_id::text = get_my_company_id());

-- Acknowledging is a decision; inserting is the system's job (service_role).
DROP POLICY IF EXISTS "integration_alerts_update" ON integration_alerts;
CREATE POLICY "integration_alerts_update" ON integration_alerts FOR UPDATE
  TO authenticated
  USING (company_id::text = get_my_company_id() AND get_my_role() IN ('owner','admin','manager'))
  WITH CHECK (company_id::text = get_my_company_id() AND get_my_role() IN ('owner','admin','manager'));

/** Raise or refresh an alert. Idempotent by (company, connection, kind). */
CREATE OR REPLACE FUNCTION integration_raise_alert(
  p_company_id    uuid,
  p_connection_id uuid,
  p_kind          text,
  p_severity      text,
  p_message       text,
  p_context       jsonb DEFAULT '{}'
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO integration_alerts (
    company_id, connection_id, kind, severity, message, context
  ) VALUES (
    p_company_id, p_connection_id, p_kind, p_severity, p_message, coalesce(p_context, '{}')
  )
  ON CONFLICT (company_id, connection_id, kind) WHERE status <> 'resolved'
  DO UPDATE SET
    last_seen_at = now(),
    occurrences  = integration_alerts.occurrences + 1,
    severity     = EXCLUDED.severity,
    message      = EXCLUDED.message,
    context      = EXCLUDED.context,
    -- An acknowledged alert that keeps happening is re-opened: acknowledging is
    -- "I have seen this", not "stop telling me".
    status       = CASE WHEN integration_alerts.status = 'acknowledged' THEN 'open'
                        ELSE integration_alerts.status END;
END;
$$;

REVOKE ALL ON FUNCTION integration_raise_alert(uuid, uuid, text, text, text, jsonb) FROM public, anon, authenticated;

/** Close an alert when the underlying condition clears. */
CREATE OR REPLACE FUNCTION integration_resolve_alert(
  p_connection_id uuid,
  p_kind          text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE integration_alerts
     SET status = 'resolved', resolved_at = now()
   WHERE connection_id = p_connection_id
     AND kind = p_kind
     AND status <> 'resolved';
END;
$$;

REVOKE ALL ON FUNCTION integration_resolve_alert(uuid, text) FROM public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Payload retention
--
-- Keeps the audit row and the hash, drops the body. A webhook body can carry
-- customer names, addresses and order values; retaining it indefinitely in a table
-- every owner/admin can read is a liability with no operational value once the
-- event is processed.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION prune_processed_webhook_payloads(p_retain_days integer DEFAULT 7)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH pruned AS (
    UPDATE integration_webhook_events
       SET payload = NULL
     WHERE payload IS NOT NULL
       AND status IN ('processed','ignored')
       AND received_at < now() - make_interval(days => p_retain_days)
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM pruned;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION prune_processed_webhook_payloads(integer) FROM public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Scheduling
--
-- Registered only when pg_cron is actually installed, so this migration applies
-- cleanly on a project without it. Without pg_cron the same three functions can be
-- driven by any external scheduler hitting an Edge Function — the schema does not
-- depend on which.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('integration-enqueue-due-syncs')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'integration-enqueue-due-syncs');
    PERFORM cron.schedule('integration-enqueue-due-syncs', '*/5 * * * *',
      $cron$SELECT integration_enqueue_due_syncs();$cron$);

    PERFORM cron.unschedule('integration-reap-stuck-jobs')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'integration-reap-stuck-jobs');
    PERFORM cron.schedule('integration-reap-stuck-jobs', '*/15 * * * *',
      $cron$SELECT integration_reap_stuck_jobs(30);$cron$);

    PERFORM cron.unschedule('integration-prune-webhook-payloads')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'integration-prune-webhook-payloads');
    PERFORM cron.schedule('integration-prune-webhook-payloads', '17 3 * * *',
      $cron$SELECT prune_processed_webhook_payloads(7);$cron$);
  ELSE
    RAISE NOTICE 'pg_cron não está instalado: as funções de agendamento foram criadas, mas nenhum cron foi registrado. Habilite pg_cron ou chame integration_enqueue_due_syncs() por um agendador externo.';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. updated_at trigger
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
    DROP TRIGGER IF EXISTS integration_webhook_secrets_updated_at ON integration_webhook_secrets;
    CREATE TRIGGER integration_webhook_secrets_updated_at
      BEFORE UPDATE ON integration_webhook_secrets
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;
