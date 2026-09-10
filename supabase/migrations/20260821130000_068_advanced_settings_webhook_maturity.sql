/*
# Configurações Avançadas > Webhooks — catálogo real de eventos, observabilidade
# de entrega e reentrega progressiva

## Summary
Evolui as migrations 064/065. Três frentes:

1. **Catálogo de eventos** sai de 2 para 5. Cada evento novo só entra porque
   existe um ponto de disparo confiável — uma RPC SECURITY DEFINER que já
   resolve empresa e papel a partir do usuário autenticado no servidor:
     - `physical_count.started`              → pc_start_session
     - `physical_count.cancelled`            → pc_admin_delete_session
     - `physical_count.divergence_detected`  → pc_finalize_session (quando há divergência)
   Eventos de Auditoria/Risco/Inteligência ficaram DE FORA de propósito: esses
   módulos são calculados no cliente a partir de leitura, sem uma RPC de
   escrita que sirva de fonte confiável. Cadastrá-los na tela criaria opções
   que nunca disparariam.

2. **Observabilidade da entrega**: duração de cada tentativa e o resultado da
   última entrega no próprio webhook (a lista da tela precisa dessa informação
   sem varrer o histórico inteiro).

3. **Reentrega**: de 3 para 5 tentativas, com atraso progressivo, e a
   distinção entre falha recuperável e definitiva — um 404/403 do destino não
   fica sendo repetido cinco vezes.

## Compatibilidade
Colunas novas são nullable. Os dois eventos da v1 continuam na lista e nos
mesmos pontos de disparo. `pc_approve_session` NÃO é redeclarada aqui (nada
muda nela). Os corpos de `pc_start_session`, `pc_admin_delete_session` e
`pc_finalize_session` foram lidos da definição VIVA do banco antes desta
migration e são reproduzidos integralmente — a única diferença é o bloco de
enfileiramento, sempre isolado num BEGIN/EXCEPTION que não pode derrubar a
operação principal.
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Observabilidade da entrega
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE company_webhook_deliveries
  ADD COLUMN IF NOT EXISTS duration_ms integer;

ALTER TABLE company_webhooks
  ADD COLUMN IF NOT EXISTS last_delivery_at          timestamptz,
  ADD COLUMN IF NOT EXISTS last_delivery_status      text,
  ADD COLUMN IF NOT EXISTS last_delivery_http_status integer;

COMMENT ON COLUMN company_webhooks.last_delivery_status IS
  'Resultado da última TENTATIVA (delivered/failed) — resumo para a lista, o histórico completo fica em company_webhook_deliveries.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Catálogo fechado de eventos — fonte única no servidor. A tela espelha
--    esta lista (src/lib/settings/webhookEvents.ts); o servidor é quem manda.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION company_webhook_allowed_events()
RETURNS text[]
LANGUAGE sql IMMUTABLE
AS $$
  SELECT ARRAY[
    'physical_count.started',
    'physical_count.finalized',
    'physical_count.approved',
    'physical_count.cancelled',
    'physical_count.divergence_detected'
  ]::text[]
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Ativar/desativar sem reenviar o formulário inteiro
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION company_webhook_set_active(p_id uuid, p_is_active boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_company uuid;
  v_role    text;
BEGIN
  v_role := get_my_role();
  IF v_role IS NULL OR v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Apenas owner ou admin podem configurar webhooks.';
  END IF;
  v_company := get_my_company_id()::uuid;

  UPDATE company_webhooks
     SET is_active = coalesce(p_is_active, is_active), updated_at = now()
   WHERE id = p_id AND company_id = v_company;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Webhook não encontrado.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION company_webhook_set_active(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION company_webhook_set_active(uuid, boolean) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Reentrega — 5 tentativas, atraso progressivo, falha definitiva não repete
--
--    DROP + CREATE: dois parâmetros novos com DEFAULT. Mantendo a versão de 4
--    argumentos, uma chamada nomeada com 4 argumentos (a Edge Function ainda
--    implantada durante o deploy) ficaria ambígua; removendo-a, essa mesma
--    chamada resolve para a função nova usando os DEFAULT.
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS company_webhook_record_attempt(uuid, boolean, integer, text);

CREATE OR REPLACE FUNCTION company_webhook_record_attempt(
  p_delivery_id uuid,
  p_success     boolean,
  p_http_status integer,
  p_error       text,
  p_duration_ms integer DEFAULT NULL,
  p_retryable   boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_attempts   integer;
  v_webhook_id uuid;
  v_max_attempts constant integer := 5;
BEGIN
  SELECT attempt_count, webhook_id INTO v_attempts, v_webhook_id
    FROM company_webhook_deliveries WHERE id = p_delivery_id;

  IF v_webhook_id IS NULL THEN
    RETURN;
  END IF;

  IF p_success THEN
    UPDATE company_webhook_deliveries
       SET status = 'delivered', http_status = p_http_status, error_message = NULL,
           duration_ms = p_duration_ms, delivered_at = now()
     WHERE id = p_delivery_id;
  ELSIF coalesce(p_retryable, true) = false OR v_attempts >= v_max_attempts THEN
    -- Ou o destino respondeu algo que não muda com o tempo (404, 401, 410…),
    -- ou já gastamos as cinco tentativas. Nos dois casos, parar é o certo.
    UPDATE company_webhook_deliveries
       SET status = 'exhausted', http_status = p_http_status, error_message = p_error,
           duration_ms = p_duration_ms
     WHERE id = p_delivery_id;
  ELSE
    UPDATE company_webhook_deliveries
       SET status = 'pending', http_status = p_http_status, error_message = p_error,
           duration_ms = p_duration_ms,
           -- Progressivo, mas limitado: 1min, 5min, 15min, 1h. A quinta
           -- tentativa acontece dentro de ~1h20 do evento — tarde o bastante
           -- para um destino se recuperar, cedo o bastante para o dado ainda
           -- ser útil a quem escuta.
           next_attempt_at = now() + CASE v_attempts
                                       WHEN 1 THEN interval '1 minute'
                                       WHEN 2 THEN interval '5 minutes'
                                       WHEN 3 THEN interval '15 minutes'
                                       ELSE        interval '1 hour'
                                     END
     WHERE id = p_delivery_id;
  END IF;

  UPDATE company_webhooks
     SET last_delivery_at          = now(),
         last_delivery_status      = CASE WHEN p_success THEN 'delivered' ELSE 'failed' END,
         last_delivery_http_status = p_http_status
   WHERE id = v_webhook_id;
END;
$$;

REVOKE ALL ON FUNCTION company_webhook_record_attempt(uuid, boolean, integer, text, integer, boolean)
  FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Teste síncrono — o botão "Testar" precisa devolver status e tempo na hora,
--    não em até um minuto quando o cron passar.
--
--    A Edge Function chama esta função COM O JWT DO USUÁRIO (não com
--    service_role): é aqui que papel e empresa são revalidados. Só uma entrega
--    de teste ainda pendente, da própria empresa, pode ser reivindicada — nunca
--    uma entrega de evento real, para que a tela não vire um caminho paralelo
--    de reprocessamento manual da fila.
-- ─────────────────────────────────────────────────────────────────────────────
-- Corpo idêntico à 064, com uma diferença: a entrega de teste nasce agendada
-- para daqui a 30 segundos. Sem isso o cron poderia reivindicá-la no mesmo
-- instante em que a tela pede a entrega imediata, e o destino receberia o
-- mesmo teste duas vezes. Se a entrega imediata não acontecer (falha de
-- infraestrutura na chamada da Edge Function), o cron ainda entrega meio
-- minuto depois — nada se perde.
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

  INSERT INTO company_webhook_deliveries (webhook_id, company_id, event_type, payload, next_attempt_at)
  VALUES (p_id, v_company, 'webhook.test',
          jsonb_build_object('message', 'Disparo de teste do InventoryBlind.'),
          now() + interval '30 seconds')
  RETURNING id INTO v_delivery_id;

  RETURN v_delivery_id;
END;
$$;

REVOKE ALL ON FUNCTION company_webhook_send_test(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION company_webhook_send_test(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION company_webhook_claim_test_delivery(p_delivery_id uuid)
RETURNS SETOF company_webhook_deliveries
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_company uuid;
  v_role    text;
BEGIN
  v_role := get_my_role();
  IF v_role IS NULL OR v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Apenas owner ou admin podem enviar um teste.';
  END IF;
  v_company := get_my_company_id()::uuid;

  RETURN QUERY
  UPDATE company_webhook_deliveries d
     SET attempt_count = d.attempt_count + 1
   WHERE d.id = p_delivery_id
     AND d.company_id = v_company
     AND d.event_type = 'webhook.test'
     AND d.status = 'pending'
  RETURNING d.*;
END;
$$;

REVOKE ALL ON FUNCTION company_webhook_claim_test_delivery(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION company_webhook_claim_test_delivery(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. pc_start_session — corpo idêntico à definição viva, mais o evento
--    physical_count.started.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pc_start_session(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_company      text;
  v_sess_company uuid;
  v_status       text;
  v_count_number smallint;
  v_deleted_at   timestamptz;
BEGIN
  v_company := get_my_company_id();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No active company';
  END IF;

  SELECT company_id, status, count_number, deleted_at
  INTO v_sess_company, v_status, v_count_number, v_deleted_at
  FROM physical_count_sessions WHERE id = p_session_id FOR UPDATE;

  IF v_sess_company IS NULL THEN
    RAISE EXCEPTION 'Session not found';
  END IF;
  IF v_sess_company::text <> v_company THEN
    RAISE EXCEPTION 'Session belongs to another company';
  END IF;
  IF v_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Esta contagem foi removida do histórico.';
  END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'Session already started';
  END IF;
  IF v_count_number <> 1 THEN
    RAISE EXCEPTION 'Only the first count is started this way — recount sessions start already in_progress';
  END IF;

  UPDATE physical_count_items i
  SET erp_quantity_snapshot = p.stock_quantity, updated_at = now()
  FROM products p
  WHERE i.session_id = p_session_id AND i.product_id = p.id;

  UPDATE physical_count_sessions
  SET status = 'in_progress', started_at = now(), started_by = auth.uid(), updated_at = now()
  WHERE id = p_session_id;

  -- NOVO (068): um webhook mal configurado nunca pode impedir a contagem de começar.
  BEGIN
    PERFORM company_webhook_enqueue_event(
      v_company::uuid,
      'physical_count.started',
      jsonb_build_object('session_id', p_session_id)
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.pc_start_session(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.pc_start_session(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. pc_admin_delete_session — corpo idêntico à definição viva, mais o evento
--    physical_count.cancelled.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pc_admin_delete_session(p_session_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_company text;
  v_role    text;
  v_email   text;
  v_reason  text;
  v_before  physical_count_sessions%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Nenhum usuário autenticado nesta requisição.';
  END IF;

  v_company := get_my_company_id();
  v_role    := get_my_role();

  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Nenhuma empresa ativa para este usuário.';
  END IF;
  IF v_role IS NULL OR v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Apenas owner ou admin podem remover uma contagem do histórico.';
  END IF;

  v_reason := btrim(coalesce(p_reason, ''));
  IF char_length(v_reason) < 5 THEN
    RAISE EXCEPTION 'A justificativa precisa ter pelo menos 5 caracteres.';
  END IF;

  SELECT * INTO v_before FROM physical_count_sessions WHERE id = p_session_id FOR UPDATE;

  IF v_before.id IS NULL THEN
    RAISE EXCEPTION 'Contagem não encontrada.';
  END IF;
  IF v_before.company_id::text <> v_company THEN
    RAISE EXCEPTION 'Esta contagem pertence a outra empresa.';
  END IF;
  IF v_before.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Esta contagem já foi removida do histórico.';
  END IF;

  UPDATE physical_count_sessions
  SET deleted_at      = now(),
      deleted_by      = auth.uid(),
      deletion_reason = v_reason,
      updated_at      = now()
  WHERE id = p_session_id;

  SELECT email INTO v_email FROM profiles WHERE id = auth.uid();

  INSERT INTO audit_logs (
    company_id, user_id, user_email, action, resource_type, resource_id, description, metadata
  ) VALUES (
    v_before.company_id,
    auth.uid(),
    coalesce(v_email, ''),
    'physical_count.session_deleted',
    'physical_count_session',
    p_session_id::text,
    'Contagem física removida do histórico visível.',
    jsonb_build_object(
      'sessionId',   p_session_id,
      'range',       v_before.street_from || ' → ' || v_before.street_to,
      'streetFrom',  v_before.street_from,
      'streetTo',    v_before.street_to,
      'warehouse',   v_before.warehouse,
      'countNumber', v_before.count_number,
      'status',      v_before.status,
      'totalItems',  v_before.total_items,
      'reason',      v_reason,
      'deletedBy',   auth.uid(),
      'deletedAt',   now()
    )
  );

  -- NOVO (068): o cancelamento já está consumado acima; um webhook fora do ar
  -- não pode desfazê-lo.
  BEGIN
    PERFORM company_webhook_enqueue_event(
      v_before.company_id,
      'physical_count.cancelled',
      jsonb_build_object(
        'session_id',      p_session_id,
        'count_number',    v_before.count_number,
        'warehouse',       v_before.warehouse,
        'previous_status', v_before.status
      )
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.pc_admin_delete_session(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.pc_admin_delete_session(uuid, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. pc_finalize_session — corpo idêntico à definição viva (migration 065),
--    mais o evento physical_count.divergence_detected quando houver
--    divergência. A divergência já é contada aqui (v_divergent) para decidir o
--    status final: nenhuma consulta nova, nenhuma regra nova.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pc_finalize_session(p_session_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_company      text;
  v_sess_company uuid;
  v_status       text;
  v_deleted_at   timestamptz;
  v_pending      integer;
  v_divergent    integer;
  v_final_status text;
BEGIN
  v_company := get_my_company_id();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No active company';
  END IF;

  SELECT company_id, status, deleted_at INTO v_sess_company, v_status, v_deleted_at
  FROM physical_count_sessions WHERE id = p_session_id FOR UPDATE;

  IF v_sess_company IS NULL THEN
    RAISE EXCEPTION 'Session not found';
  END IF;
  IF v_sess_company::text <> v_company THEN
    RAISE EXCEPTION 'Session belongs to another company';
  END IF;
  IF v_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Esta contagem foi removida do histórico.';
  END IF;
  IF v_status <> 'in_progress' THEN
    RAISE EXCEPTION 'Session is not in progress (cannot finalize twice)';
  END IF;

  SELECT count(*) INTO v_pending
  FROM physical_count_items WHERE session_id = p_session_id AND physical_quantity IS NULL;

  IF v_pending > 0 THEN
    RAISE EXCEPTION 'Cannot finalize: % item(s) not yet counted', v_pending;
  END IF;

  UPDATE physical_count_items i
  SET
    result_status = CASE
      WHEN (i.physical_quantity + i.found_elsewhere_quantity) = i.erp_quantity_snapshot THEN 'ok'
      WHEN (i.physical_quantity + i.found_elsewhere_quantity) < i.erp_quantity_snapshot THEN 'missing'
      ELSE 'surplus'
    END,
    snapshot_product_name = p.name,
    snapshot_sku          = p.sku,
    snapshot_ean           = p.ean,
    updated_at = now()
  FROM products p
  WHERE i.session_id = p_session_id AND i.product_id = p.id;

  SELECT count(*) INTO v_divergent
  FROM physical_count_items
  WHERE session_id = p_session_id AND result_status <> 'ok';

  v_final_status := CASE WHEN v_divergent = 0 THEN 'completed' ELSE 'with_divergences' END;

  UPDATE physical_count_sessions
  SET status = v_final_status, finished_at = now(), finished_by = auth.uid(), updated_at = now()
  WHERE id = p_session_id;

  -- Herdado da 049: a avaliação automática não pode derrubar o fechamento.
  BEGIN
    PERFORM pc_evaluate_auto_recount(p_session_id);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Herdado da 065: mesmo tratamento defensivo — um webhook mal configurado
  -- (URL fora do ar, etc.) nunca pode impedir a sessão de ser finalizada.
  BEGIN
    PERFORM company_webhook_enqueue_event(
      v_company::uuid,
      'physical_count.finalized',
      jsonb_build_object(
        'session_id', p_session_id,
        'status', v_final_status,
        'divergent_items', v_divergent
      )
    );

    -- NOVO (068): evento próprio de divergência, para quem só quer ser avisado
    -- quando a contagem não fechou redonda.
    IF v_divergent > 0 THEN
      PERFORM company_webhook_enqueue_event(
        v_company::uuid,
        'physical_count.divergence_detected',
        jsonb_build_object(
          'session_id', p_session_id,
          'divergent_items', v_divergent
        )
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN v_final_status;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.pc_finalize_session(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.pc_finalize_session(uuid) TO authenticated;

COMMENT ON FUNCTION company_webhook_claim_test_delivery(uuid) IS
  'Reivindica UMA entrega de teste da própria empresa para entrega imediata pela Edge Function webhook-dispatch. Nunca alcança entregas de eventos reais.';
