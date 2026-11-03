/*
# Convite de funcionário — company_invitations + accept_pending_invitations()

## Problema (P0 — funcionário convidado não entra no workspace)
InviteModal (UserManagementPage.tsx) cria a conta com supabase.auth.signUp(), embutindo
company_id/role em raw_user_meta_data. Desde a 015_fix_privilege_escalation.sql (correção legítima
de escalonamento de privilégio — qualquer payload de signup podia se autopromover a owner de uma
empresa arbitrária), handle_new_user() ignora deliberadamente esses metadados: todo profile novo
nasce com company_id=NULL, role='viewer'. InviteModal nunca foi atualizado para esse modelo — o
convite "funciona" na tela (mostra sucesso), mas nunca vincula ninguém a lugar nenhum. Confirmado ao
vivo: giovanni@azbuy.com.br tem raw_user_meta_data.company_id apontando para AZ, mas
profiles.company_id é NULL, e ele caiu na tela de "criar nova empresa".

Bônus, mesma causa: o UPDATE profiles SET must_change_password=true que InviteModal roda em seguida
também falha silenciosamente (profiles_update só libera update de owner/admin quando o alvo já está
na mesma empresa do chamador — e o alvo está com company_id NULL nesse instante).

## Decisão de produto
Mantém o modelo de senha temporária (sem link/e-mail real — não há provedor de e-mail no projeto).
O convite passa a ser um registro server-side (esta tabela), redimido automaticamente no primeiro
SIGNED_IN daquele e-mail — por isso não há token de cliente para se perder em signup/login/OAuth/
confirmação de e-mail: o vínculo é resolvido inteiramente no servidor, por e-mail normalizado.

## O que este arquivo cria
1. company_invitations — um convite pendente por (empresa, e-mail normalizado). RLS: só
   SELECT para owner/admin da própria empresa; nenhuma escrita direta do cliente — mesmo padrão já
   documentado em company_members (022): toda escrita passa por RPC SECURITY DEFINER.
2. create_company_invitation(email, role, name) — owner/admin cria/reabre um convite pendente da
   própria empresa. Nunca aceita role='owner' (mesma trava de update_member_role, 015).
3. accept_pending_invitations() — chamada sem argumento (resolve por auth.uid()/e-mail do
   chamador). Reivindica atomicamente cada convite pendente cujo e-mail bate (proteção contra
   corrida), garante a company_members correspondente, e só ativa profiles.company_id quando o
   chamador ainda não tem empresa nenhuma — nunca troca uma empresa ativa existente por outra (sem
   swap silencioso de tenant). Idempotente: chamar de novo sem convites pendentes não faz nada.

## Fora de escopo (não alterado aqui)
link_user_to_company() (016) aceita um company_id arbitrário do cliente sem checar convite nenhum —
pré-existente, não relacionado a este bug, hoje só alcançável pelo atalho oculto de conta de teste
em LinkCompanyScreen. Reportado separadamente, não corrigido nesta migration.
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. company_invitations
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS company_invitations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  email            text NOT NULL,
  -- lower(btrim(email)) — comparado contra o e-mail real do usuário no aceite. Deliberadamente SEM
  -- normalizar alias (+tag, pontos de Gmail): isso deixaria quem controla x+qualquercoisa@dominio
  -- herdar o convite de x@dominio.
  email_normalized text NOT NULL,
  invited_name     text,
  role             text NOT NULL CHECK (role IN ('admin','manager','counter','viewer')),
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','expired')),
  invited_by       uuid REFERENCES auth.users(id),
  expires_at       timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at      timestamptz,
  accepted_by      uuid REFERENCES auth.users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- No máximo um convite PENDENTE por e-mail por empresa — reabrir = atualiza o existente
-- (create_company_invitation faz upsert nesse índice), nunca duplica.
CREATE UNIQUE INDEX IF NOT EXISTS company_invitations_pending_idx
  ON company_invitations (company_id, email_normalized)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS company_invitations_email_idx
  ON company_invitations (email_normalized)
  WHERE status = 'pending';

ALTER TABLE company_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company_invitations_select" ON company_invitations;
CREATE POLICY "company_invitations_select" ON company_invitations FOR SELECT
  TO authenticated
  USING (company_id::text = get_my_company_id() AND get_my_role() IN ('owner','admin'));

-- Deliberadamente nenhuma policy de INSERT/UPDATE/DELETE para authenticated — toda escrita passa
-- pelas duas RPCs abaixo, mesmo padrão de company_members.

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. create_company_invitation()
-- ─────────────────────────────────────────────────────────────────────────────
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

  -- 'owner' nunca é um papel de convite — mesmo conjunto já oferecido pelo seletor de papel do
  -- InviteModal, que já exclui 'owner' das opções.
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

REVOKE EXECUTE ON FUNCTION public.create_company_invitation(text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_company_invitation(text, text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.create_company_invitation(text, text, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. accept_pending_invitations()
--
-- Sem argumento: resolve tudo pelo e-mail real do chamador (auth.uid()), nunca por um company_id
-- vindo do cliente — é isso que impede o "swap de tenant" e o acesso cruzado entre empresas.
-- ─────────────────────────────────────────────────────────────────────────────
-- Nomeado out_* (não company_id/company_slug/activated) pelo mesmo motivo documentado em
-- create_company_onboarding (038): um OUT parameter com o mesmo nome de uma coluna real torna toda
-- referência não qualificada a essa coluna ambígua dentro do corpo da função (ex.: no INSERT ...
-- ON CONFLICT (user_id, company_id) do company_members abaixo).
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
    -- Expirado: marca e não concede acesso. Um convite inválido nunca vira criação de empresa
    -- silenciosa nem acesso — só é ignorado, com o estado registrado.
    IF v_inv.expires_at < now() THEN
      UPDATE company_invitations SET status = 'expired', updated_at = now()
      WHERE id = v_inv.id AND status = 'pending';
      CONTINUE;
    END IF;

    -- Reivindicação atômica — protege contra duas chamadas concorrentes (ex.: dois eventos
    -- SIGNED_IN quase simultâneos) processando o mesmo convite.
    UPDATE company_invitations
    SET status = 'accepted', accepted_at = now(), accepted_by = v_uid, updated_at = now()
    WHERE id = v_inv.id AND status = 'pending'
    RETURNING * INTO v_claimed;

    IF NOT FOUND THEN
      -- Perdeu a corrida. Idempotente só se quem venceu foi este mesmo usuário; senão, outra
      -- pessoa já reivindicou esse e-mail (não deveria acontecer — e-mail é o mesmo chamador — mas
      -- não assume, apenas pula em vez de conceder acesso).
      SELECT * INTO v_claimed FROM company_invitations WHERE id = v_inv.id;
      IF v_claimed.accepted_by IS DISTINCT FROM v_uid THEN
        CONTINUE;
      END IF;
    END IF;

    -- Membership sempre garantida, sem nunca reduzir/elevar uma role já existente por esta via
    -- (isso é papel de update_member_role).
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
    -- Se v_current_company já tinha valor (igual ou diferente do convite), profiles.company_id não
    -- é tocado — nunca um swap silencioso de tenant. A nova membership fica disponível pelo
    -- seletor de workspace já existente (switch_active_company).

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

REVOKE EXECUTE ON FUNCTION public.accept_pending_invitations() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.accept_pending_invitations() FROM anon;
GRANT  EXECUTE ON FUNCTION public.accept_pending_invitations() TO authenticated;
