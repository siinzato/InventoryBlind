/*
# Gerenciamento administrativo de sessões (Central de Segurança → Sessões)

## Summary
Substitui o placeholder "Gerenciamento avançado de sessões em breve" por um
painel real, restrito a owner/admin. Cinco RPCs SECURITY DEFINER pequenas e
independentes — nenhuma tabela nova, nenhuma alteração de schema além das
próprias funções.

## Por que RPC e não SELECT direto em auth.sessions
`auth.sessions`/`auth.refresh_tokens` pertencem ao schema `auth`, gerenciado
pelo GoTrue — não têm (nem devem ganhar) RLS de aplicação. Uma RPC
SECURITY DEFINER é o único jeito de expor uma fatia filtrada e seletiva
desses dados para o client, sem dar acesso direto ao schema auth.

## Isolamento multiempresa — o ponto crítico
Uma sessão do Supabase Auth pertence ao usuário (auth.users), não a uma
empresa. `profiles.company_id` é a empresa ATIVA (workspace atual) do
usuário — `company_members` é que registra TODAS as empresas às quais ele
tem acesso (022_company_members_and_gocase.sql). Por isso:
  - a listagem só inclui usuários cujo profiles.company_id atual é o do
    operador (nunca vaza sessão de outra empresa);
  - a revogação administrativa (individual, em lote por usuário, ou em massa
    pela empresa) só é permitida quando o usuário-alvo tem EXATAMENTE 1
    linha em company_members — encerrar a sessão de alguém que também
    trabalha em outra empresa desconectaria essa pessoa de um workspace que
    não é da alçada deste operador;
  - a ação em massa (owner-only) simplesmente PULA usuários multiempresa e
    devolve quantos foram ignorados, em vez de falhar tudo.

## As 5 funções
1. admin_list_company_sessions — leitura paginada/filtrada, nunca retorna
   token; is_current via auth.jwt()->>'session_id'; is_multi_company como
   flag para a UI desabilitar a ação (a trava de verdade está nas 3 de baixo).
2. admin_revoke_session — encerra 1 sessão (DELETE FROM auth.sessions;
   refresh_tokens.session_id → auth.sessions.id é ON DELETE CASCADE, então
   os refresh tokens somem na mesma operação, sem precisar de um DELETE
   separado).
3. admin_revoke_user_sessions — encerra todas as sessões de 1 usuário,
   preservando a sessão atual do operador mesmo quando o alvo é ele mesmo.
4. owner_revoke_company_sessions — encerra as sessões de todos os usuários
   monoempresa da empresa, exceto a sessão atual do operador; exige o texto
   de confirmação exato "ENCERRAR SESSÕES".
5. admin_get_session_ips — usada só pela Edge Function session-geolocation,
   para resolver o IP de uma sessão sem o client poder mandar um IP
   arbitrário: a função reaplica as mesmas checagens de owner/admin +
   isolamento por empresa antes de devolver qualquer IP.

## Auditoria
Cada revogação grava em audit_logs (trilha visível na aba Auditoria) e em
security_logs (aba Logs de Segurança) na MESMA transação da revogação —
nunca token, sempre ator, alvo, motivo e quantidade.
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. admin_list_company_sessions
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_list_company_sessions(
  p_search text DEFAULT NULL,
  p_role   text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_limit  integer DEFAULT 20,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  session_id       uuid,
  user_id          uuid,
  user_name        text,
  user_email       text,
  user_role        text,
  ip_address       text,
  user_agent       text,
  created_at       timestamptz,
  refreshed_at     timestamptz,
  not_after        timestamptz,
  is_current       boolean,
  is_multi_company boolean,
  total_count      bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid;
  v_role    text;
  v_current_session uuid;
  v_limit   integer;
  v_offset  integer;
  v_search  text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;

  v_company := get_my_company_id()::uuid;
  v_role    := get_my_role();

  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Nenhuma empresa ativa para este usuário.';
  END IF;
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Apenas owner ou admin podem listar sessões.';
  END IF;

  v_current_session := NULLIF(auth.jwt() ->> 'session_id', '')::uuid;
  v_limit  := LEAST(GREATEST(coalesce(p_limit, 20), 1), 100);
  v_offset := GREATEST(coalesce(p_offset, 0), 0);
  v_search := NULLIF(btrim(coalesce(p_search, '')), '');

  RETURN QUERY
  SELECT
    s.id,
    s.user_id,
    p.name,
    p.email,
    p.role,
    host(s.ip),
    s.user_agent,
    s.created_at,
    s.refreshed_at,
    s.not_after,
    (v_current_session IS NOT NULL AND s.id = v_current_session),
    ((SELECT count(*) FROM company_members cm WHERE cm.user_id = s.user_id) <> 1),
    count(*) OVER ()::bigint
  FROM auth.sessions s
  JOIN profiles p ON p.id = s.user_id
  WHERE p.company_id = v_company
    AND (p_role IS NULL OR p.role = p_role)
    AND (
      p_status IS NULL
      OR (p_status = 'current' AND v_current_session IS NOT NULL AND s.id = v_current_session)
      OR (p_status = 'expired' AND s.not_after IS NOT NULL AND s.not_after <= now())
      OR (p_status = 'active'  AND (s.not_after IS NULL OR s.not_after > now()))
    )
    AND (
      v_search IS NULL
      OR p.name ILIKE '%' || v_search || '%'
      OR p.email ILIKE '%' || v_search || '%'
      OR host(s.ip) ILIKE '%' || v_search || '%'
      OR s.user_agent ILIKE '%' || v_search || '%'
    )
  ORDER BY s.refreshed_at DESC NULLS LAST, s.created_at DESC
  LIMIT v_limit OFFSET v_offset;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_list_company_sessions(text, text, text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_company_sessions(text, text, text, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_list_company_sessions(text, text, text, integer, integer) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. admin_revoke_session
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_revoke_session(
  p_session_id uuid,
  p_reason     text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company           uuid;
  v_role              text;
  v_current_session   uuid;
  v_target_user       uuid;
  v_target_company    uuid;
  v_membership_count  integer;
  v_actor_email       text;
  v_target_email      text;
  v_reason            text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;

  v_company := get_my_company_id()::uuid;
  v_role    := get_my_role();

  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Nenhuma empresa ativa para este usuário.';
  END IF;
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Apenas owner ou admin podem encerrar sessões.';
  END IF;

  v_current_session := NULLIF(auth.jwt() ->> 'session_id', '')::uuid;
  IF v_current_session IS NOT NULL AND v_current_session = p_session_id THEN
    RAISE EXCEPTION 'Não é possível encerrar a sua própria sessão atual por esta ação.';
  END IF;

  SELECT s.user_id INTO v_target_user FROM auth.sessions s WHERE s.id = p_session_id;
  IF v_target_user IS NULL THEN
    RAISE EXCEPTION 'Sessão não encontrada.';
  END IF;

  SELECT p.company_id INTO v_target_company FROM profiles p WHERE p.id = v_target_user;
  IF v_target_company IS NULL OR v_target_company <> v_company THEN
    RAISE EXCEPTION 'Esta sessão não pertence a esta empresa.';
  END IF;

  SELECT count(*) INTO v_membership_count FROM company_members cm WHERE cm.user_id = v_target_user;
  IF v_membership_count <> 1 THEN
    RAISE EXCEPTION 'Usuário vinculado a mais de uma empresa — revogação administrativa desabilitada para esta sessão.';
  END IF;

  v_reason := NULLIF(btrim(coalesce(p_reason, '')), '');

  SELECT email INTO v_actor_email  FROM profiles WHERE id = auth.uid();
  SELECT email INTO v_target_email FROM profiles WHERE id = v_target_user;

  DELETE FROM auth.sessions WHERE id = p_session_id;

  INSERT INTO audit_logs (company_id, user_id, user_email, action, resource_type, resource_id, description, metadata)
  VALUES (
    v_company, auth.uid(), coalesce(v_actor_email, ''), 'security.session_revoked', 'auth_session', p_session_id::text,
    'Sessão encerrada por administrador.',
    jsonb_build_object('targetUserId', v_target_user, 'targetEmail', v_target_email, 'reason', v_reason)
  );

  INSERT INTO security_logs (company_id, user_id, event_type, severity, description, metadata)
  VALUES (
    v_company, v_target_user, 'security.session_revoked', 'warning',
    'Sessão encerrada por administrador.',
    jsonb_build_object('actorId', auth.uid(), 'actorEmail', v_actor_email, 'sessionId', p_session_id, 'reason', v_reason)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_revoke_session(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_revoke_session(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_revoke_session(uuid, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. admin_revoke_user_sessions
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_revoke_user_sessions(
  p_user_id uuid,
  p_reason  text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company          uuid;
  v_role             text;
  v_current_session  uuid;
  v_target_company   uuid;
  v_membership_count integer;
  v_actor_email      text;
  v_target_email     text;
  v_reason           text;
  v_revoked          integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;

  v_company := get_my_company_id()::uuid;
  v_role    := get_my_role();

  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Nenhuma empresa ativa para este usuário.';
  END IF;
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Apenas owner ou admin podem encerrar sessões.';
  END IF;

  SELECT p.company_id INTO v_target_company FROM profiles p WHERE p.id = p_user_id;
  IF v_target_company IS NULL OR v_target_company <> v_company THEN
    RAISE EXCEPTION 'Usuário não pertence a esta empresa.';
  END IF;

  SELECT count(*) INTO v_membership_count FROM company_members cm WHERE cm.user_id = p_user_id;
  IF v_membership_count <> 1 THEN
    RAISE EXCEPTION 'Usuário vinculado a mais de uma empresa — revogação administrativa desabilitada.';
  END IF;

  v_current_session := NULLIF(auth.jwt() ->> 'session_id', '')::uuid;
  v_reason := NULLIF(btrim(coalesce(p_reason, '')), '');

  SELECT email INTO v_actor_email  FROM profiles WHERE id = auth.uid();
  SELECT email INTO v_target_email FROM profiles WHERE id = p_user_id;

  WITH deleted AS (
    DELETE FROM auth.sessions
    WHERE user_id = p_user_id
      AND (v_current_session IS NULL OR id <> v_current_session)
    RETURNING id
  )
  SELECT count(*) INTO v_revoked FROM deleted;

  INSERT INTO audit_logs (company_id, user_id, user_email, action, resource_type, resource_id, description, metadata)
  VALUES (
    v_company, auth.uid(), coalesce(v_actor_email, ''), 'security.user_sessions_revoked', 'profile', p_user_id::text,
    'Sessões de um usuário encerradas por administrador.',
    jsonb_build_object('targetUserId', p_user_id, 'targetEmail', v_target_email, 'reason', v_reason, 'revokedCount', v_revoked)
  );

  INSERT INTO security_logs (company_id, user_id, event_type, severity, description, metadata)
  VALUES (
    v_company, p_user_id, 'security.user_sessions_revoked', 'warning',
    'Sessões encerradas por administrador.',
    jsonb_build_object('actorId', auth.uid(), 'actorEmail', v_actor_email, 'reason', v_reason, 'revokedCount', v_revoked)
  );

  RETURN v_revoked;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_revoke_user_sessions(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_revoke_user_sessions(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_revoke_user_sessions(uuid, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. owner_revoke_company_sessions — ação de emergência, owner-only
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.owner_revoke_company_sessions(
  p_confirmation text,
  p_reason       text DEFAULT NULL
)
RETURNS TABLE (revoked_count integer, skipped_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company         uuid;
  v_role            text;
  v_current_session uuid;
  v_actor_email     text;
  v_reason          text;
  v_revoked         integer := 0;
  v_skipped         integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;

  v_company := get_my_company_id()::uuid;
  v_role    := get_my_role();

  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Nenhuma empresa ativa para este usuário.';
  END IF;
  IF v_role IS NULL OR v_role <> 'owner' THEN
    RAISE EXCEPTION 'Apenas o owner pode executar esta ação.';
  END IF;

  IF p_confirmation IS DISTINCT FROM 'ENCERRAR SESSÕES' THEN
    RAISE EXCEPTION 'Confirmação inválida.';
  END IF;

  v_current_session := NULLIF(auth.jwt() ->> 'session_id', '')::uuid;
  v_reason := NULLIF(btrim(coalesce(p_reason, '')), '');
  SELECT email INTO v_actor_email FROM profiles WHERE id = auth.uid();

  SELECT count(*) INTO v_skipped
  FROM profiles p
  WHERE p.company_id = v_company
    AND (SELECT count(*) FROM company_members cm WHERE cm.user_id = p.id) <> 1;

  WITH eligible_users AS (
    SELECT p.id FROM profiles p
    WHERE p.company_id = v_company
      AND (SELECT count(*) FROM company_members cm WHERE cm.user_id = p.id) = 1
  ),
  deleted AS (
    DELETE FROM auth.sessions s
    WHERE s.user_id IN (SELECT id FROM eligible_users)
      AND (v_current_session IS NULL OR s.id <> v_current_session)
    RETURNING s.id
  )
  SELECT count(*) INTO v_revoked FROM deleted;

  INSERT INTO audit_logs (company_id, user_id, user_email, action, resource_type, resource_id, description, metadata)
  VALUES (
    v_company, auth.uid(), coalesce(v_actor_email, ''), 'security.company_sessions_revoked', 'company', v_company::text,
    'Encerramento em massa de sessões da empresa (exceto a sessão atual do operador).',
    jsonb_build_object('reason', v_reason, 'revokedCount', v_revoked, 'skippedMultiCompanyCount', v_skipped)
  );

  INSERT INTO security_logs (company_id, user_id, event_type, severity, description, metadata)
  VALUES (
    v_company, auth.uid(), 'security.company_sessions_revoked', 'critical',
    'Encerramento em massa de sessões da empresa executado.',
    jsonb_build_object('actorEmail', v_actor_email, 'reason', v_reason, 'revokedCount', v_revoked, 'skippedMultiCompanyCount', v_skipped)
  );

  RETURN QUERY SELECT v_revoked, v_skipped;
END;
$function$;

REVOKE ALL ON FUNCTION public.owner_revoke_company_sessions(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.owner_revoke_company_sessions(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.owner_revoke_company_sessions(text, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. admin_get_session_ips — só para a Edge Function session-geolocation.
--    Reaplica as mesmas checagens de owner/admin + isolamento por empresa,
--    para que o client nunca possa pedir geolocalização de um IP arbitrário
--    nem de uma sessão fora da empresa do operador.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_session_ips(
  p_session_ids uuid[]
)
RETURNS TABLE (session_id uuid, ip_address text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid;
  v_role    text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;

  v_company := get_my_company_id()::uuid;
  v_role    := get_my_role();

  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Nenhuma empresa ativa para este usuário.';
  END IF;
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Apenas owner ou admin podem resolver localização de sessões.';
  END IF;

  IF p_session_ids IS NULL OR array_length(p_session_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT s.id, host(s.ip)
  FROM auth.sessions s
  JOIN profiles p ON p.id = s.user_id
  WHERE p.company_id = v_company
    AND s.id = ANY (p_session_ids);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_get_session_ips(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_session_ips(uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_get_session_ips(uuid[]) TO authenticated;
