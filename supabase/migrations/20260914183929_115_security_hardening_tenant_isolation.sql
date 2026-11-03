/*
  # 115 — Hardening de segurança: isolamento entre workspaces

  Migration incremental e idempotente. NÃO altera migration antiga, NÃO apaga dado,
  NÃO desabilita RLS em lugar nenhum e NÃO usa service_role como atalho.

  Corrige o que a auditoria PROVOU no banco vivo, em quatro frentes:

  ## 1. Policies legadas que anulavam o isolamento (P0 — escrita cross-tenant)

  `inventory_kpi_history` e `inventory_top_vendas_history` tinham DUAS gerações de policy
  convivendo: a estrita (`company_id = get_my_company_id()`) e uma legada
  (`anon_insert/update/delete_*`) cujo predicado era só `auth.uid() IS NOT NULL`.
  Policies permissivas se somam por OR, então a legada vencia sempre: QUALQUER usuário
  autenticado escrevia e apagava o histórico de QUALQUER empresa. As estritas continuam
  no lugar; aqui só caem as legadas. SELECT nunca esteve exposto e não muda.

  ## 2. Guardas que falhavam ABERTO por semântica de NULL (P0 — escalonamento)

  Em PL/pgSQL, `IF <NULL> THEN ... END IF` não executa o ramo. Com chamador anônimo,
  `get_my_role()` e `get_my_company_id()` devolvem NULL, e `NULL NOT IN ('owner','admin')`
  é NULL — a exceção nunca era levantada e o código seguia até o UPDATE. Em
  `update_member_role` isso permitia, só com a chave publicável e sem nenhum login,
  promover qualquer usuário de qualquer empresa a `owner`. As guardas passam a testar
  NULL explicitamente ANTES de qualquer comparação de papel: falha fechada.

  ## 3. Entrada em workspace alheio sem convite (P0 — acesso cross-tenant)

  `link_user_to_company` aceitava qualquer `company_id` existente e vinculava o chamador
  como `viewer`, sem convite, sem membership, sem aprovação. Qualquer pessoa que criasse
  uma conta entrava em qualquer workspace cujo id conhecesse.

  ATENÇÃO — MUDANÇA DE COMPORTAMENTO, precisa da sua decisão: a função passa a exigir
  convite pendente (`company_invitations`) ou vínculo já existente (`company_members`).
  Se o fluxo atual de `src/lib/auth.tsx` depende de auto-vínculo livre à empresa AZ, ele
  para de funcionar como está e precisa passar a emitir convite. Está descrito no
  relatório; nada foi aplicado.

  ## 4. DEFAULT DENY de EXECUTE (P1/P2)

  O catálogo vivo reportava 46 funções de `public` executáveis por `anon`: 35 SECURITY
  DEFINER mais 11 SECURITY INVOKER. Depois desta migration, `anon` não executa NENHUMA
  delas — zero, não "nenhuma de negócio".

  Dois pontos que a primeira versão desta migration errava, e que a revisão corrigiu:

   - `REVOKE ... FROM anon` NÃO protege função que também tem EXECUTE para PUBLIC:
     `anon` continua herdando o privilégio. `rca_next_case_number` e `nfe_claim_key_fetch`
     estavam nessa situação (`=X/postgres` no proacl) e as correções delas teriam sido
     inúteis. As duas passam a sair de PUBLIC, com GRANT explícito para `authenticated`.
   - as 11 SECURITY INVOKER tinham ficado de fora por serem "puras". Ser pura não é
     motivo para `anon` poder chamar: o critério aplicado é quem REALMENTE precisa de
     EXECUTE, provado pelo chamador (ver 5c-bis e 5c-ter).

  Grupos:

   - funções de manutenção sem nenhum chamador no produto (`automation_prune_history`,
     `automation_reap_stuck_events`): só `service_role`. A primeira fazia DELETE em
     `automation_events`/`automation_executions` de todos os tenants sem autenticação;
   - funções só-interno (`pc_evaluate_auto_recount`, `pc_measure_session_divergence`):
     nenhum chamador externo — são chamadas por `pc_finalize_session` e por trigger, e
     dentro de uma SECURITY DEFINER o usuário efetivo é o dono (postgres), então revogar
     não quebra a cadeia interna. `pc_measure_session_divergence` não tinha NENHUM filtro
     de empresa e devolvia agregados de contagem de qualquer sessão de qualquer empresa;
   - 10 funções usadas SOMENTE como trigger: perdem EXECUTE de `anon`/`PUBLIC`. O
     PostgreSQL só exige EXECUTE na criação do trigger, não a cada disparo, então os
     triggers continuam funcionando (o TESTE J do crossTenantIsolation.test.ts comprova
     isso em ambiente real).

  O restante das RPCs continua executável por `authenticated` — a autorização real delas
  é por papel e por empresa DENTRO do corpo, como já era.

  ## 5. Rate limit da public-api (P2)

  A Edge Function `public-api` autentica por chave e isola por empresa, mas não tinha teto
  de requisições. Entra aqui a tabela `api_key_rate_limits` (sem policy nenhuma) e a
  função `api_key_consume_rate_limit`, na mesma arquitetura de `nfe_claim_key_fetch`:
  reserva atômica por INSERT ... ON CONFLICT, contador no banco, executável só por
  `service_role`. Detalhes na seção 6.

  ## Fora do escopo desta migration

  `search_path=public` (e não `pg_catalog, public`) nas 140 SECURITY DEFINER: `anon` e
  `authenticated` não têm CREATE em `public`, então não há object-shadowing possível.
  Trocar 140 funções teria risco maior que o ganho; fica registrado como higiene.
*/

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 1. Policies legadas permissivas (P0)
-- ─────────────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS anon_insert_inventory_kpi_history        ON inventory_kpi_history;
DROP POLICY IF EXISTS anon_update_inventory_kpi_history        ON inventory_kpi_history;
DROP POLICY IF EXISTS anon_delete_inventory_kpi_history        ON inventory_kpi_history;

