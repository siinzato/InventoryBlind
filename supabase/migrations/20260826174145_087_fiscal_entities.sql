/*
# Empresas fiscais (CNPJ) do workspace

Cria a entidade "empresa fiscal" (razão social + CNPJ), N-para-1 com a tabela
`companies` (que continua representando o workspace). Um workspace pode ter
uma ou várias empresas fiscais; cada uma com um CNPJ único dentro do
workspace (não globalmente). Prepara também o vínculo opcional entre uma
conexão de integração (`integration_connections`) e a empresa fiscal que ela
representa, sem quebrar conexões existentes (coluna nullable).

Toda escrita em `fiscal_entities` passa por RPCs SECURITY DEFINER — não há
policy de INSERT/UPDATE/DELETE na tabela, e não existe nenhum caminho de
exclusão definitiva (arquivar é a única forma de "remover").
*/

-- ─── Validação de CNPJ (dígitos verificadores) ────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_valid_cnpj(p_cnpj text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_d1 int;
  v_d2 int;
  v_sum int;
  v_i int;
  v_weights1 int[] := ARRAY[5,4,3,2,9,8,7,6,5,4,3,2];
  v_weights2 int[] := ARRAY[6,5,4,3,2,9,8,7,6,5,4,3,2];
BEGIN
  IF p_cnpj IS NULL OR p_cnpj !~ '^[0-9]{14}$' THEN
    RETURN false;
  END IF;
  IF p_cnpj ~ '^(\d)\1{13}$' THEN
    RETURN false;
  END IF;

  v_sum := 0;
  FOR v_i IN 1..12 LOOP
    v_sum := v_sum + substring(p_cnpj FROM v_i FOR 1)::int * v_weights1[v_i];
  END LOOP;
  v_d1 := 11 - (v_sum % 11);
  IF v_d1 >= 10 THEN v_d1 := 0; END IF;
  IF v_d1 <> substring(p_cnpj FROM 13 FOR 1)::int THEN
    RETURN false;
  END IF;

  v_sum := 0;
  FOR v_i IN 1..13 LOOP
    v_sum := v_sum + substring(p_cnpj FROM v_i FOR 1)::int * v_weights2[v_i];
  END LOOP;
  v_d2 := 11 - (v_sum % 11);
  IF v_d2 >= 10 THEN v_d2 := 0; END IF;
  IF v_d2 <> substring(p_cnpj FROM 14 FOR 1)::int THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

-- ─── Tabela ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fiscal_entities (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  legal_name          text NOT NULL,
  trade_name          text,
  cnpj                text NOT NULL CHECK (cnpj ~ '^[0-9]{14}$'),
  state_registration  text,
  is_default          boolean NOT NULL DEFAULT false,
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  data_incomplete     boolean NOT NULL DEFAULT false,
  created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS fiscal_entities_company_cnpj_unique_idx
  ON fiscal_entities (company_id, cnpj);

-- No máximo uma empresa padrão ATIVA por workspace, garantido pelo banco.
CREATE UNIQUE INDEX IF NOT EXISTS fiscal_entities_company_default_unique_idx
  ON fiscal_entities (company_id) WHERE is_default AND status = 'active';

CREATE INDEX IF NOT EXISTS fiscal_entities_company_idx ON fiscal_entities (company_id);

ALTER TABLE fiscal_entities ENABLE ROW LEVEL SECURITY;

-- Leitura liberada a qualquer membro do workspace (mesmo padrão de
-- returns_select, migration 083) — a tela de gestão em si é que fica
-- restrita a owner/admin, no client (canManageUsers) e nas RPCs abaixo.
CREATE POLICY "fiscal_entities_select" ON fiscal_entities
  FOR SELECT TO authenticated
  USING (company_id::text = get_my_company_id());

-- Nenhuma policy de INSERT/UPDATE/DELETE: toda escrita passa pelas RPCs.

-- ─── Vínculo opcional: conexão de integração → empresa fiscal ────────────────

ALTER TABLE integration_connections
  ADD COLUMN IF NOT EXISTS fiscal_entity_id uuid REFERENCES fiscal_entities(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.integration_connections_check_fiscal_entity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.fiscal_entity_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM fiscal_entities fe
      WHERE fe.id = NEW.fiscal_entity_id AND fe.company_id = NEW.company_id
    ) THEN
      RAISE EXCEPTION 'A empresa fiscal selecionada não pertence a este workspace.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS integration_connections_fiscal_entity_guard ON integration_connections;
CREATE TRIGGER integration_connections_fiscal_entity_guard
  BEFORE INSERT OR UPDATE OF fiscal_entity_id ON integration_connections
  FOR EACH ROW EXECUTE FUNCTION public.integration_connections_check_fiscal_entity();

-- ─── RPCs ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fiscal_entities_create(
  p_legal_name text,
  p_trade_name text DEFAULT NULL,
  p_cnpj text DEFAULT NULL,
  p_state_registration text DEFAULT NULL,
  p_set_default boolean DEFAULT false
)
RETURNS fiscal_entities
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company uuid;
  v_role text;
  v_cnpj text;
  v_active_count int;
  v_row fiscal_entities;
BEGIN
  v_company := get_my_company_id()::uuid;
  v_role := get_my_role();
  IF v_role IS NULL OR v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Seu papel não permite cadastrar empresas fiscais.';
  END IF;

  IF p_legal_name IS NULL OR btrim(p_legal_name) = '' THEN
    RAISE EXCEPTION 'Informe a razão social.';
  END IF;

  v_cnpj := regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g');
  IF NOT is_valid_cnpj(v_cnpj) THEN
    RAISE EXCEPTION 'Informe um CNPJ válido.';
  END IF;
  IF EXISTS (SELECT 1 FROM fiscal_entities WHERE company_id = v_company AND cnpj = v_cnpj) THEN
    RAISE EXCEPTION 'Este CNPJ já está cadastrado neste workspace.';
  END IF;

  SELECT count(*) INTO v_active_count FROM fiscal_entities WHERE company_id = v_company AND status = 'active';

  -- Desmarca a padrão atual ANTES do insert (o índice único parcial não é
  -- adiável — se marcasse a nova linha como padrão antes de desmarcar a
  -- antiga, o INSERT violaria o índice).
  IF p_set_default OR v_active_count = 0 THEN
    UPDATE fiscal_entities SET is_default = false, updated_at = now()
      WHERE company_id = v_company AND is_default = true;
  END IF;

  INSERT INTO fiscal_entities (
    company_id, legal_name, trade_name, cnpj, state_registration, is_default, status, created_by
  ) VALUES (
    v_company, btrim(p_legal_name), NULLIF(btrim(coalesce(p_trade_name, '')), ''), v_cnpj,
    NULLIF(btrim(coalesce(p_state_registration, '')), ''),
    (p_set_default OR v_active_count = 0), 'active', auth.uid()
  )
  RETURNING * INTO v_row;

  INSERT INTO audit_logs (company_id, user_id, user_email, action, resource_type, resource_id, description, metadata)
  VALUES (
    v_company, auth.uid(), coalesce((SELECT email FROM profiles WHERE id = auth.uid()), ''),
    'fiscal_entity.created', 'fiscal_entities', v_row.id::text,
    'Empresa fiscal cadastrada.', jsonb_build_object('cnpj', v_cnpj, 'isDefault', v_row.is_default)
  );

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.fiscal_entities_update(
  p_entity_id uuid,
  p_legal_name text,
  p_trade_name text DEFAULT NULL,
  p_cnpj text DEFAULT NULL,
  p_state_registration text DEFAULT NULL,
  p_confirm_cnpj_change boolean DEFAULT false
)
RETURNS fiscal_entities
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company uuid;
  v_role text;
  v_cnpj text;
  v_old fiscal_entities;
  v_row fiscal_entities;
  v_action text;
BEGIN
  v_company := get_my_company_id()::uuid;
  v_role := get_my_role();
  IF v_role IS NULL OR v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Seu papel não permite editar empresas fiscais.';
  END IF;

  SELECT * INTO v_old FROM fiscal_entities WHERE id = p_entity_id AND company_id = v_company;
  IF v_old IS NULL THEN
    RAISE EXCEPTION 'Empresa fiscal não encontrada.';
  END IF;

  IF p_legal_name IS NULL OR btrim(p_legal_name) = '' THEN
    RAISE EXCEPTION 'Informe a razão social.';
  END IF;

  v_cnpj := regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g');
  IF NOT is_valid_cnpj(v_cnpj) THEN
    RAISE EXCEPTION 'Informe um CNPJ válido.';
  END IF;

  IF v_cnpj <> v_old.cnpj THEN
    IF NOT p_confirm_cnpj_change THEN
      RAISE EXCEPTION 'cnpj_change_confirmation_required';
    END IF;
    IF EXISTS (SELECT 1 FROM fiscal_entities WHERE company_id = v_company AND cnpj = v_cnpj AND id <> p_entity_id) THEN
      RAISE EXCEPTION 'Este CNPJ já está cadastrado neste workspace.';
    END IF;
    v_action := 'fiscal_entity.cnpj_changed';
  ELSE
    v_action := 'fiscal_entity.updated';
  END IF;

  UPDATE fiscal_entities SET
    legal_name = btrim(p_legal_name),
    trade_name = NULLIF(btrim(coalesce(p_trade_name, '')), ''),
    cnpj = v_cnpj,
    state_registration = NULLIF(btrim(coalesce(p_state_registration, '')), ''),
    data_incomplete = false,
    updated_at = now()
  WHERE id = p_entity_id
  RETURNING * INTO v_row;

  INSERT INTO audit_logs (company_id, user_id, user_email, action, resource_type, resource_id, description, metadata)
  VALUES (
    v_company, auth.uid(), coalesce((SELECT email FROM profiles WHERE id = auth.uid()), ''),
    v_action, 'fiscal_entities', v_row.id::text,
    'Dados da empresa fiscal atualizados.',
    jsonb_build_object('oldCnpj', v_old.cnpj, 'newCnpj', v_cnpj)
  );

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.fiscal_entities_set_default(p_entity_id uuid)
RETURNS fiscal_entities
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company uuid;
  v_role text;
  v_row fiscal_entities;
BEGIN
  v_company := get_my_company_id()::uuid;
  v_role := get_my_role();
  IF v_role IS NULL OR v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Seu papel não permite definir a empresa padrão.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM fiscal_entities WHERE id = p_entity_id AND company_id = v_company AND status = 'active') THEN
    RAISE EXCEPTION 'Empresa fiscal não encontrada.';
  END IF;

  UPDATE fiscal_entities SET is_default = false, updated_at = now()
    WHERE company_id = v_company AND is_default = true AND id <> p_entity_id;

  UPDATE fiscal_entities SET is_default = true, updated_at = now()
    WHERE id = p_entity_id
    RETURNING * INTO v_row;

  INSERT INTO audit_logs (company_id, user_id, user_email, action, resource_type, resource_id, description, metadata)
  VALUES (
    v_company, auth.uid(), coalesce((SELECT email FROM profiles WHERE id = auth.uid()), ''),
    'fiscal_entity.default_changed', 'fiscal_entities', v_row.id::text,
    'Empresa fiscal definida como padrão.', jsonb_build_object('cnpj', v_row.cnpj)
  );

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.fiscal_entities_archive(p_entity_id uuid)
RETURNS fiscal_entities
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company uuid;
  v_role text;
  v_old fiscal_entities;
  v_row fiscal_entities;
BEGIN
  v_company := get_my_company_id()::uuid;
  v_role := get_my_role();
  IF v_role IS NULL OR v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Seu papel não permite arquivar empresas fiscais.';
  END IF;

  SELECT * INTO v_old FROM fiscal_entities WHERE id = p_entity_id AND company_id = v_company AND status = 'active';
  IF v_old IS NULL THEN
    RAISE EXCEPTION 'Empresa fiscal não encontrada.';
  END IF;

  -- Cobre também "é a única ativa": por construção, a única empresa ativa é
  -- sempre a padrão (ver fiscal_entities_create/_restore), então este bloqueio
  -- sozinho já impede arquivar a única ativa sem substituta.
  IF v_old.is_default THEN
    RAISE EXCEPTION 'Defina outra empresa como padrão antes de arquivar esta.';
  END IF;

  UPDATE fiscal_entities SET status = 'archived', updated_at = now()
    WHERE id = p_entity_id
    RETURNING * INTO v_row;

  INSERT INTO audit_logs (company_id, user_id, user_email, action, resource_type, resource_id, description, metadata)
  VALUES (
    v_company, auth.uid(), coalesce((SELECT email FROM profiles WHERE id = auth.uid()), ''),
    'fiscal_entity.archived', 'fiscal_entities', v_row.id::text,
    'Empresa fiscal arquivada.', jsonb_build_object('cnpj', v_row.cnpj)
  );

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.fiscal_entities_restore(p_entity_id uuid)
RETURNS fiscal_entities
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company uuid;
  v_role text;
  v_row fiscal_entities;
  v_other_active_exists boolean;
BEGIN
  v_company := get_my_company_id()::uuid;
  v_role := get_my_role();
  IF v_role IS NULL OR v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Seu papel não permite restaurar empresas fiscais.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM fiscal_entities WHERE id = p_entity_id AND company_id = v_company AND status = 'archived') THEN
    RAISE EXCEPTION 'Empresa fiscal não encontrada.';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM fiscal_entities WHERE company_id = v_company AND status = 'active' AND id <> p_entity_id
  ) INTO v_other_active_exists;

  UPDATE fiscal_entities SET
    status = 'active',
    is_default = (is_default OR NOT v_other_active_exists),
    updated_at = now()
  WHERE id = p_entity_id
  RETURNING * INTO v_row;

  INSERT INTO audit_logs (company_id, user_id, user_email, action, resource_type, resource_id, description, metadata)
  VALUES (
    v_company, auth.uid(), coalesce((SELECT email FROM profiles WHERE id = auth.uid()), ''),
    'fiscal_entity.restored', 'fiscal_entities', v_row.id::text,
    'Empresa fiscal restaurada.', jsonb_build_object('cnpj', v_row.cnpj, 'isDefault', v_row.is_default)
  );

  RETURN v_row;
