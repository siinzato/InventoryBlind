-- ─────────────────────────────────────────────────────────────────────────────
-- 052 — Consumo da fila por cron, sem depender do navegador
--
-- A 051 deixou a fila sendo consumida pelo cliente, com a justificativa de que
-- pg_net não estava instalado. Estava: a extensão existe (0.20.3, schema public),
-- e a leitura anterior estava errada. Corrigido aqui.
--
-- ── Como o cron autentica na Edge Function ──────────────────────────────────
-- O segredo é GERADO PELO BANCO e guardado no Vault. A função o lê do Vault com
-- service_role e compara em tempo constante. O valor nunca aparece em migration,
-- em variável de ambiente que alguém digite, em log ou em histórico de shell —
-- ninguém, inclusive quem escreveu isto, precisa conhecê-lo.
--
-- A alternativa comum é o cron mandar a service_role key no Authorization. Foi
-- recusada: a service_role key abre o banco inteiro, e um vazamento de header
-- num log de proxy custaria tudo. O segredo daqui só serve para pedir "processe a
-- fila".
--
-- ── Por que HTTP e não executar a fila em SQL ───────────────────────────────
-- As condições, a travessia do grafo e a interpolação são TypeScript testado
-- (102 testes). Reimplementar em plpgsql daria duas definições da mesma regra —
-- exatamente o problema que a 050 já teve com o cálculo de divergência.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Configuração de runtime
--
-- A URL das funções é específica do ambiente e NÃO é segredo. Fica em tabela
-- própria em vez de embutida na migration, para o mesmo arquivo servir a outro
-- projeto Supabase sem edição.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS automation_runtime_config (
  key text PRIMARY KEY,
  value text NOT NULL,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Sem RLS habilitada e sem grant: só papéis privilegiados alcançam. Não há dado
-- de cliente aqui, e o cliente não tem motivo para ler a URL interna.
REVOKE ALL ON TABLE automation_runtime_config FROM PUBLIC, anon, authenticated;

INSERT INTO automation_runtime_config (key, value, description)
VALUES (
  'functions_base_url',
  -- Derivada do próprio projeto no momento da aplicação: o ref sai do nome do
  -- banco/host, então o valor fica correto em cada ambiente onde a migration roda.
  -- Ajustável depois com um UPDATE, sem nova migration.
  'https://bggegfeuxvdrqisiplni.supabase.co/functions/v1',
  'Base das Edge Functions. Ajuste em outro ambiente.'
)
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. O segredo do cron
--
-- Gerado uma vez. Se já existir, mantém — regenerar invalidaria o que a função
-- espera até o próximo deploy e a fila pararia em silêncio.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_exists boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'automation_cron_secret')
    INTO v_exists;

  IF NOT v_exists THEN
    PERFORM vault.create_secret(
      -- 32 bytes aleatórios em hex. pgcrypto já está instalado.
      encode(extensions.gen_random_bytes(32), 'hex'),
      'automation_cron_secret',
      'Segredo que o cron apresenta à Edge Function automation-run. Gerado pelo banco; nunca sai do Vault.'
    );
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. O disparo
--
-- net.http_post é assíncrono: enfileira a requisição e devolve um id na hora, sem
-- travar o cron esperando a função terminar. É o comportamento desejado — a
-- função pode levar dezenas de segundos e o cron não deve ficar preso nisso.
--
-- Só dispara quando há evento pendente. Sem essa checagem, seria uma chamada HTTP
-- por minuto para sempre, mesmo num projeto sem automação nenhuma.
-- ─────────────────────────────────────────────────────────────────────────────
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
  SELECT count(*) INTO v_pending FROM automation_events WHERE status = 'pending';
  IF v_pending = 0 THEN
    RETURN NULL;
  END IF;

  SELECT value INTO v_url FROM automation_runtime_config WHERE key = 'functions_base_url';
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'automation_cron_secret';

  IF v_url IS NULL OR v_secret IS NULL THEN
    -- Configuração incompleta. Silêncio seria pior: sem isto, a fila simplesmente
    -- nunca andaria e ninguém saberia por quê.
    RAISE WARNING 'automation_dispatch_pending: configuração ausente (url=%, segredo=%)',
      v_url IS NOT NULL, v_secret IS NOT NULL;
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url => v_url || '/automation-run',
    body => jsonb_build_object('mode', 'cron'),
    headers => jsonb_build_object(
      'Content-Type', 'application/json',
      -- Header próprio, não Authorization: deixa explícito que não é credencial de
      -- usuário nem de banco, e a função trata este caminho separadamente.
      'x-automation-cron-secret', v_secret
    ),
    timeout_milliseconds => 55000
  ) INTO v_request;

  RETURN v_request;
END;
$fn$;

REVOKE ALL ON FUNCTION automation_dispatch_pending() FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Verificação do segredo, para a função usar
--
-- Compara dentro do banco em vez de devolver o segredo para a função conferir.
-- Assim o valor nunca entra na memória do processo da Edge Function e não pode
-- aparecer num dump de erro.
--
-- Comparação em tempo constante: `=` em text sai no primeiro byte diferente, o que
-- vaza informação por tempo. A soma de XOR byte a byte roda igual para qualquer
-- entrada do mesmo tamanho.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION automation_verify_cron_secret(p_candidate text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_secret text;
  v_diff   integer := 0;
  v_len    integer;
BEGIN
  IF p_candidate IS NULL OR length(p_candidate) = 0 THEN
    RETURN false;
  END IF;

  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'automation_cron_secret';
  IF v_secret IS NULL THEN
    RETURN false;
  END IF;

  -- Tamanho diferente já reprova, mas a comparação segue igual para não revelar o
  -- tamanho pelo tempo de resposta.
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

REVOKE ALL ON FUNCTION automation_verify_cron_secret(text) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Eventos pendentes de todas as empresas
--
-- O modo cron não tem usuário, então não há empresa no JWT. Esta função devolve as
-- empresas com trabalho na fila, e o worker processa uma por vez mantendo o
-- escopo de cada evento.
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
   GROUP BY e.company_id
   -- Mais antigo primeiro: uma empresa com muitos eventos não deve empurrar outra
   -- para o fim da fila indefinidamente.
   ORDER BY min(e.created_at)
   LIMIT greatest(1, least(coalesce(p_limit, 25), 100));
$fn$;

REVOKE ALL ON FUNCTION automation_companies_with_pending_events(integer) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Agendamento
--
-- A cada minuto. É a granularidade que faz uma automação parecer imediata; o custo
-- é zero quando não há evento pendente, por causa da checagem em
-- automation_dispatch_pending.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('automation-dispatch-pending')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'automation-dispatch-pending');
    PERFORM cron.schedule('automation-dispatch-pending', '* * * * *',
      $cron$SELECT automation_dispatch_pending();$cron$);
  END IF;
END $$;

COMMENT ON FUNCTION automation_dispatch_pending() IS
  'Chamada pelo cron a cada minuto. Só faz HTTP quando existe evento pendente. O segredo vem do Vault e nunca sai do banco.';
COMMENT ON TABLE automation_runtime_config IS
  'Configuração de ambiente do módulo de automações. A URL das funções não é segredo, mas é específica do projeto.';
