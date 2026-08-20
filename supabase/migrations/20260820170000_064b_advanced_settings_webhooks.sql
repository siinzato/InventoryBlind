/*
# Configurações Avançadas — Webhooks de saída (Fase 2/3)

## Summary
Webhooks configurados pela própria empresa para receber notificação de
eventos reais do InventoryBlind. Reaproveita padrões já provados no projeto:

- Segredo write-only, mesma postura de `integration_webhook_secrets`
  (migration 045): guardado numa tabela separada, sem policy de SELECT para
  `authenticated`, só acessível a quem já validou papel/empresa dentro de uma
  RPC SECURITY DEFINER.
- Fila com `FOR UPDATE SKIP LOCKED`, mesmo padrão de `integration_claim_due_jobs`
  (migration 045) — dois workers nunca processam a mesma entrega.
- Disparo por pg_cron + pg_net batendo na Edge Function, segredo no Vault
  comparado em tempo constante — mesmo padrão de `automation_dispatch_pending`/
  `automation_verify_cron_secret` (migration 052). Reaproveita até a MESMA
  linha de configuração (`automation_runtime_config.functions_base_url`) em vez
  de duplicar uma tabela só para isso.

## Por que os eventos nascem de RPC, não de um trigger em audit_logs
audit_logs aceita INSERT de qualquer usuário autenticado sem validar que o
company_id enviado é o dele (política pré-existente, fora do escopo desta
tarefa). Um trigger nessa tabela transformaria essa lacuna em amplificador:
qualquer usuário autenticado poderia forjar uma linha e fazer o servidor
disparar uma chamada HTTP real para a URL configurada por OUTRA empresa. Por
isso o enfileiramento (`company_webhook_enqueue_event`) só é chamado de
dentro de RPCs que já resolvem company_id a partir do usuário autenticado no
servidor (ver migration 065) — nunca a partir de uma tabela gravável pelo
cliente.
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. company_webhooks
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS company_webhooks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        text NOT NULL,
  url         text NOT NULL,
  events      text[] NOT NULL DEFAULT '{}',
  is_active   boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS company_webhooks_company_idx ON company_webhooks (company_id);

ALTER TABLE company_webhooks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company_webhooks_select" ON company_webhooks;
CREATE POLICY "company_webhooks_select" ON company_webhooks FOR SELECT
  TO authenticated
  USING (company_id::text = get_my_company_id() AND get_my_role() IN ('owner','admin'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. company_webhook_secrets — write-only, mesma postura da 045
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS company_webhook_secrets (
  webhook_id uuid PRIMARY KEY REFERENCES company_webhooks(id) ON DELETE CASCADE,
  secret     text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE company_webhook_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON company_webhook_secrets FROM authenticated, anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. company_webhook_deliveries — log de tentativas + fila de reentrega
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS company_webhook_deliveries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id      uuid NOT NULL REFERENCES company_webhooks(id) ON DELETE CASCADE,
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  event_type      text NOT NULL,
  payload         jsonb NOT NULL DEFAULT '{}',
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','delivered','failed','exhausted')),
  attempt_count   integer NOT NULL DEFAULT 0,
  http_status     integer,
  error_message   text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  delivered_at    timestamptz
);

-- Fila: só entregas pendentes e já vencidas entram no índice parcial.
CREATE INDEX IF NOT EXISTS company_webhook_deliveries_due_idx
  ON company_webhook_deliveries (next_attempt_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS company_webhook_deliveries_webhook_idx
  ON company_webhook_deliveries (webhook_id, created_at DESC);

ALTER TABLE company_webhook_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company_webhook_deliveries_select" ON company_webhook_deliveries;
CREATE POLICY "company_webhook_deliveries_select" ON company_webhook_deliveries FOR SELECT
  TO authenticated
  USING (company_id::text = get_my_company_id() AND get_my_role() IN ('owner','admin'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Lista fechada de eventos suportados (ver migration 065 pra quem produz
--    cada um). Adicionar um evento novo é editar esta função + hookar a RPC
--    de origem — nunca abrir o cadastro para qualquer string.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION company_webhook_allowed_events()
RETURNS text[]
LANGUAGE sql IMMUTABLE
AS $$
  SELECT ARRAY['physical_count.finalized','physical_count.approved']::text[]
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. CRUD — SECURITY DEFINER, revalida papel/empresa/URL/eventos no servidor
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION company_webhook_create(p_name text, p_url text, p_events text[])
RETURNS TABLE(id uuid, secret text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_company   uuid;
  v_role      text;
  v_secret    text;
  v_id        uuid;
  v_bad_event text;
BEGIN
  v_role := get_my_role();
  IF v_role IS NULL OR v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Apenas owner ou admin podem configurar webhooks.';
  END IF;
  v_company := get_my_company_id()::uuid;

  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'Informe um nome para o webhook.';
  END IF;
  -- HTTPS sempre, exceto localhost em desenvolvimento (pedido explícito) —
  -- mesma exceção que validateWebhookUrl (automation-run) já concede.
  IF p_url IS NULL OR NOT (p_url ~ '^https://' OR p_url ~ '^http://localhost([:/]|$)' OR p_url ~ '^http://127\.0\.0\.1([:/]|$)') THEN
    RAISE EXCEPTION 'A URL precisa usar HTTPS (ou http://localhost em desenvolvimento).';
  END IF;
  IF p_events IS NULL OR array_length(p_events, 1) IS NULL THEN
    RAISE EXCEPTION 'Selecione ao menos um evento.';
  END IF;
  SELECT e INTO v_bad_event FROM unnest(p_events) e
    WHERE e <> ALL (company_webhook_allowed_events()) LIMIT 1;
  IF v_bad_event IS NOT NULL THEN
    RAISE EXCEPTION 'Evento não suportado: %', v_bad_event;
  END IF;

  v_secret := encode(extensions.gen_random_bytes(32), 'hex');

  INSERT INTO company_webhooks (company_id, name, url, events, created_by)
  VALUES (v_company, trim(p_name), p_url, p_events, auth.uid())
  RETURNING company_webhooks.id INTO v_id;

  INSERT INTO company_webhook_secrets (webhook_id, secret) VALUES (v_id, v_secret);

  RETURN QUERY SELECT v_id, v_secret;
END;
$$;

REVOKE ALL ON FUNCTION company_webhook_create(text, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION company_webhook_create(text, text, text[]) TO authenticated;

CREATE OR REPLACE FUNCTION company_webhook_update(p_id uuid, p_name text, p_url text, p_events text[], p_is_active boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_company   uuid;
  v_role      text;
  v_bad_event text;
BEGIN
  v_role := get_my_role();
  IF v_role IS NULL OR v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Apenas owner ou admin podem configurar webhooks.';
  END IF;
  v_company := get_my_company_id()::uuid;

  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'Informe um nome para o webhook.';
  END IF;
  IF p_url IS NULL OR NOT (p_url ~ '^https://' OR p_url ~ '^http://localhost([:/]|$)' OR p_url ~ '^http://127\.0\.0\.1([:/]|$)') THEN
    RAISE EXCEPTION 'A URL precisa usar HTTPS (ou http://localhost em desenvolvimento).';
  END IF;
  IF p_events IS NULL OR array_length(p_events, 1) IS NULL THEN
    RAISE EXCEPTION 'Selecione ao menos um evento.';
  END IF;
  SELECT e INTO v_bad_event FROM unnest(p_events) e
    WHERE e <> ALL (company_webhook_allowed_events()) LIMIT 1;
  IF v_bad_event IS NOT NULL THEN
    RAISE EXCEPTION 'Evento não suportado: %', v_bad_event;
  END IF;

  UPDATE company_webhooks
  SET name = trim(p_name), url = p_url, events = p_events,
      is_active = coalesce(p_is_active, is_active), updated_at = now()
  WHERE id = p_id AND company_id = v_company;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Webhook não encontrado.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION company_webhook_update(uuid, text, text, text[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION company_webhook_update(uuid, text, text, text[], boolean) TO authenticated;

CREATE OR REPLACE FUNCTION company_webhook_delete(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_company uuid;
  v_role    text;
BEGIN
  v_role := get_my_role();
  IF v_role IS NULL OR v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Apenas owner ou admin podem remover webhooks.';
  END IF;
  v_company := get_my_company_id()::uuid;

  DELETE FROM company_webhooks WHERE id = p_id AND company_id = v_company;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Webhook não encontrado.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION company_webhook_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION company_webhook_delete(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION company_webhook_rotate_secret(p_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_company uuid;
  v_role    text;
  v_secret  text;
BEGIN
  v_role := get_my_role();
  IF v_role IS NULL OR v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Apenas owner ou admin podem rotacionar o segredo.';
  END IF;
  v_company := get_my_company_id()::uuid;

  IF NOT EXISTS (SELECT 1 FROM company_webhooks WHERE id = p_id AND company_id = v_company) THEN
    RAISE EXCEPTION 'Webhook não encontrado.';
  END IF;

  v_secret := encode(extensions.gen_random_bytes(32), 'hex');
  UPDATE company_webhook_secrets SET secret = v_secret, updated_at = now() WHERE webhook_id = p_id;

  RETURN v_secret;
END;
$$;

REVOKE ALL ON FUNCTION company_webhook_rotate_secret(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION company_webhook_rotate_secret(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Enfileirar entrega — chamada só por RPCs privilegiadas (ver acima o
--    porquê de nunca ser acionada por uma tabela gravável pelo cliente).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION company_webhook_enqueue_event(p_company_id uuid, p_event_type text, p_payload jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO company_webhook_deliveries (webhook_id, company_id, event_type, payload)
  SELECT w.id, p_company_id, p_event_type, p_payload
  FROM company_webhooks w
  WHERE w.company_id = p_company_id
    AND w.is_active
    AND p_event_type = ANY (w.events);
END;
$$;

REVOKE ALL ON FUNCTION company_webhook_enqueue_event(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. "Enviar teste" — o botão da tela enfileira uma entrega sintética,
--    entregue pelo MESMO caminho de disparo real (não é um preview simulado).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION company_webhook_send_test(p_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_company     uuid;
  v_role        text;
  v_delivery_id uuid;
BEGIN
  v_role := get_my_role();
  IF v_role IS NULL OR v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Apenas owner ou admin podem enviar um teste.';
  END IF;
  v_company := get_my_company_id()::uuid;

  IF NOT EXISTS (SELECT 1 FROM company_webhooks WHERE id = p_id AND company_id = v_company) THEN
    RAISE EXCEPTION 'Webhook não encontrado.';
  END IF;

  INSERT INTO company_webhook_deliveries (webhook_id, company_id, event_type, payload)
  VALUES (p_id, v_company, 'webhook.test', jsonb_build_object('message', 'Disparo de teste do InventoryBlind.'))
  RETURNING id INTO v_delivery_id;

  RETURN v_delivery_id;
END;
$$;

REVOKE ALL ON FUNCTION company_webhook_send_test(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION company_webhook_send_test(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Fila — claim atômico para o worker (Edge Function webhook-dispatch,
--    service_role). Mesmo padrão de integration_claim_due_jobs (045): dois
--    disparos do cron nunca processam a mesma entrega.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION company_webhook_claim_due_deliveries(p_limit integer DEFAULT 20)
RETURNS SETOF company_webhook_deliveries
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH claimable AS (
    SELECT d.id FROM company_webhook_deliveries d
     WHERE d.status = 'pending' AND d.next_attempt_at <= now()
     ORDER BY d.next_attempt_at
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  )
  UPDATE company_webhook_deliveries d
     SET attempt_count = d.attempt_count + 1
    FROM claimable c
   WHERE d.id = c.id
  RETURNING d.*;
END;
$$;

-- Só o worker (service_role) reivindica entregas. Nunca o navegador.
REVOKE ALL ON FUNCTION company_webhook_claim_due_deliveries(integer) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Registrar o resultado de uma tentativa — reentrega limitada (3 no
--    total), backoff curto, nunca um loop infinito.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION company_webhook_record_attempt(
  p_delivery_id uuid,
  p_success     boolean,
  p_http_status integer,
  p_error       text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_attempts integer;
BEGIN
  SELECT attempt_count INTO v_attempts FROM company_webhook_deliveries WHERE id = p_delivery_id;

  IF p_success THEN
    UPDATE company_webhook_deliveries
       SET status = 'delivered', http_status = p_http_status, error_message = NULL, delivered_at = now()
     WHERE id = p_delivery_id;
    RETURN;
  END IF;

  IF v_attempts >= 3 THEN
    UPDATE company_webhook_deliveries
       SET status = 'exhausted', http_status = p_http_status, error_message = p_error
     WHERE id = p_delivery_id;
  ELSE
    UPDATE company_webhook_deliveries
       SET status = 'pending', http_status = p_http_status, error_message = p_error,
           -- Backoff curto e fixo (1min, depois 5min): poucas tentativas, sem
           -- crescimento exponencial que faria a 3ª rodar muito depois do
           -- evento perder relevância para quem escuta.
           next_attempt_at = now() + CASE v_attempts WHEN 1 THEN interval '1 minute' ELSE interval '5 minutes' END
     WHERE id = p_delivery_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION company_webhook_record_attempt(uuid, boolean, integer, text) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Segredo do cron (Vault) + verificação em tempo constante — cópia do
--     padrão de automation_verify_cron_secret (052), trust boundary própria
--     (um segredo por sistema de fila, não compartilhado entre automações e
--     webhooks de configurações avançadas).
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'company_webhook_cron_secret') THEN
    PERFORM vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'company_webhook_cron_secret',
      'Segredo que o cron apresenta à Edge Function webhook-dispatch. Gerado pelo banco; nunca sai do Vault.'
    );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION company_webhook_verify_cron_secret(p_candidate text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_secret text;
  v_diff   integer := 0;
  v_len    integer;
BEGIN
  IF p_candidate IS NULL OR length(p_candidate) = 0 THEN
    RETURN false;
  END IF;

  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'company_webhook_cron_secret';
  IF v_secret IS NULL THEN
    RETURN false;
  END IF;

  IF length(p_candidate) <> length(v_secret) THEN
    v_diff := 1;
  END IF;

  v_len := least(length(p_candidate), length(v_secret));
  FOR i IN 1..v_len LOOP
    v_diff := v_diff + (get_byte(convert_to(substr(p_candidate, i, 1), 'UTF8'), 0)
                      # get_byte(convert_to(substr(v_secret, i, 1), 'UTF8'), 0));
  END LOOP;

  RETURN v_diff = 0;
END;
$fn$;

REVOKE ALL ON FUNCTION company_webhook_verify_cron_secret(text) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. Disparo — reaproveita automation_runtime_config.functions_base_url
--     (052) em vez de duplicar uma tabela só para guardar a mesma URL.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION company_webhook_dispatch_pending()
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_pending integer;
  v_url     text;
  v_secret  text;
  v_request bigint;
BEGIN
  SELECT count(*) INTO v_pending
    FROM company_webhook_deliveries
   WHERE status = 'pending' AND next_attempt_at <= now();
  IF v_pending = 0 THEN
    RETURN NULL;
  END IF;

  SELECT value INTO v_url FROM automation_runtime_config WHERE key = 'functions_base_url';
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'company_webhook_cron_secret';

  IF v_url IS NULL OR v_secret IS NULL THEN
    RAISE WARNING 'company_webhook_dispatch_pending: configuração ausente (url=%, segredo=%)',
      v_url IS NOT NULL, v_secret IS NOT NULL;
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url => v_url || '/webhook-dispatch',
    body => jsonb_build_object('mode', 'cron'),
    headers => jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-cron-secret', v_secret
    ),
    timeout_milliseconds => 55000
  ) INTO v_request;

  RETURN v_request;
END;
$fn$;

REVOKE ALL ON FUNCTION company_webhook_dispatch_pending() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('company-webhook-dispatch-pending')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'company-webhook-dispatch-pending');
    PERFORM cron.schedule('company-webhook-dispatch-pending', '* * * * *',
      $cron$SELECT company_webhook_dispatch_pending();$cron$);
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. updated_at trigger
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
    DROP TRIGGER IF EXISTS company_webhooks_updated_at ON company_webhooks;
    CREATE TRIGGER company_webhooks_updated_at
      BEFORE UPDATE ON company_webhooks
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

COMMENT ON FUNCTION company_webhook_dispatch_pending() IS
  'Chamada pelo cron a cada minuto. Só faz HTTP quando existe entrega pendente. O segredo vem do Vault e nunca sai do banco.';
