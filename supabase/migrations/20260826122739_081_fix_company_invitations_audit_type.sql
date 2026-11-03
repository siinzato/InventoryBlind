/*
# Corrige tipo do company_id em audit_logs dentro do convite (080)

## Problema
A 080_company_invitations.sql transcreveu o tipo de audit_logs.company_id da migration 008
original (text), mas a coluna foi alterada para uuid em algum ponto posterior — confirmado ao vivo
(information_schema.columns: company_id uuid). Isso fazia todo INSERT INTO audit_logs dentro de
create_company_invitation()/accept_pending_invitations() falhar com "column company_id is of type
uuid but expression is of type text", derrubando a criação do convite inteira (a exceção sobe até o
frontend, sem nenhuma linha gravada em company_invitations nem em auth.users — confirmado
reproduzindo o erro exato via simulação de chamada autenticada antes desta correção).

## Fix
CREATE OR REPLACE das duas funções, idêntico ao corpo da 080, só com o cast trocado:
create_company_invitation agora faz v_company::uuid (v_company é text, a coluna é uuid);
accept_pending_invitations não precisa mais castear v_claimed.company_id (já é uuid, igual à
coluna).
*/

CREATE OR REPLACE FUNCTION public.create_company_invitation(
  p_email text,
  p_role  text,
  p_name  text DEFAULT NULL
)
RETURNS company_invitations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_company text;
  v_role    text;
  v_email   text;
  v_norm    text;
  v_email_local text;
  v_result  company_invitations%ROWTYPE;
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
    RAISE EXCEPTION 'Apenas owner ou admin podem convidar usuários.';
  END IF;

  IF p_role NOT IN ('admin','manager','counter','viewer') THEN
    RAISE EXCEPTION 'Papel inválido para convite: %', p_role;
  END IF;

  v_email_local := btrim(coalesce(p_email, ''));
  IF v_email_local = '' OR v_email_local NOT LIKE '%@%' THEN
    RAISE EXCEPTION 'Informe um e-mail válido para o convite.';
  END IF;
  v_email := v_email_local;
  v_norm  := lower(v_email_local);

  INSERT INTO company_invitations (
    company_id, email, email_normalized, invited_name, role, status, invited_by, expires_at, updated_at
  ) VALUES (
    v_company::uuid, v_email, v_norm, NULLIF(btrim(coalesce(p_name, '')), ''), p_role, 'pending',
    auth.uid(), now() + interval '7 days', now()
  )
  ON CONFLICT (company_id, email_normalized) WHERE status = 'pending'
  DO UPDATE SET
    invited_name = EXCLUDED.invited_name,
    role         = EXCLUDED.role,
    invited_by   = EXCLUDED.invited_by,
    expires_at   = now() + interval '7 days',
    updated_at   = now()
  RETURNING * INTO v_result;

  INSERT INTO audit_logs (
    company_id, user_id, user_email, action, resource_type, resource_id, description, metadata
  ) VALUES (
    v_company::uuid,
    auth.uid(),
    coalesce((SELECT email FROM profiles WHERE id = auth.uid()), ''),
    'user.invite',
    'company_invitation',
    v_result.id::text,
    'Convite de acesso criado ou reaberto.',
    jsonb_build_object(
      'invitationId', v_result.id,
      'email',        v_email,
      'role',         p_role,
      'invitedBy',    auth.uid(),
      'expiresAt',    v_result.expires_at
    )
  );

  RETURN v_result;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.accept_pending_invitations()
RETURNS TABLE(out_company_id uuid, out_company_slug text, out_activated boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid          uuid := auth.uid();
  v_email_norm   text;
  v_current_company uuid;
  v_inv          company_invitations%ROWTYPE;
  v_claimed      company_invitations%ROWTYPE;
  v_slug         text;
  v_activated    boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Nenhum usuário autenticado nesta requisição.';
  END IF;

  SELECT lower(btrim(email)) INTO v_email_norm FROM auth.users WHERE id = v_uid;
  IF v_email_norm IS NULL THEN
    RETURN;
  END IF;

  SELECT p.company_id INTO v_current_company FROM profiles p WHERE p.id = v_uid;

  FOR v_inv IN
    SELECT * FROM company_invitations
    WHERE email_normalized = v_email_norm AND status = 'pending'
    ORDER BY created_at
  LOOP
    IF v_inv.expires_at < now() THEN
      UPDATE company_invitations SET status = 'expired', updated_at = now()
      WHERE id = v_inv.id AND status = 'pending';
      CONTINUE;
    END IF;

    UPDATE company_invitations
    SET status = 'accepted', accepted_at = now(), accepted_by = v_uid, updated_at = now()
    WHERE id = v_inv.id AND status = 'pending'
    RETURNING * INTO v_claimed;

    IF NOT FOUND THEN
      SELECT * INTO v_claimed FROM company_invitations WHERE id = v_inv.id;
      IF v_claimed.accepted_by IS DISTINCT FROM v_uid THEN
        CONTINUE;
      END IF;
    END IF;

    INSERT INTO company_members (user_id, company_id, role)
    VALUES (v_uid, v_claimed.company_id, v_claimed.role)
    ON CONFLICT (user_id, company_id) DO NOTHING;

    v_activated := false;
    IF v_current_company IS NULL THEN
      UPDATE profiles
      SET company_id = v_claimed.company_id,
          role = v_claimed.role,
          must_change_password = true,
          updated_at = now()
      WHERE id = v_uid;
      v_current_company := v_claimed.company_id;
      v_activated := true;
    END IF;

    SELECT slug INTO v_slug FROM companies WHERE id = v_claimed.company_id;

    INSERT INTO audit_logs (
      company_id, user_id, user_email, action, resource_type, resource_id, description, metadata
    ) VALUES (
      v_claimed.company_id,
      v_uid,
      v_email_norm,
      'user.invite_accepted',
      'company_invitation',
      v_claimed.id::text,
      'Convite de acesso aceito.',
      jsonb_build_object(
        'invitationId', v_claimed.id,
        'companyId',    v_claimed.company_id,
        'role',         v_claimed.role,
        'activatedAsPrimary', v_activated,
        'acceptedBy',   v_uid,
        'acceptedAt',   v_claimed.accepted_at
      )
    );

    out_company_id := v_claimed.company_id;
    out_company_slug := v_slug;
    out_activated := v_activated;
    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$fn$;
