/*
# Configurações de Workspace — criar workspace adicional + logo

## Parte 1: criar workspace adicional para usuário já onboardado
create_company_onboarding() (038) exige que o perfil do usuário ainda NÃO
tenha company_id — é o fluxo de primeiro acesso (signup), não um "criar mais
um workspace" para quem já opera em um. O seletor de workspace (App.tsx) já
reserva um item "Adicionar empresa" para essa ação, travado como "Em breve"
porque não existia RPC para isso.

Nova função SECURITY DEFINER, mesma forma de create_company_onboarding()
(mesmo padrão de geração de slug único), mas:
  - sem a checagem "usuário já vinculado a uma empresa" (é exatamente o
    caso que queremos permitir aqui);
  - não toca em profiles.company_id/role — o workspace ativo do usuário
    permanece intacto; o cliente decide se troca para o novo workspace
    chamando o já existente switch_active_company() logo em seguida
    (mesmo RPC já usado pelo seletor de workspace).

Mesma garantia transacional do original: criação da empresa + membership em
uma única função PL/pgSQL — se qualquer INSERT falhar, a chamada inteira é
revertida (nunca sobra empresa sem membership nem membership sem empresa).

Nenhuma policy de companies/company_members é alterada — esta função roda
como owner da migration (SECURITY DEFINER), igual a create_company_onboarding
e switch_active_company.

## Parte 2: logo do workspace
`companies.icon` já existe e é renderizado como texto cru (emoji) em
WorkspaceSelectorScreen.tsx — reaproveitar essa coluna para uma URL/caminho
de imagem quebraria essa renderização existente. Coluna nova e aditiva
(`logo_path`) em vez disso, guardando o CAMINHO no Storage (não a URL —
o bucket é privado, mesmo padrão de `warehouse_layouts.background_image_path`
na migration 032, com URL assinada gerada sob demanda no cliente).

Bucket privado `workspace-logos`, pasta por empresa
(`(storage.foldername(name))[1] = company_id`), igual ao bucket
`warehouse-floorplans` da migration 032 — só owner/admin do workspace ativo
grava; qualquer membro autenticado do workspace lê.
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. create_additional_company() RPC
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_additional_company(
  p_company_name text
)
RETURNS TABLE(out_company_id uuid, out_company_slug text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_slug text;
  v_new_company_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF trim(coalesce(p_company_name, '')) = '' THEN
    RAISE EXCEPTION 'Company name is required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_uid) THEN
    RAISE EXCEPTION 'Profile not found for this user';
  END IF;

  v_slug := lower(regexp_replace(trim(p_company_name), '[^a-zA-Z0-9]+', '-', 'g'));
  v_slug := regexp_replace(v_slug, '^-+|-+$', '', 'g');
  IF v_slug = '' THEN
    v_slug := 'empresa';
  END IF;
  v_slug := v_slug || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);

  INSERT INTO companies (name, slug, owner_id, plan)
  VALUES (trim(p_company_name), v_slug, v_uid, 'starter')
  RETURNING id INTO v_new_company_id;

  INSERT INTO company_members (user_id, company_id, role)
  VALUES (v_uid, v_new_company_id, 'owner')
  ON CONFLICT (user_id, company_id) DO NOTHING;

  RETURN QUERY SELECT v_new_company_id, v_slug;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.create_additional_company(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_additional_company(text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. companies.logo_path (aditivo)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE companies ADD COLUMN IF NOT EXISTS logo_path text;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Bucket de Storage para o logo do workspace
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('workspace-logos', 'workspace-logos', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "workspace_logos_select" ON storage.objects;
CREATE POLICY "workspace_logos_select" ON storage.objects FOR SELECT
  TO authenticated USING (
    bucket_id = 'workspace-logos' AND (storage.foldername(name))[1] = get_my_company_id()
  );

DROP POLICY IF EXISTS "workspace_logos_insert" ON storage.objects;
CREATE POLICY "workspace_logos_insert" ON storage.objects FOR INSERT
  TO authenticated WITH CHECK (
    bucket_id = 'workspace-logos'
    AND (storage.foldername(name))[1] = get_my_company_id()
    AND get_my_role() = ANY(ARRAY['owner','admin'])
  );

DROP POLICY IF EXISTS "workspace_logos_update" ON storage.objects;
CREATE POLICY "workspace_logos_update" ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'workspace-logos' AND (storage.foldername(name))[1] = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin']))
  WITH CHECK (bucket_id = 'workspace-logos' AND (storage.foldername(name))[1] = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin']));

DROP POLICY IF EXISTS "workspace_logos_delete" ON storage.objects;
CREATE POLICY "workspace_logos_delete" ON storage.objects FOR DELETE
  TO authenticated USING (
    bucket_id = 'workspace-logos' AND (storage.foldername(name))[1] = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin'])
  );
