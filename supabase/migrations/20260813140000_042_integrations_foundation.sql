/*
# Integrations Foundation — ERP + Marketplace (Fase 1)

## Summary
Structural foundation only. No provider API is implemented here and no existing
behaviour changes: `erp_integrations` (read by SecurityPage) and `erp_sync_events`
(written by the erp-sync Edge Function) are left exactly as they are.

The Core never learns a provider's shape. Everything provider-specific enters
through a connection row and a connector, is normalised, and only then touches
InventoryBlind data:

  PROVIDER -> CONNECTOR -> NORMALISATION -> INTEGRATION LAYER -> CORE
  CORE -> INTEGRATION LAYER -> CONNECTOR -> PROVIDER

## What this creates
1. integration_providers        catalogue (global reference data, not tenant data)
2. integration_connections      one row per company + provider + external account
3. integration_credentials      secrets; unreachable through the API by design
4. integration_entity_links     external id <-> internal id mapping (idempotency anchor)
5. integration_stock_levels     normalised per-warehouse balance from a provider
6. integration_sync_runs        observability for every sync execution
7. integration_webhook_events   inbound webhook receipts, deduplicated

## Conventions followed (from 039_physical_count_engine, the most recent hardened
## migration in this repo)
- `company_id uuid NOT NULL DEFAULT get_my_company_id()::uuid REFERENCES companies(id)`
- policies compare `company_id::text = get_my_company_id()` because
  get_my_company_id() returns text (see 008_saas_foundation / 017_fix_company_id_type)
- `DROP POLICY IF EXISTS` before every CREATE POLICY so the file is re-runnable

## Multi-tenant defect fixed
`products_sku_unique_idx` was UNIQUE on (sku) alone — globally, across every
tenant. Two companies could never hold the same SKU, which blocks ERP imports
outright (most catalogues share SKU patterns). Replaced with (company_id, sku).
This only ever relaxes the constraint, so it cannot fail on existing data, and
products.company_id is already NOT NULL DEFAULT get_my_company_id() (020).

## Credential storage — read this before shipping a real provider
This project has no pgcrypto/Vault extension enabled, so there is no envelope
encryption available in-database today. The approach here is defence by
unreachability rather than by encryption:
  - integration_credentials has RLS enabled and NO policy for `authenticated`,
    plus an explicit REVOKE, so PostgREST can never read or write it;
  - the frontend writes a secret through integration_set_credential(), a
    SECURITY DEFINER function that accepts a secret and returns nothing —
    write-only by construction, so a token can be saved but never read back;
  - only an Edge Function holding service_role reads the secret, server-side.
Hardening step for a later phase: move the payload into Supabase Vault
(pgsodium) and keep only the Vault key name here. Documented, not implemented,
because enabling an extension is not a change this phase should smuggle in.
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. integration_providers — catalogue
--
-- Providers live as data, not as a union type in the Core: adding Bling or
-- TikTok Shop later is an INSERT, not a code change. Global reference data, so
-- it is readable by every authenticated user and writable by none of them.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS integration_providers (
  key           text PRIMARY KEY,
  name          text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('erp','marketplace')),
  -- Declared capabilities, consumed by the UI to decide which actions to offer
  -- and by the sync layer to refuse an unsupported direction early.
  capabilities  jsonb NOT NULL DEFAULT '{}',
  status        text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','beta','available','deprecated')),
  docs_url      text,
  created_at    timestamptz DEFAULT now()
);

ALTER TABLE integration_providers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "integration_providers_select" ON integration_providers;
CREATE POLICY "integration_providers_select" ON integration_providers FOR SELECT
  TO authenticated USING (true);

-- No INSERT/UPDATE/DELETE policy: the catalogue changes by migration only.

INSERT INTO integration_providers (key, name, kind, status, capabilities) VALUES
  ('tiny',           'Tiny ERP',          'erp',         'planned',
     '{"read_products":true,"read_stock":true,"read_stock_by_warehouse":true,"write_stock":true,"write_adjustment":true,"read_orders":true,"webhooks":true}'),
  ('bling',          'Bling',             'erp',         'planned',
     '{"read_products":true,"read_stock":true,"read_stock_by_warehouse":true,"write_stock":true,"write_adjustment":true,"read_orders":true,"webhooks":true}'),
  ('omie',           'Omie',              'erp',         'planned',
     '{"read_products":true,"read_stock":true,"read_stock_by_warehouse":true,"write_stock":true,"write_adjustment":true,"read_orders":true,"webhooks":false}'),
  ('sap_b1',         'SAP Business One',  'erp',         'planned',
     '{"read_products":true,"read_stock":true,"read_stock_by_warehouse":true,"write_stock":true,"write_adjustment":true,"read_orders":true,"webhooks":false}'),
  ('totvs',          'TOTVS',             'erp',         'planned',
     '{"read_products":true,"read_stock":true,"read_stock_by_warehouse":true,"write_stock":true,"write_adjustment":true,"read_orders":true,"webhooks":false}'),
  ('sankhya',        'Sankhya',           'erp',         'planned',
     '{"read_products":true,"read_stock":true,"read_stock_by_warehouse":true,"write_stock":true,"write_adjustment":true,"read_orders":true,"webhooks":false}'),
  ('custom_erp',     'ERP via API própria','erp',        'planned',
     '{"read_products":true,"read_stock":true,"write_stock":true,"write_adjustment":true}'),
  ('mercado_livre',  'Mercado Livre',     'marketplace', 'planned',
     '{"read_products":true,"read_stock":true,"write_stock":true,"read_orders":true,"webhooks":true,"multi_store":true}'),
  ('shopee',         'Shopee',            'marketplace', 'planned',
     '{"read_products":true,"read_stock":true,"write_stock":true,"read_orders":true,"webhooks":true,"multi_store":true}'),
  ('amazon',         'Amazon',            'marketplace', 'planned',
     '{"read_products":true,"read_stock":true,"write_stock":true,"read_orders":true,"webhooks":true,"multi_store":true}'),
  ('tiktok_shop',    'TikTok Shop',       'marketplace', 'planned',
     '{"read_products":true,"read_stock":true,"write_stock":true,"read_orders":true,"webhooks":true,"multi_store":true}'),
  ('shein',          'Shein',             'marketplace', 'planned',
     '{"read_products":true,"read_stock":true,"write_stock":true,"read_orders":true,"multi_store":true}'),
  ('magalu',         'Magazine Luiza',    'marketplace', 'planned',
     '{"read_products":true,"read_stock":true,"write_stock":true,"read_orders":true,"multi_store":true}')
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. integration_connections
--
-- A connection IS a store/account. One company can hold many connections to the
-- same provider (three Mercado Livre sellers, two Tiny subsidiaries), each with
-- its own credentials, status, cursor, logs and configuration. Nothing about the
-- store is inferred from logistics modality or naming.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS integration_connections (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                uuid NOT NULL DEFAULT get_my_company_id()::uuid
                              REFERENCES companies(id) ON DELETE CASCADE,
  provider_key              text NOT NULL REFERENCES integration_providers(key),
  display_name              text NOT NULL,
  -- The provider's own identifier for this account/seller/store. NULL until the
  -- first successful handshake, which is why uniqueness below coalesces it.
  external_account_id       text,
  status                    text NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','active','inactive','error','revoked')),
  -- Non-secret settings: warehouse preferences, page sizes, rate-limit tuning,
  -- which entities to sync. Never credentials.
  configuration             jsonb NOT NULL DEFAULT '{}',
  -- Sync policy is per connection because the source of truth is not universal:
  -- an ERP may own stock while a marketplace only receives it, and a second
  -- company may run the opposite arrangement.
  sync_direction            text NOT NULL DEFAULT 'inbound'
                              CHECK (sync_direction IN ('inbound','outbound','bidirectional')),
  stock_source_of_truth     boolean NOT NULL DEFAULT false,
  auto_sync_enabled         boolean NOT NULL DEFAULT false,
  sync_interval_minutes     integer CHECK (sync_interval_minutes IS NULL OR sync_interval_minutes >= 5),
  -- Cursor for incremental pulls (provider-defined: timestamp, page token, id).
  sync_cursor               text,
  -- Presence/shape of the credential, never the credential itself.
  credentials_set_at        timestamptz,
  credential_hint           text,
  last_sync_at              timestamptz,
  last_successful_sync_at   timestamptz,
  last_error                text,
  last_error_at             timestamptz,
  created_by                uuid DEFAULT auth.uid(),
  created_at                timestamptz DEFAULT now(),
  updated_at                timestamptz DEFAULT now()
);

-- Multiple stores per provider, but not two rows for the same external account.
-- COALESCE keeps the guarantee meaningful while external_account_id is still
-- NULL, which plain UNIQUE would not (NULLs compare as distinct).
CREATE UNIQUE INDEX IF NOT EXISTS integration_connections_account_unique_idx
  ON integration_connections (company_id, provider_key, COALESCE(external_account_id, ''));

CREATE INDEX IF NOT EXISTS integration_connections_company_idx
  ON integration_connections (company_id, provider_key);

ALTER TABLE integration_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "integration_connections_select" ON integration_connections;
CREATE POLICY "integration_connections_select" ON integration_connections FOR SELECT
  TO authenticated USING (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "integration_connections_insert" ON integration_connections;
CREATE POLICY "integration_connections_insert" ON integration_connections FOR INSERT
  TO authenticated
  WITH CHECK (company_id::text = get_my_company_id() AND get_my_role() IN ('owner','admin'));

DROP POLICY IF EXISTS "integration_connections_update" ON integration_connections;
CREATE POLICY "integration_connections_update" ON integration_connections FOR UPDATE
  TO authenticated
  USING (company_id::text = get_my_company_id() AND get_my_role() IN ('owner','admin'))
  WITH CHECK (company_id::text = get_my_company_id() AND get_my_role() IN ('owner','admin'));

DROP POLICY IF EXISTS "integration_connections_delete" ON integration_connections;
CREATE POLICY "integration_connections_delete" ON integration_connections FOR DELETE
  TO authenticated
  USING (company_id::text = get_my_company_id() AND get_my_role() IN ('owner','admin'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. integration_credentials — deliberately unreachable through the API
--
-- RLS is on and there is no policy for `authenticated`, so PostgREST returns
-- nothing and accepts nothing. The REVOKE makes that explicit rather than
-- implicit. Reads happen only from an Edge Function using service_role.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS integration_credentials (
  connection_id  uuid PRIMARY KEY REFERENCES integration_connections(id) ON DELETE CASCADE,
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  -- Opaque to this layer: an API key, an OAuth token bundle as JSON, whatever
  -- the connector needs. See the credential note in the file header before
  -- treating this as encrypted — it is not, it is unreachable.
  secret         text NOT NULL,
  masked_hint    text,
  expires_at     timestamptz,
  updated_by     uuid,
  updated_at     timestamptz DEFAULT now(),
  created_at     timestamptz DEFAULT now()
);

ALTER TABLE integration_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON integration_credentials FROM authenticated, anon;

-- Write-only path for the client: saves a secret, returns nothing, and cannot
-- be used to read one back. Guards duplicate the RLS intent because a
-- SECURITY DEFINER function bypasses RLS by design.
CREATE OR REPLACE FUNCTION integration_set_credential(
  p_connection_id uuid,
  p_secret        text,
  p_hint          text DEFAULT NULL,
  p_expires_at    timestamptz DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_company uuid;
BEGIN
  IF get_my_role() IS NULL OR get_my_role() NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Apenas owner ou admin podem configurar credenciais de integração.';
  END IF;

  IF p_secret IS NULL OR length(trim(p_secret)) = 0 THEN
    RAISE EXCEPTION 'Credencial vazia.';
  END IF;

  SELECT company_id INTO v_company
    FROM integration_connections
   WHERE id = p_connection_id;

  IF v_company IS NULL OR v_company::text <> get_my_company_id() THEN
    RAISE EXCEPTION 'Conexão não encontrada nesta empresa.';
  END IF;

  INSERT INTO integration_credentials
    (connection_id, company_id, secret, masked_hint, expires_at, updated_by, updated_at)
  VALUES
    (p_connection_id, v_company, p_secret, p_hint, p_expires_at, auth.uid(), now())
  ON CONFLICT (connection_id) DO UPDATE SET
    secret      = EXCLUDED.secret,
    masked_hint = EXCLUDED.masked_hint,
    expires_at  = EXCLUDED.expires_at,
    updated_by  = EXCLUDED.updated_by,
    updated_at  = now();

  UPDATE integration_connections
     SET credentials_set_at = now(),
         credential_hint    = p_hint,
         updated_at         = now()
   WHERE id = p_connection_id;
END;
$$;

REVOKE ALL ON FUNCTION integration_set_credential(uuid, text, text, timestamptz) FROM public, anon;
GRANT EXECUTE ON FUNCTION integration_set_credential(uuid, text, text, timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION integration_clear_credential(p_connection_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_company uuid;
BEGIN
  IF get_my_role() IS NULL OR get_my_role() NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Apenas owner ou admin podem remover credenciais de integração.';
  END IF;

  SELECT company_id INTO v_company
    FROM integration_connections
   WHERE id = p_connection_id;

  IF v_company IS NULL OR v_company::text <> get_my_company_id() THEN
    RAISE EXCEPTION 'Conexão não encontrada nesta empresa.';
  END IF;

  DELETE FROM integration_credentials WHERE connection_id = p_connection_id;

  UPDATE integration_connections
     SET credentials_set_at = NULL,
         credential_hint    = NULL,
         status             = CASE WHEN status = 'active' THEN 'inactive' ELSE status END,
         updated_at         = now()
   WHERE id = p_connection_id;
END;
$$;

REVOKE ALL ON FUNCTION integration_clear_credential(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION integration_clear_credential(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. integration_entity_links — the mapping table and the idempotency anchor
--
-- Matching is by stable external identifier first; sku/ean are recorded so a
-- connector can fall back and so a human can resolve an unmatched row. A NULL
-- internal_id is a legitimate state: "the provider has this, we have not linked
-- it yet", which is what an import review screen reads.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS integration_entity_links (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL DEFAULT get_my_company_id()::uuid
                    REFERENCES companies(id) ON DELETE CASCADE,
  connection_id   uuid NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
  entity_type     text NOT NULL CHECK (entity_type IN
                    ('product','variant','location','warehouse','brand','category','order')),
  internal_id     uuid,
  external_id     text NOT NULL,
  external_sku    text,
  external_ean    text,
  external_code   text,
  external_name   text,
  -- Last raw snapshot of the external record, for debugging a bad mapping and
  -- for re-normalising without another API round trip.
  external_payload jsonb,
  match_source    text CHECK (match_source IN ('external_id','sku','ean','manual','created')),
  last_synced_at  timestamptz,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  -- Running the same sync twice must not create a second link for the same
  -- external record. This is the constraint that makes ingestion idempotent.
  CONSTRAINT integration_entity_links_external_unique
    UNIQUE (connection_id, entity_type, external_id)
);

CREATE INDEX IF NOT EXISTS integration_entity_links_internal_idx
  ON integration_entity_links (company_id, entity_type, internal_id);
CREATE INDEX IF NOT EXISTS integration_entity_links_sku_idx
  ON integration_entity_links (connection_id, entity_type, external_sku);

ALTER TABLE integration_entity_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "integration_entity_links_select" ON integration_entity_links;
CREATE POLICY "integration_entity_links_select" ON integration_entity_links FOR SELECT
  TO authenticated USING (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "integration_entity_links_insert" ON integration_entity_links;
CREATE POLICY "integration_entity_links_insert" ON integration_entity_links FOR INSERT
  TO authenticated WITH CHECK (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "integration_entity_links_update" ON integration_entity_links;
CREATE POLICY "integration_entity_links_update" ON integration_entity_links FOR UPDATE
  TO authenticated
  USING (company_id::text = get_my_company_id())
  WITH CHECK (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "integration_entity_links_delete" ON integration_entity_links;
CREATE POLICY "integration_entity_links_delete" ON integration_entity_links FOR DELETE
  TO authenticated
  USING (company_id::text = get_my_company_id() AND get_my_role() IN ('owner','admin','manager'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. integration_stock_levels — normalised per-warehouse balance
--
-- The Core stores one scalar balance (products.stock_quantity) and one free-text
-- location, so it has nowhere to put "1.200 in CD-SP, 300 in CD-RJ, 40 reserved".
-- Ingested balances land here first, keyed to the mapping row, and reconciling
-- them into the Core is a later, explicit decision — so a provider pull can
-- never silently overwrite a counted balance.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS integration_stock_levels (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid NOT NULL DEFAULT get_my_company_id()::uuid
                           REFERENCES companies(id) ON DELETE CASCADE,
  connection_id          uuid NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
  entity_link_id         uuid NOT NULL REFERENCES integration_entity_links(id) ON DELETE CASCADE,
  external_warehouse_id  text NOT NULL DEFAULT '',
  external_warehouse_name text,
  quantity               numeric NOT NULL DEFAULT 0,
  -- Both nullable: plenty of ERPs expose neither, and 0 would be a lie.
  reserved_quantity      numeric,
  available_quantity     numeric,
  observed_at            timestamptz NOT NULL DEFAULT now(),
  created_at             timestamptz DEFAULT now(),
  updated_at             timestamptz DEFAULT now(),
  CONSTRAINT integration_stock_levels_unique
    UNIQUE (connection_id, entity_link_id, external_warehouse_id)
);

CREATE INDEX IF NOT EXISTS integration_stock_levels_company_idx
  ON integration_stock_levels (company_id, connection_id);

ALTER TABLE integration_stock_levels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "integration_stock_levels_select" ON integration_stock_levels;
CREATE POLICY "integration_stock_levels_select" ON integration_stock_levels FOR SELECT
  TO authenticated USING (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "integration_stock_levels_insert" ON integration_stock_levels;
CREATE POLICY "integration_stock_levels_insert" ON integration_stock_levels FOR INSERT
  TO authenticated WITH CHECK (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "integration_stock_levels_update" ON integration_stock_levels;
CREATE POLICY "integration_stock_levels_update" ON integration_stock_levels FOR UPDATE
  TO authenticated
  USING (company_id::text = get_my_company_id())
  WITH CHECK (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "integration_stock_levels_delete" ON integration_stock_levels;
CREATE POLICY "integration_stock_levels_delete" ON integration_stock_levels FOR DELETE
  TO authenticated
  USING (company_id::text = get_my_company_id() AND get_my_role() IN ('owner','admin'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. integration_sync_runs — one row per execution, in either direction
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS integration_sync_runs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL DEFAULT get_my_company_id()::uuid
                      REFERENCES companies(id) ON DELETE CASCADE,
  connection_id     uuid NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
  entity_type       text NOT NULL CHECK (entity_type IN
                      ('product','variant','location','warehouse','brand','category','order','stock','adjustment')),
  direction         text NOT NULL CHECK (direction IN ('inbound','outbound')),
  trigger_source    text NOT NULL DEFAULT 'manual'
                      CHECK (trigger_source IN ('manual','schedule','webhook','system')),
  status            text NOT NULL DEFAULT 'running'
                      CHECK (status IN ('running','success','partial','failed','cancelled')),
  processed_count   integer NOT NULL DEFAULT 0,
  created_count     integer NOT NULL DEFAULT 0,
  updated_count     integer NOT NULL DEFAULT 0,
  skipped_count     integer NOT NULL DEFAULT 0,
  failed_count      integer NOT NULL DEFAULT 0,
  cursor_before     text,
  cursor_after      text,
  -- Human-readable failure only. Never a token, never a full credential-bearing
  -- request; connectors are responsible for redacting before they write here.
  error_message     text,
  started_at        timestamptz NOT NULL DEFAULT now(),
  finished_at       timestamptz,
  duration_ms       integer,
  triggered_by      uuid DEFAULT auth.uid(),
  -- Lets a retried trigger (double click, webhook redelivery, cron overlap)
  -- resolve to the same run instead of a second one.
  idempotency_key   uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at        timestamptz DEFAULT now(),
  CONSTRAINT integration_sync_runs_idempotency_unique UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS integration_sync_runs_connection_idx
  ON integration_sync_runs (connection_id, started_at DESC);

ALTER TABLE integration_sync_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "integration_sync_runs_select" ON integration_sync_runs;
CREATE POLICY "integration_sync_runs_select" ON integration_sync_runs FOR SELECT
  TO authenticated USING (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "integration_sync_runs_insert" ON integration_sync_runs;
CREATE POLICY "integration_sync_runs_insert" ON integration_sync_runs FOR INSERT
  TO authenticated WITH CHECK (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "integration_sync_runs_update" ON integration_sync_runs;
CREATE POLICY "integration_sync_runs_update" ON integration_sync_runs FOR UPDATE
  TO authenticated
  USING (company_id::text = get_my_company_id())
  WITH CHECK (company_id::text = get_my_company_id());

-- No DELETE policy: a sync history that can be quietly erased is not a history.

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. integration_webhook_events — inbound receipts, deduplicated
--
-- company_id/connection_id are nullable because a webhook arrives before it is
-- resolved to a tenant; until then the row is invisible to every user, which is
-- the correct default. Resolution happens server-side in the receiver.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS integration_webhook_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid REFERENCES companies(id) ON DELETE CASCADE,
  connection_id     uuid REFERENCES integration_connections(id) ON DELETE CASCADE,
  provider_key      text NOT NULL REFERENCES integration_providers(key),
  event_type        text,
  external_event_id text NOT NULL,
  payload           jsonb,
  signature_valid   boolean,
  status            text NOT NULL DEFAULT 'received'
                      CHECK (status IN ('received','processed','failed','ignored')),
  error_message     text,
  received_at       timestamptz NOT NULL DEFAULT now(),
  processed_at      timestamptz,
  -- A provider redelivering the same event must not be processed twice.
  CONSTRAINT integration_webhook_events_unique UNIQUE (provider_key, external_event_id)
);

CREATE INDEX IF NOT EXISTS integration_webhook_events_pending_idx
  ON integration_webhook_events (status, received_at);

ALTER TABLE integration_webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "integration_webhook_events_select" ON integration_webhook_events;
CREATE POLICY "integration_webhook_events_select" ON integration_webhook_events FOR SELECT
  TO authenticated
  USING (company_id::text = get_my_company_id() AND get_my_role() IN ('owner','admin'));

-- No INSERT/UPDATE/DELETE for `authenticated`: only the webhook receiver
-- (service_role, server-side) writes here.

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Multi-tenant defect: SKU uniqueness was global
--
-- See the header. Strictly a relaxation, so it cannot fail on existing rows.
-- ─────────────────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS products_sku_unique_idx;
CREATE UNIQUE INDEX IF NOT EXISTS products_company_sku_unique_idx
  ON products (company_id, sku);

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. updated_at triggers, reusing the helper the repo already installs
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
    DROP TRIGGER IF EXISTS integration_connections_updated_at ON integration_connections;
    CREATE TRIGGER integration_connections_updated_at
      BEFORE UPDATE ON integration_connections
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

    DROP TRIGGER IF EXISTS integration_entity_links_updated_at ON integration_entity_links;
    CREATE TRIGGER integration_entity_links_updated_at
      BEFORE UPDATE ON integration_entity_links
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

    DROP TRIGGER IF EXISTS integration_stock_levels_updated_at ON integration_stock_levels;
    CREATE TRIGGER integration_stock_levels_updated_at
      BEFORE UPDATE ON integration_stock_levels
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;
