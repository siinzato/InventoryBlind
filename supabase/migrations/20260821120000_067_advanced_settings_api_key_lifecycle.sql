/*
# Configurações Avançadas > API — ciclo de vida da chave

## Summary
Evolui a migration 063 (não a substitui): a chave passa a ter descrição
opcional e expiração opcional, e uma chave já revogada pode ser excluída da
lista. Nada do que existe muda de comportamento.

## Compatibilidade com as chaves já criadas
`description` e `expires_at` entram como NULL. `expires_at IS NULL` significa
"sem expiração" — exatamente o comportamento que as chaves antigas já tinham,
então nenhuma chave existente passa a falhar.

## Por que DROP + CREATE em vez de CREATE OR REPLACE
`api_key_create` ganha dois parâmetros e uma coluna a mais no retorno; o
Postgres não permite trocar o tipo de retorno com CREATE OR REPLACE. Manter a
versão de 1 argumento junto com a nova tornaria `api_key_create(p_name => ...)`
ambígua, então a antiga é removida e a nova recebe DEFAULT nos parâmetros
novos — uma chamada só com `p_name` (front-end anterior ainda em cache do
navegador durante o deploy) continua resolvendo para a função nova.

## O segredo continua sem existir no banco
Nada aqui grava a chave em texto puro. O valor cru continua existindo apenas
na linha de retorno de `api_key_create`, uma única vez.
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Colunas novas (aditivas, nullable — nenhuma linha existente é tocada)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS expires_at   timestamptz;

COMMENT ON COLUMN api_keys.expires_at IS
  'NULL = sem expiração (comportamento das chaves criadas antes desta migration).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. api_key_create — agora com descrição e expiração
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS api_key_create(text);

CREATE OR REPLACE FUNCTION api_key_create(
  p_name        text,
  p_description text        DEFAULT NULL,
  p_expires_at  timestamptz DEFAULT NULL
)
RETURNS TABLE(id uuid, plaintext_key text, key_prefix text, created_at timestamptz, expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_company uuid;
  v_role    text;
  v_raw     text;
  v_prefix  text;
  v_hash    text;
  v_id      uuid;
  v_created timestamptz;
  v_desc    text;
BEGIN
  v_role := get_my_role();
  IF v_role IS NULL OR v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Apenas owner ou admin podem criar chaves de API.';
  END IF;

  v_company := get_my_company_id()::uuid;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Empresa não identificada.';
  END IF;

  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'Informe um nome para identificar a chave.';
  END IF;

  IF p_expires_at IS NOT NULL AND p_expires_at <= now() THEN
    RAISE EXCEPTION 'A data de expiração precisa ser no futuro.';
  END IF;

  v_desc := nullif(btrim(coalesce(p_description, '')), '');

  -- 24 bytes aleatórios = 192 bits de entropia, bem acima do necessário para
  -- inviabilizar adivinhação por força bruta.
  v_raw    := 'ibk_' || encode(extensions.gen_random_bytes(24), 'hex');
  v_prefix := left(v_raw, 12);
  v_hash   := encode(extensions.digest(v_raw, 'sha256'), 'hex');

  INSERT INTO api_keys (company_id, name, description, key_prefix, key_hash, created_by, expires_at)
  VALUES (v_company, trim(p_name), v_desc, v_prefix, v_hash, auth.uid(), p_expires_at)
  RETURNING api_keys.id, api_keys.created_at INTO v_id, v_created;

  RETURN QUERY SELECT v_id, v_raw, v_prefix, v_created, p_expires_at;
END;
$$;

REVOKE ALL ON FUNCTION api_key_create(text, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION api_key_create(text, text, timestamptz) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. api_key_delete — só uma chave JÁ revogada some da lista
--
--    Excluir uma chave ativa seria uma porta de saída silenciosa: a linha
--    sumiria e ninguém saberia que o segredo continua circulando por aí. Exigir
--    a revogação antes garante que o encerramento passa pelo caminho auditado.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION api_key_delete(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_company uuid;
  v_role    text;
BEGIN
  v_role := get_my_role();
  IF v_role IS NULL OR v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Apenas owner ou admin podem excluir chaves de API.';
  END IF;
  v_company := get_my_company_id()::uuid;

  DELETE FROM api_keys
   WHERE id = p_id AND company_id = v_company AND revoked_at IS NOT NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Só é possível excluir uma chave já revogada.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION api_key_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION api_key_delete(uuid) TO authenticated;
