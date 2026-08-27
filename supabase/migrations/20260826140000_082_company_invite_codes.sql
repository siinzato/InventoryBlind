/*
# Código de convite da empresa — company_invite_codes

## Pedido
Além do convite por e-mail (080/081), a empresa passa a ter um código curto, visível em Usuários
para owner/admin, que qualquer pessoa pode digitar na tela de cadastro para se vincular à empresa
automaticamente — sem precisar que o admin crie a conta dela. O código muda todo dia (mesmo
raciocínio de uma senha de uso único): se vazar, só serve por algumas horas, nunca para sempre.

## Desenho
- company_invite_codes: no máximo UM código por empresa por dia (UNIQUE (company_id, valid_date)) —
  reabrir a tela de código no mesmo dia devolve o mesmo código, não gera um novo a cada clique.
  Código globalmente único (UNIQUE (code)) — a validação na entrada não precisa saber a empresa,
  só o código resolve para uma e só uma empresa.
- get_or_create_daily_invite_code(): owner/admin da empresa. Gera (alfabeto sem caracteres
  ambíguos — sem O/0/I/1) ou reaproveita o código de hoje.
- join_company_by_invite_code(p_code): autenticado, qualquer papel. Só aceita o código se
  valid_date = CURRENT_DATE (um código de ontem nunca vincula, mesmo que a linha ainda exista) —
  é isso que implementa a rotação diária no servidor, não só na tela. Mesma trava de
  accept_pending_invitations() (080): nunca troca uma empresa ativa por outra, sempre entra como
  'viewer' (mesmo papel que link_user_to_company já usava, 016 — quem convida promove depois via
  update_member_role).

## Fora de escopo
Não altero link_user_to_company() (016) — continua existindo só para o atalho de conta de teste em
LinkCompanyScreen. Esta migration não a substitui nem a revoga.
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. company_invite_codes
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS company_invite_codes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code       text NOT NULL,
  valid_date date NOT NULL DEFAULT CURRENT_DATE,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Um código por empresa por dia.
CREATE UNIQUE INDEX IF NOT EXISTS company_invite_codes_company_day_idx
  ON company_invite_codes (company_id, valid_date);

-- Código nunca reaproveitado entre empresas/dias — é o que permite validar só pelo código, sem
-- saber a empresa de antemão.
CREATE UNIQUE INDEX IF NOT EXISTS company_invite_codes_code_idx
  ON company_invite_codes (code);

ALTER TABLE company_invite_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company_invite_codes_select" ON company_invite_codes;
CREATE POLICY "company_invite_codes_select" ON company_invite_codes FOR SELECT
  TO authenticated
  USING (company_id::text = get_my_company_id() AND get_my_role() IN ('owner','admin'));

-- Nenhuma policy de INSERT/UPDATE/DELETE para o cliente — mesmo padrão de company_invitations.

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. get_or_create_daily_invite_code()
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_or_create_daily_invite_code()
RETURNS company_invite_codes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_company   text;
  v_role      text;
  v_alphabet  text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- sem O/0/I/1
  v_code      text;
  v_result    company_invite_codes%ROWTYPE;
  v_attempt   int := 0;
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
    RAISE EXCEPTION 'Apenas owner ou admin podem gerar o código de convite.';
  END IF;

  -- Já existe o código de hoje? Reaproveita — reabrir a tela não deve invalidar o que já foi
  -- compartilhado minutos atrás.
  SELECT * INTO v_result
  FROM company_invite_codes
  WHERE company_id = v_company::uuid AND valid_date = CURRENT_DATE;

  IF FOUND THEN
    RETURN v_result;
  END IF;

  LOOP
    v_attempt := v_attempt + 1;
    v_code := (
      SELECT string_agg(substr(v_alphabet, (floor(random() * length(v_alphabet)) + 1)::int, 1), '')
      FROM generate_series(1, 8)
    );

    BEGIN
      INSERT INTO company_invite_codes (company_id, code, valid_date, created_by)
      VALUES (v_company::uuid, v_code, CURRENT_DATE, auth.uid())
      RETURNING * INTO v_result;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      -- Colisão de código entre empresas (extremamente improvável, 32^8 combinações) ou duas
      -- chamadas concorrentes criando o código de hoje ao mesmo tempo (colide no índice
      -- company_id+valid_date). Nos dois casos, tenta de novo — no segundo caso a próxima
      -- iteração do SELECT acima já teria achado a linha, então isto só cobre a corrida real.
      IF v_attempt >= 5 THEN
        RAISE EXCEPTION 'Não foi possível gerar um código de convite. Tente novamente.';
      END IF;
      SELECT * INTO v_result
      FROM company_invite_codes
      WHERE company_id = v_company::uuid AND valid_date = CURRENT_DATE;
      IF FOUND THEN EXIT; END IF;
    END;
  END LOOP;

  INSERT INTO audit_logs (
    company_id, user_id, user_email, action, resource_type, resource_id, description, metadata
  ) VALUES (
    v_company::uuid,
    auth.uid(),
    coalesce((SELECT email FROM profiles WHERE id = auth.uid()), ''),
    'company.invite_code_generated',
    'company_invite_code',
    v_result.id::text,
    'Código de convite da empresa gerado.',
    jsonb_build_object('validDate', v_result.valid_date, 'generatedBy', auth.uid())
  );

  RETURN v_result;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.get_or_create_daily_invite_code() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_or_create_daily_invite_code() FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_or_create_daily_invite_code() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. join_company_by_invite_code()
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.join_company_by_invite_code(p_code text)
RETURNS TABLE(out_company_id uuid, out_company_slug text, out_activated boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid              uuid := auth.uid();
  v_code             text;
  v_row              company_invite_codes%ROWTYPE;
  v_current_company  uuid;
  v_slug             text;
  v_activated        boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Nenhum usuário autenticado nesta requisição.';
  END IF;

  v_code := upper(btrim(coalesce(p_code, '')));
  IF v_code = '' THEN
    RAISE EXCEPTION 'Informe o código de convite.';
  END IF;

  SELECT * INTO v_row FROM company_invite_codes WHERE code = v_code;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Código de convite inválido.';
  END IF;
  -- Rotação diária garantida no servidor: um código de um dia anterior nunca vincula, mesmo que a
  -- linha continue existindo (histórico não é apagado).
  IF v_row.valid_date <> CURRENT_DATE THEN
    RAISE EXCEPTION 'Este código de convite expirou. Peça um código novo ao administrador.';
  END IF;

  SELECT company_id INTO v_current_company FROM profiles WHERE id = v_uid;

  INSERT INTO company_members (user_id, company_id, role)
  VALUES (v_uid, v_row.company_id, 'viewer')
  ON CONFLICT (user_id, company_id) DO NOTHING;

  IF v_current_company IS NULL THEN
    UPDATE profiles
    SET company_id = v_row.company_id, role = 'viewer', updated_at = now()
    WHERE id = v_uid;
    v_current_company := v_row.company_id;
    v_activated := true;
  END IF;
  -- Se já tinha empresa (igual ou diferente), profiles.company_id não é tocado — nunca um swap
  -- silencioso de tenant. A nova membership fica disponível pelo seletor de workspace existente.

  SELECT slug INTO v_slug FROM companies WHERE id = v_row.company_id;

  INSERT INTO audit_logs (
    company_id, user_id, user_email, action, resource_type, resource_id, description, metadata
  ) VALUES (
    v_row.company_id,
    v_uid,
    coalesce((SELECT email FROM auth.users WHERE id = v_uid), ''),
    'company.invite_code_joined',
    'company_invite_code',
    v_row.id::text,
    'Usuário se vinculou à empresa por código de convite.',
    -- Só os 2 primeiros e 2 últimos caracteres do código, nunca o valor inteiro: é um código ainda
    -- válido hoje, e audit_logs é lido por todo owner/admin da empresa.
    jsonb_build_object(
      'codeMasked', left(v_code, 2) || repeat('•', greatest(length(v_code) - 4, 0)) || right(v_code, 2),
      'activatedAsPrimary', v_activated
    )
  );

  out_company_id := v_row.company_id;
  out_company_slug := v_slug;
  out_activated := v_activated;
  RETURN NEXT;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.join_company_by_invite_code(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.join_company_by_invite_code(text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.join_company_by_invite_code(text) TO authenticated;