END;
$$;

-- Serviço de resolução por CNPJ exato (usado futuramente pelo processamento
-- de XML). Não seleciona por razão social/nome fantasia. Retorna NULL quando
-- não há correspondência — a ausência de linha não é um erro.
CREATE OR REPLACE FUNCTION public.fiscal_entities_find_by_cnpj(p_company_id uuid, p_cnpj text)
RETURNS fiscal_entities
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cnpj text;
  v_row fiscal_entities;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM company_members WHERE user_id = auth.uid() AND company_id = p_company_id) THEN
    RAISE EXCEPTION 'Você não tem acesso a este workspace.';
  END IF;

  v_cnpj := regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g');
  SELECT * INTO v_row FROM fiscal_entities
    WHERE company_id = p_company_id AND cnpj = v_cnpj AND status = 'active';

  RETURN v_row;
END;
$$;

-- ─── Grants ────────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.fiscal_entities_create(text, text, text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fiscal_entities_create(text, text, text, text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.fiscal_entities_create(text, text, text, text, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.fiscal_entities_update(uuid, text, text, text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fiscal_entities_update(uuid, text, text, text, text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.fiscal_entities_update(uuid, text, text, text, text, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.fiscal_entities_set_default(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fiscal_entities_set_default(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fiscal_entities_set_default(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.fiscal_entities_archive(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fiscal_entities_archive(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fiscal_entities_archive(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.fiscal_entities_restore(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fiscal_entities_restore(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fiscal_entities_restore(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.fiscal_entities_find_by_cnpj(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fiscal_entities_find_by_cnpj(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fiscal_entities_find_by_cnpj(uuid, text) TO authenticated;
