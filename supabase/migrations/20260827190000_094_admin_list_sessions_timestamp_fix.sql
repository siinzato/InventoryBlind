/*
# Corrige admin_list_company_sessions — "structure of query does not match function result type"

## Bug
`auth.sessions.refreshed_at` é `timestamp without time zone` (confirmado por
inspeção direta do schema live), mas a função declarava a coluna de retorno
`refreshed_at` como `timestamptz` e selecionava `s.refreshed_at` sem
conversão. RETURN QUERY exige compatibilidade exata de tipo por coluna —
`timestamp` cru contra `timestamptz` declarado quebra em runtime com
"structure of query does not match function result type", 100% das vezes.

`created_at` e `not_after` de auth.sessions já são `timestamp with time
zone`, então não precisam de conversão — só `refreshed_at` está errado.

## Fix
Reaplica admin_list_company_sessions (093) idêntica, exceto por
`(s.refreshed_at AT TIME ZONE 'UTC')` no lugar de `s.refreshed_at` — GoTrue
grava os timestamps do schema auth em UTC, então a conversão explícita é a
leitura correta, não uma reinterpretação pelo timezone da sessão do Postgres.
*/

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
    (s.refreshed_at AT TIME ZONE 'UTC'),
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
