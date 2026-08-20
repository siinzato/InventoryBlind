/*
# NF-e — Bloqueio de requisições ao provedor de busca por chave (Etapa 2)

## Summary
Suporte para a importação automática de NF-e via chave de acesso (busca por
provedor externo, ex.: Meu Danfe, feita pela Edge Function nfe-fetch-by-key).
Esta migration cuida apenas do controle de concorrência/rate-limit no banco —
o parsing do XML, o vínculo produto-a-produto e a criação da nota continuam
100% em nfeService.importNfeXml (reaproveitado tal como já existe desde a
migration 018/019, nenhuma lógica duplicada).

## New Table
nfe_provider_fetch_locks — um registro por (empresa, chave de acesso), guarda
só o instante da última tentativa de busca naquele provedor para aquela chave.
Não é lida/gravada diretamente pelo client (sem policies para authenticated);
só a função nfe_claim_key_fetch (SECURITY DEFINER) toca nela.

## New Function
nfe_claim_key_fetch(p_invoice_key text) returns boolean — tenta reservar o
direito de chamar o provedor externo para aquela chave nesta empresa; retorna
false se já houve uma tentativa há menos de 1 segundo (evita rajada de
cliques/duplo clique disparando duas buscas na mesma chave). Atômico via
INSERT ... ON CONFLICT ... DO UPDATE ... WHERE, sem race condition entre
chamadas concorrentes.
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. nfe_provider_fetch_locks
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nfe_provider_fetch_locks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  invoice_key       text NOT NULL,
  last_requested_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT nfe_provider_fetch_locks_unique UNIQUE (company_id, invoice_key)
);

CREATE INDEX IF NOT EXISTS nfe_provider_fetch_locks_company_idx
  ON nfe_provider_fetch_locks (company_id);

ALTER TABLE nfe_provider_fetch_locks ENABLE ROW LEVEL SECURITY;
-- Sem policies para authenticated/anon: só a função SECURITY DEFINER abaixo
-- (dona do owner da migration, com bypassrls) grava/lê esta tabela.

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. nfe_claim_key_fetch
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nfe_claim_key_fetch(p_invoice_key text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_company  text;
  v_claimed  uuid;
BEGIN
  v_company := get_my_company_id();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No active company';
  END IF;

  INSERT INTO nfe_provider_fetch_locks (company_id, invoice_key, last_requested_at)
  VALUES (v_company::uuid, p_invoice_key, now())
  ON CONFLICT (company_id, invoice_key)
  DO UPDATE SET last_requested_at = now()
    WHERE nfe_provider_fetch_locks.last_requested_at < now() - interval '1 second'
  RETURNING id INTO v_claimed;

  RETURN v_claimed IS NOT NULL;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.nfe_claim_key_fetch(text) TO authenticated;