DROP POLICY IF EXISTS anon_insert_inventory_top_vendas_history ON inventory_top_vendas_history;
DROP POLICY IF EXISTS anon_update_inventory_top_vendas_history ON inventory_top_vendas_history;
DROP POLICY IF EXISTS anon_delete_inventory_top_vendas_history ON inventory_top_vendas_history;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 2. update_member_role — mesma regra de negócio, guardas que falham fechado (P0)
-- ─────────────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.update_member_role(target_user_id uuid, new_role text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_role         text;
  v_caller_company      text;
  v_target_company      text;
  v_target_current_role text;
BEGIN
  v_caller_role    := public.get_my_role();
  v_caller_company := public.get_my_company_id();

  -- Falha fechada: sem sessão, sem empresa ou sem papel não se avalia mais nada.
  -- Antes, NULL NOT IN (...) devolvia NULL e o IF não disparava a exceção.
  IF auth.uid() IS NULL OR v_caller_company IS NULL OR v_caller_role IS NULL THEN
    RAISE EXCEPTION 'Permission denied: authentication required';
  END IF;

  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Permission denied: only owners and admins can change roles';
  END IF;

  IF new_role NOT IN ('owner', 'admin', 'manager', 'counter', 'viewer') THEN
    RAISE EXCEPTION 'Invalid role: %', new_role;
  END IF;

  IF v_caller_role = 'admin' AND new_role = 'owner' THEN
    RAISE EXCEPTION 'Permission denied: admins cannot promote users to owner';
  END IF;

  SELECT company_id, role INTO v_target_company, v_target_current_role
  FROM profiles WHERE id = target_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target user not found';
  END IF;

  IF v_target_company IS NULL OR v_target_company::text IS DISTINCT FROM v_caller_company THEN
    RAISE EXCEPTION 'Permission denied: target user is not in your company';
  END IF;

  IF v_caller_role = 'admin' AND v_target_current_role = 'owner' THEN
    RAISE EXCEPTION 'Permission denied: admins cannot modify owners';
  END IF;

  UPDATE profiles SET role = new_role, updated_at = now()
  WHERE id = target_user_id;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 3. link_user_to_company — exige convite ou vínculo real (P0)
-- ─────────────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.link_user_to_company(target_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_current_company text;
  v_email_norm      text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT company_id::text INTO v_current_company
  FROM profiles WHERE id = auth.uid();

  IF v_current_company IS NOT NULL THEN
    RAISE EXCEPTION 'User already linked to a company';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = target_company_id) THEN
    RAISE EXCEPTION 'Company not found';
  END IF;

  SELECT lower(btrim(email)) INTO v_email_norm FROM auth.users WHERE id = auth.uid();

  -- O vínculo precisa ter sido CONCEDIDO pela empresa de destino: ou a pessoa já é
  -- membro, ou existe convite pendente para o e-mail dela. Sem isso, conhecer o uuid
  -- da empresa bastava para entrar — e o uuid da AZ está no bundle publicado.
  IF NOT EXISTS (
        SELECT 1 FROM company_members
         WHERE user_id = auth.uid() AND company_id = target_company_id
      )
     AND NOT EXISTS (
        SELECT 1 FROM company_invitations
         WHERE company_id = target_company_id
           AND status = 'pending'
           AND email_normalized = v_email_norm
      )
  THEN
    RAISE EXCEPTION 'No invitation for this company';
  END IF;

  UPDATE profiles
  SET company_id = target_company_id, role = 'viewer', updated_at = now()
  WHERE id = auth.uid();
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 4. rca_next_case_number — o company_id do argumento deixa de ser confiável (P1)
-- ─────────────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.rca_next_case_number(p_company_id text, p_year integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company text;
  v_number  integer;
BEGIN
  v_company := get_my_company_id();

  IF auth.uid() IS NULL OR v_company IS NULL THEN
    RAISE EXCEPTION 'Nenhuma empresa ativa na sessão';
  END IF;

  -- A assinatura continua a mesma (o front já envia o companyId), mas o valor enviado
  -- pelo cliente agora só é aceito se for o da própria sessão. Antes, qualquer empresa.
  IF p_company_id IS NULL OR p_company_id IS DISTINCT FROM v_company THEN
    RAISE EXCEPTION 'Permission denied: company mismatch';
  END IF;

  INSERT INTO rca_case_counters (company_id, case_year, last_number)
  VALUES (v_company, p_year, 1)
  ON CONFLICT (company_id, case_year)
  DO UPDATE SET last_number = rca_case_counters.last_number + 1
  RETURNING last_number INTO v_number;

  RETURN v_number;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 5. DEFAULT DENY de EXECUTE
-- ─────────────────────────────────────────────────────────────────────────────────────

-- 5a. Manutenção: sem chamador no produto; passam a ser exclusivas do backend.
REVOKE EXECUTE ON FUNCTION public.automation_prune_history(integer)     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.automation_reap_stuck_events(integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.automation_prune_history(integer)     TO service_role;
GRANT  EXECUTE ON FUNCTION public.automation_reap_stuck_events(integer) TO service_role;

-- 5b. Só-interno: chamadas por pc_finalize_session e por trigger, ambos SECURITY DEFINER.
REVOKE EXECUTE ON FUNCTION public.pc_evaluate_auto_recount(uuid)      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pc_measure_session_divergence(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.pc_evaluate_auto_recount(uuid)      TO service_role;
GRANT  EXECUTE ON FUNCTION public.pc_measure_session_divergence(uuid) TO service_role;

-- 5c. Funções usadas SOMENTE como trigger. O trigger não reavalia EXECUTE no disparo.
REVOKE EXECUTE ON FUNCTION public.automation_on_count_item_counted()    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.automation_on_count_session_created() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.automation_on_count_session_status()  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.automation_on_stock_conflict()        FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.enforce_user_shortcuts_limit()        FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.nfe_guard_archived_invoice()          FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.nfe_guard_archived_parent()           FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.task_assignees_recompute_status()     FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.task_log_attachment()                 FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.task_log_comment()                    FROM PUBLIC, anon;

-- 5c-bis. Mesmas condições, funções que retornam `trigger` e por isso NÃO podem ser
--         chamadas de outro jeito. Não são SECURITY DEFINER (rodam com o privilégio de
--         quem dispara), então nunca foram um caminho de escalonamento — saem daqui só
--         para que `anon` não tenha EXECUTE em nada que não precise.
REVOKE EXECUTE ON FUNCTION public.automation_refresh_schedule()                FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.automation_touch_version()                   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.integration_connections_check_fiscal_entity() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.inventory_cycles_block_reopen()              FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.inventory_items_block_closed_cycle()         FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.returns_check_origin_channel_connection()    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_full_operations_updated_at()          FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column()                   FROM PUBLIC, anon;

-- 5c-ter. As três últimas funções alcançáveis por anon. Não são triggers nem RPC de
--         negócio — são auxiliares. Ficaram de fora da primeira versão desta migration
--         por serem "puras"; ser pura não é motivo para anon poder chamá-las. O critério
--         aplicado é quem REALMENTE precisa de EXECUTE, provado pelo chamador:
--
--   is_valid_cnpj / company_webhook_allowed_events — chamadas SOMENTE de dentro de
--     fiscal_entities_create, fiscal_entities_update, company_webhook_create e
--     company_webhook_update, TODAS SECURITY DEFINER. Dentro delas o usuário efetivo é o
--     dono, que não precisa de grant. Nenhuma participa de CHECK constraint (conferido em
--     pg_constraint: zero ocorrências) e nenhuma é chamada pelo front — `cnpjUtils.ts` e
--     `webhookEvents.ts` são espelhos client-side, não chamadas RPC. Saem de todos os
--     papéis de API.
--
--   automation_next_schedule_run — além de automation_emit_due_schedules (SECURITY
--     DEFINER), é chamada por automation_refresh_schedule, que é SECURITY INVOKER. Nesse
--     caminho o usuário efetivo é quem disparou o trigger, então `authenticated` PRECISA
--     de EXECUTE para gravar automação. Mantida para authenticated, revogada de anon.
REVOKE EXECUTE ON FUNCTION public.is_valid_cnpj(text)                   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.company_webhook_allowed_events()      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.automation_next_schedule_run(text, integer, integer, integer, integer, text, timestamptz) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.automation_next_schedule_run(text, integer, integer, integer, integer, text, timestamptz) TO authenticated;

-- 5d. RPCs de negócio: continuam para `authenticated` (a autorização é por papel e
--     empresa dentro do corpo), mas `anon` não chama mais nenhuma delas.
REVOKE EXECUTE ON FUNCTION public.create_additional_company(text)                         FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_company_onboarding(text, text)                   FROM anon;
REVOKE EXECUTE ON FUNCTION public.link_user_to_company(uuid)                              FROM anon;
REVOKE EXECUTE ON FUNCTION public.switch_active_company(uuid)                             FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_member_role(uuid, text)                          FROM anon;
-- rca_next_case_number e nfe_claim_key_fetch são as DUAS únicas RPCs de negócio que
-- também tinham EXECUTE para PUBLIC (`=X/postgres` no proacl). Revogar só de `anon`
-- não as protegeria: `anon` continuaria herdando o privilégio por PUBLIC. Por isso as
-- duas saem de PUBLIC e recebem GRANT explícito para `authenticated`, deixando o estado
-- final independente do ACL de origem.
REVOKE EXECUTE ON FUNCTION public.rca_next_case_number(text, integer)                     FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rca_next_case_number(text, integer)                     TO authenticated;
REVOKE EXECUTE ON FUNCTION public.integration_intelligence_snapshot(uuid)                 FROM anon;
REVOKE EXECUTE ON FUNCTION public.integration_negative_stock_detail(uuid, integer)        FROM anon;
REVOKE EXECUTE ON FUNCTION public.nfe_claim_key_fetch(text)                               FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.nfe_claim_key_fetch(text)                               TO authenticated;
REVOKE EXECUTE ON FUNCTION public.nfe_finalize_conference(uuid)                           FROM anon;
REVOKE EXECUTE ON FUNCTION public.nfe_register_count(uuid, text, numeric, text, uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.nfe_reopen_conference(uuid)                             FROM anon;
REVOKE EXECUTE ON FUNCTION public.nfe_start_conference(uuid)                              FROM anon;
REVOKE EXECUTE ON FUNCTION public.pc_acknowledge_recount_event(uuid)                      FROM anon;
REVOKE EXECUTE ON FUNCTION public.pc_approve_session(uuid)                                FROM anon;
REVOKE EXECUTE ON FUNCTION public.pc_create_recount_session(uuid, uuid)                   FROM anon;
REVOKE EXECUTE ON FUNCTION public.pc_create_session(text, text, text, text, uuid, text, uuid[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.pc_flag_found_elsewhere(uuid, text, numeric, uuid)      FROM anon;
REVOKE EXECUTE ON FUNCTION public.pc_register_count(uuid, text, numeric, text, uuid)      FROM anon;
REVOKE EXECUTE ON FUNCTION public.pc_reopen_session(uuid)                                 FROM anon;
REVOKE EXECUTE ON FUNCTION public.pc_record_erp_sync_event(uuid, uuid, uuid, text, text, numeric, numeric, numeric, jsonb, jsonb, boolean, boolean, text, uuid) FROM anon;

COMMENT ON FUNCTION public.update_member_role(uuid, text) IS
  'Troca de papel. Falha fechada: exige sessão, empresa e papel não nulos antes de qualquer comparação (migration 115).';
COMMENT ON FUNCTION public.link_user_to_company(uuid) IS
  'Vincula o usuário a uma empresa SOMENTE com convite pendente ou membership existente (migration 115).';

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 6. Rate limit da public-api (P2)
-- ─────────────────────────────────────────────────────────────────────────────────────
--
-- A Edge Function public-api autentica por chave (SHA-256 contra api_keys.key_hash) e
-- nunca aceitou company_id do chamador, mas não tinha teto de requisições: uma chave
-- válida podia varrer o catálogo inteiro da própria empresa sem nenhum limite.
--
-- Mesma arquitetura de nfe_claim_key_fetch (migration 060), que já é o padrão de
-- rate limit do projeto: tabela sem policy nenhuma, tocada só por SECURITY DEFINER, e
-- reserva atômica por INSERT ... ON CONFLICT DO UPDATE — sem race entre chamadas
-- concorrentes e sem contador no cliente.
--
-- Janela fixa por CHAVE: o isolamento por workspace é consequência, já que cada chave
-- pertence a uma empresa. O contador nunca revela a existência de outra chave — a função
-- só responde true/false para a chave apresentada.

CREATE TABLE IF NOT EXISTS api_key_rate_limits (
  api_key_id    uuid PRIMARY KEY REFERENCES api_keys(id) ON DELETE CASCADE,
  window_start  timestamptz NOT NULL DEFAULT now(),
  request_count integer     NOT NULL DEFAULT 0
);

ALTER TABLE api_key_rate_limits ENABLE ROW LEVEL SECURITY;
-- Sem policies, de propósito: nem anon nem authenticated leem ou escrevem. Só a função
-- abaixo (SECURITY DEFINER) toca nesta tabela — igual a nfe_provider_fetch_locks.

CREATE OR REPLACE FUNCTION public.api_key_consume_rate_limit(
  p_api_key_id     uuid,
  p_limit          integer DEFAULT 60,
  p_window_seconds integer DEFAULT 60
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  -- Falha FECHADA: argumento inválido nega a requisição, nunca libera.
  IF p_api_key_id IS NULL
     OR p_limit IS NULL OR p_limit < 1
     OR p_window_seconds IS NULL OR p_window_seconds < 1 THEN
    RETURN false;
  END IF;

  -- Uma linha por chave. O CASE decide, dentro do mesmo comando atômico, se a janela
  -- corrente expirou (reinicia em 1) ou continua (incrementa). O lock de linha do
  -- ON CONFLICT serializa chamadas concorrentes: duas requisições simultâneas contam 2.
  INSERT INTO api_key_rate_limits AS rl (api_key_id, window_start, request_count)
  VALUES (p_api_key_id, now(), 1)
  ON CONFLICT (api_key_id) DO UPDATE
    SET window_start = CASE
          WHEN rl.window_start < now() - make_interval(secs => p_window_seconds) THEN now()
          ELSE rl.window_start
        END,
        request_count = CASE
          WHEN rl.window_start < now() - make_interval(secs => p_window_seconds) THEN 1
          ELSE rl.request_count + 1
        END
  RETURNING rl.request_count INTO v_count;

  RETURN v_count <= p_limit;
END;
$function$;

-- Só o backend consome: a public-api roda com service_role. Nenhum papel de API executa.
REVOKE EXECUTE ON FUNCTION public.api_key_consume_rate_limit(uuid, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.api_key_consume_rate_limit(uuid, integer, integer) TO service_role;

COMMENT ON FUNCTION public.api_key_consume_rate_limit(uuid, integer, integer) IS
  'Janela fixa por chave de API. Devolve false quando o teto foi atingido (migration 115).';
