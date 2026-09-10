-- ─────────────────────────────────────────────────────────────────────────────
-- 046 — Habilita pg_cron e registra o agendamento das integrações
--
-- A migration 045 criou integration_enqueue_due_syncs, integration_reap_stuck_jobs
-- e prune_processed_webhook_payloads, mas registrou o cron apenas SE a extensão já
-- estivesse instalada — e não estava. Resultado: as funções existiam e nada as
-- chamava, então sync agendado não rodava sozinho.
--
-- Esta migration é separada de propósito. Habilitar uma extensão altera o cluster,
-- não só o schema, e é uma decisão do dono do projeto — não algo que uma migration
-- de feature faz de surpresa. Separada, ela também pode ser revertida sozinha sem
-- desfazer o schema de integrações.
--
-- Idempotente: pode rodar de novo sem duplicar job.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ─────────────────────────────────────────────────────────────────────────────
-- Registro dos jobs
--
-- Ainda dentro de um IF EXISTS: em um projeto onde o papel que aplica as
-- migrations não pode criar extensão, o CREATE acima falharia antes daqui — mas
-- se um dia ele passar a apenas não ter efeito, o bloco não explode. Barato.
--
-- unschedule antes de schedule porque cron.schedule com o mesmo nome atualiza em
-- versões novas e duplica em antigas. Remover primeiro é o comportamento único.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE EXCEPTION 'pg_cron não pôde ser instalado. Habilite a extensão no dashboard do Supabase e rode esta migration novamente.';
  END IF;

  -- A cada 5 minutos. O intervalo real de cada conexão é
  -- sync_interval_minutes na própria conexão; isto é só a granularidade com que
  -- olhamos para o relógio. 5 min mantém o pior atraso em 5 min sem transformar o
  -- enqueue em carga constante.
  PERFORM cron.unschedule('integration-enqueue-due-syncs')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'integration-enqueue-due-syncs');
  PERFORM cron.schedule('integration-enqueue-due-syncs', '*/5 * * * *',
    $cron$SELECT integration_enqueue_due_syncs();$cron$);

  -- Jobs travados: um worker que morreu no meio deixa o run em 'running' para
  -- sempre, e a cláusula NOT EXISTS do enqueue então bloqueia aquela conexão
  -- indefinidamente. 30 min é bem acima de qualquer sync legítimo.
  PERFORM cron.unschedule('integration-reap-stuck-jobs')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'integration-reap-stuck-jobs');
  PERFORM cron.schedule('integration-reap-stuck-jobs', '*/15 * * * *',
    $cron$SELECT integration_reap_stuck_jobs(30);$cron$);

  -- Payload de webhook já processado é descartado depois de 7 dias. O
  -- payload_hash e o event id permanecem, então a proteção contra replay continua
  -- valendo sobre entregas antigas — só o corpo, que é o que pode conter dado
  -- sensível, é que sai.
  PERFORM cron.unschedule('integration-prune-webhook-payloads')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'integration-prune-webhook-payloads');
  PERFORM cron.schedule('integration-prune-webhook-payloads', '17 3 * * *',
    $cron$SELECT prune_processed_webhook_payloads(7);$cron$);
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- cron.job não é multi-tenant e guarda o comando SQL em texto puro. Nenhum
-- cliente tem razão para lê-la, e um comando agendado visível é informação sobre
-- a infraestrutura. Revogado explicitamente porque o default do pg_cron depende
-- da versão.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  REVOKE ALL ON SCHEMA cron FROM anon, authenticated;
EXCEPTION
  WHEN undefined_object OR insufficient_privilege THEN
    RAISE NOTICE 'Não foi possível revogar o schema cron (provavelmente já não havia grant).';
END $$;
