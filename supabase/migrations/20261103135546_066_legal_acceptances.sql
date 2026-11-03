/*
# Registro de aceite de Termos e Política de Privacidade

## Summary
Tabela `legal_acceptances` + RPC `legal_record_acceptance`. Um aceite é um fato
histórico: entra e nunca muda.

## Decisões
- `accepted_at` e `created_at` são `now()` do BANCO. Data vinda do navegador é
  controlada pelo cliente e não serve como prova de quando o aceite ocorreu.
- Nada de IP, geolocalização ou fingerprint nesta etapa — coletar dado pessoal
  extra para provar um aceite é exatamente o oposto do objetivo.
- `company_id` é gravado quando existe. No cadastro de uma empresa nova o aceite
  acontece ANTES de a empresa existir (o perfil ainda não tem company_id), então
  a coluna é nula nesses casos e isso é estado válido, não erro.
- SEM policies de UPDATE e DELETE: não existindo policy, `authenticated` não
  consegue alterar nem apagar um aceite. Só o service_role (fora da RLS) pode,
  o que mantém a porta aberta para correção administrativa auditada no futuro.
- INSERT direto NÃO é liberado. A inserção passa por RPC porque as versões
  (`terms_version`/`privacy_version`) são a substância do registro: um INSERT
  livre deixaria o cliente gravar "aceitei a v0.1" enquanto lê a v1.0. A RPC
  recebe as versões apresentadas e as valida contra a lista de versões aceitáveis
  mantida no banco (`legal_document_versions`), então uma versão inventada é
  recusada.

## Multiempresa
`company_id::text = get_my_company_id()` no SELECT de administrador, mesmo
padrão de todas as tabelas do projeto. Um usuário sempre vê os próprios aceites;
owner/admin veem os da própria empresa. Nunca entre empresas.
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Versões válidas dos documentos
--
-- Serve para a RPC recusar uma versão que nunca existiu. A aplicação mantém a
-- versão vigente em src/config/legal.ts; esta tabela é a lista do que o banco
-- reconhece como versão real, e é o que impede um cliente de gravar aceite de
-- uma versão arbitrária.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS legal_document_versions (
  document_type  text NOT NULL CHECK (document_type IN ('terms','privacy')),
  version        text NOT NULL,
  effective_date date NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_type, version)
);

ALTER TABLE legal_document_versions ENABLE ROW LEVEL SECURITY;

-- Leitura liberada para qualquer autenticado: é conteúdo público (que versão do
-- documento está no ar), sem nenhum dado pessoal.
DROP POLICY IF EXISTS "legal_document_versions_select" ON legal_document_versions;
CREATE POLICY "legal_document_versions_select" ON legal_document_versions FOR SELECT
  TO authenticated USING (true);

-- Sem policies de escrita: versões novas entram por migration, junto da
-- alteração de src/config/legal.ts, para os dois lados não divergirem.
INSERT INTO legal_document_versions (document_type, version, effective_date) VALUES
  ('terms',   '1.0.0-preliminar', '2026-08-20'),
  ('privacy', '1.0.0-preliminar', '2026-08-20')
ON CONFLICT (document_type, version) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. legal_acceptances
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS legal_acceptances (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Nulo quando o aceite ocorre antes de a empresa existir (cadastro novo).
  company_id      uuid REFERENCES companies(id) ON DELETE SET NULL,
  terms_version   text NOT NULL,
  privacy_version text NOT NULL,
  -- Do banco, sempre. Ver o cabeçalho.
  accepted_at     timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS legal_acceptances_user_idx
  ON legal_acceptances (user_id, accepted_at DESC);
CREATE INDEX IF NOT EXISTS legal_acceptances_company_idx
  ON legal_acceptances (company_id, accepted_at DESC);

ALTER TABLE legal_acceptances ENABLE ROW LEVEL SECURITY;

-- O próprio usuário sempre vê os próprios aceites, inclusive os gravados antes
-- de ter empresa (company_id nulo).
DROP POLICY IF EXISTS "legal_acceptances_select_own" ON legal_acceptances;
CREATE POLICY "legal_acceptances_select_own" ON legal_acceptances FOR SELECT
  TO authenticated USING (user_id = auth.uid());

-- owner/admin veem os aceites da PRÓPRIA empresa. `company_id IS NOT NULL`
-- explícito: sem isso, um aceite órfão (empresa apagada, SET NULL) vazaria para
-- qualquer administrador, porque NULL não casa com nenhuma comparação mas a
-- ausência da condição deixaria a linha visível a quem tem o papel.
DROP POLICY IF EXISTS "legal_acceptances_select_company_admin" ON legal_acceptances;
CREATE POLICY "legal_acceptances_select_company_admin" ON legal_acceptances FOR SELECT
  TO authenticated USING (
    company_id IS NOT NULL
    AND company_id::text = get_my_company_id()
    AND get_my_role() IN ('owner','admin')
  );

-- Nenhuma policy de INSERT/UPDATE/DELETE, de propósito. Ver o cabeçalho.

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. legal_record_acceptance
--
-- Idempotente por (usuário, par de versões): chamar duas vezes com as mesmas
-- versões devolve o aceite já existente em vez de empilhar linhas. Isso é o que
-- permite retomar com segurança quando a autenticação conclui mas o registro do
-- aceite falha — o cliente pode simplesmente tentar de novo.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.legal_record_acceptance(
  p_terms_version   text,
  p_privacy_version text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_user_id    uuid;
  v_company_id uuid;
  v_existing   uuid;
  v_id         uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'É necessário estar autenticado para registrar o aceite.';
  END IF;

  -- A versão precisa ser uma que o banco reconheça. Sem isto, um cliente
  -- alterado gravaria aceite de uma versão que nunca foi publicada.
  IF NOT EXISTS (
    SELECT 1 FROM legal_document_versions
    WHERE document_type = 'terms' AND version = p_terms_version
  ) THEN
    RAISE EXCEPTION 'Versão dos Termos de Uso desconhecida: %', p_terms_version;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM legal_document_versions
    WHERE document_type = 'privacy' AND version = p_privacy_version
  ) THEN
    RAISE EXCEPTION 'Versão da Política de Privacidade desconhecida: %', p_privacy_version;
  END IF;

  -- Empresa resolvida no servidor, nunca recebida do cliente. Nula é válido:
  -- no cadastro de empresa nova o aceite vem antes de a empresa existir.
  SELECT company_id INTO v_company_id FROM profiles WHERE id = v_user_id;

  SELECT id INTO v_existing
  FROM legal_acceptances
  WHERE user_id = v_user_id
    AND terms_version = p_terms_version
    AND privacy_version = p_privacy_version
  ORDER BY accepted_at ASC
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    -- Já aceitou estas versões. Se na primeira vez ainda não havia empresa e
    -- agora há, completa o vínculo — sem criar aceite novo nem mexer na data.
    IF v_company_id IS NOT NULL THEN
      UPDATE legal_acceptances
      SET company_id = v_company_id
      WHERE id = v_existing AND company_id IS NULL;
    END IF;
    RETURN v_existing;
  END IF;

  INSERT INTO legal_acceptances (user_id, company_id, terms_version, privacy_version)
  VALUES (v_user_id, v_company_id, p_terms_version, p_privacy_version)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.legal_record_acceptance(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.legal_record_acceptance(text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.legal_record_acceptance(text, text) TO authenticated;
