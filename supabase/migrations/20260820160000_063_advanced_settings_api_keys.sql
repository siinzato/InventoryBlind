/*
# Configurações Avançadas — Chaves de API (Fase 1/3)

## Summary
Chave de API gerada pela própria empresa para autenticar chamadas externas à
Edge Function `public-api`. Só o HASH (SHA-256) é armazenado — o valor em
texto puro só existe na resposta de `api_key_create`, uma única vez, e nunca
mais é lido de volta pelo banco.

## Isolamento
`company_id` sempre vem de `get_my_company_id()` (perfil do usuário
autenticado) dentro das RPCs — nunca de um parâmetro enviado pelo cliente.
A validação da chave em `public-api` (service_role) também nunca recebe
company_id do chamador: ele vem exclusivamente da linha encontrada por
`key_hash`.

## Por que hash e não o valor cru
Mesmo padrão de segredo usado em `integration_credentials`/
`integration_webhook_secrets` (defesa por impossibilidade de leitura), mas
aqui o valor nem precisa ser lido de volta pelo servidor: SHA-256 do valor
apresentado é comparado contra o hash guardado, então nem um dump do banco
expõe a chave usável.
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. api_keys
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name         text NOT NULL,
  key_prefix   text NOT NULL,
  key_hash     text NOT NULL,
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at   timestamptz,
  revoked_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Único: garante que o hash resolve no máximo uma chave (probabilidade de
-- colisão de SHA-256 é desprezível; a constraint só formaliza a invariante).
CREATE UNIQUE INDEX IF NOT EXISTS api_keys_hash_unique_idx ON api_keys (key_hash);
CREATE INDEX IF NOT EXISTS api_keys_company_idx ON api_keys (company_id);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

-- Só owner/admin da própria empresa veem as chaves (metadados — nunca o
-- valor cru, que nunca é gravado). Mutação só pelas RPCs abaixo: sem policy
-- de INSERT/UPDATE/DELETE, RLS nega por padrão.
DROP POLICY IF EXISTS "api_keys_select" ON api_keys;
CREATE POLICY "api_keys_select" ON api_keys FOR SELECT
  TO authenticated
  USING (company_id::text = get_my_company_id() AND get_my_role() IN ('owner','admin'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. api_key_create — gera, retorna o valor em texto puro UMA VEZ
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION api_key_create(p_name text)
RETURNS TABLE(id uuid, plaintext_key text, key_prefix text, created_at timestamptz)
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

  -- 24 bytes aleatórios = 192 bits de entropia, bem acima do necessário para
  -- inviabilizar adivinhação por força bruta.
  v_raw    := 'ibk_' || encode(extensions.gen_random_bytes(24), 'hex');
  v_prefix := left(v_raw, 12);
  v_hash   := encode(extensions.digest(v_raw, 'sha256'), 'hex');

  INSERT INTO api_keys (company_id, name, key_prefix, key_hash, created_by)
  VALUES (v_company, trim(p_name), v_prefix, v_hash, auth.uid())
  RETURNING api_keys.id, api_keys.created_at INTO v_id, v_created;

  RETURN QUERY SELECT v_id, v_raw, v_prefix, v_created;
END;
$$;

REVOKE ALL ON FUNCTION api_key_create(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION api_key_create(text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. api_key_revoke
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION api_key_revoke(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_company uuid;
  v_role    text;
BEGIN
  v_role := get_my_role();
  IF v_role IS NULL OR v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Apenas owner ou admin podem revogar chaves de API.';
  END IF;
  v_company := get_my_company_id()::uuid;

  UPDATE api_keys
  SET revoked_at = now(), revoked_by = auth.uid()
  WHERE id = p_id AND company_id = v_company AND revoked_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Chave não encontrada ou já revogada.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION api_key_revoke(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION api_key_revoke(uuid) TO authenticated;

COMMENT ON TABLE api_keys IS 'Chaves de API por empresa. Só o hash é armazenado; o valor cru só existe na resposta de api_key_create.';
