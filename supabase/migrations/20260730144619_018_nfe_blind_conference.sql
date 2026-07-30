/*
# NF-e Blind Conference — Core Structures (Etapa 1)

## Summary
Adds the operational core for blind conference by fiscal invoice (NF-e):
XML import → product association → mandatory preparation → blind counting →
atomic finalization → report & history. Fully multi-tenant and secure.

## New Tables
1. nfe_invoices — invoice header (one per imported NF-e).
   - company_id (uuid): active company, derived from the caller, never trusted from client.
   - invoice_key (text): NF-e access key (chave), unique per company.
   - invoice_number / invoice_series / issue_date / supplier_name / supplier_cnpj.
   - status: not_started | in_progress | completed | with_divergences.
   - total_items, raw_xml (reference copy).
   - Audit: created_by, started_at, started_by, finished_at, finished_by, timestamps.
2. nfe_invoice_items — one row per NF-e line item.
   - expected_quantity (from NF), physical_quantity (counted, blind until finalize).
   - nfe_code (cProd), description (xProd), unit, unit/total value.
   - nfe_ean (valid original), nfe_ean_normalized (comparison form).
   - product_id (link into shared products catalog), link_method.
   - result_status (computed only at finalization).
   - Immutable snapshot at finalization: snapshot_product_name/sku/ean.
3. nfe_learned_associations — learned SKU/EAN → product mappings per company (fallback only).
4. nfe_count_events — immutable audit log of every count action, with global-unique idempotency_key.

## Atomic RPCs (SECURITY DEFINER, company + status validated inside)
- nfe_start_conference: locks invoice, blocks if any item is unlinked, sets in_progress + started_at/by.
- nfe_register_count: locks item, idempotent by idempotency_key, increment|set, never negative, writes event + updates physical_quantity.
- nfe_finalize_conference: locks invoice, prevents double finalize, computes per-item status, writes snapshot, sets completed/with_divergences.
- nfe_reopen_conference: manager/admin/owner only, never erases prior counts, resets to in_progress for recount.

## Security (RLS)
- The app has authenticated sign-in. Every table is company-scoped via
  company_id::text = get_my_company_id() (helper already exists).
- company_id defaults to get_my_company_id()::uuid so the client never supplies it,
  and WITH CHECK rejects any foreign company_id.
- nfe_count_events is immutable: only SELECT + INSERT policies (no UPDATE/DELETE).
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. nfe_invoices
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nfe_invoices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL DEFAULT get_my_company_id()::uuid REFERENCES companies(id) ON DELETE CASCADE,
  invoice_key    text NOT NULL,
  invoice_number text,
  invoice_series text,
  issue_date     timestamptz,
  supplier_name  text,
  supplier_cnpj  text,
  status         text NOT NULL DEFAULT 'not_started'
                 CHECK (status IN ('not_started','in_progress','completed','with_divergences')),
  total_items    integer NOT NULL DEFAULT 0,
  raw_xml        text,
  created_by     uuid DEFAULT auth.uid(),
  started_at     timestamptz,
  started_by     uuid,
  finished_at    timestamptz,
  finished_by    uuid,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now(),
  CONSTRAINT nfe_invoices_company_key_unique UNIQUE (company_id, invoice_key)
);

CREATE INDEX IF NOT EXISTS nfe_invoices_company_idx        ON nfe_invoices (company_id);
CREATE INDEX IF NOT EXISTS nfe_invoices_company_status_idx ON nfe_invoices (company_id, status);
CREATE INDEX IF NOT EXISTS nfe_invoices_company_created_idx ON nfe_invoices (company_id, created_at DESC);

ALTER TABLE nfe_invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "nfe_invoices_select" ON nfe_invoices;
CREATE POLICY "nfe_invoices_select" ON nfe_invoices FOR SELECT
  TO authenticated USING (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "nfe_invoices_insert" ON nfe_invoices;
CREATE POLICY "nfe_invoices_insert" ON nfe_invoices FOR INSERT
  TO authenticated WITH CHECK (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "nfe_invoices_update" ON nfe_invoices;
CREATE POLICY "nfe_invoices_update" ON nfe_invoices FOR UPDATE
  TO authenticated
  USING (company_id::text = get_my_company_id())
  WITH CHECK (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "nfe_invoices_delete" ON nfe_invoices;
CREATE POLICY "nfe_invoices_delete" ON nfe_invoices FOR DELETE
  TO authenticated
  USING (company_id::text = get_my_company_id() AND get_my_role() IN ('owner','admin','manager'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. nfe_invoice_items
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nfe_invoice_items (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id           uuid NOT NULL REFERENCES nfe_invoices(id) ON DELETE CASCADE,
  company_id           uuid NOT NULL DEFAULT get_my_company_id()::uuid REFERENCES companies(id) ON DELETE CASCADE,
  line_number          integer,
  nfe_code             text,
  description          text,
  unit                 text,
  expected_quantity    numeric NOT NULL DEFAULT 0,
  unit_value           numeric,
  total_value          numeric,
  nfe_ean              text,
  nfe_ean_normalized   text,
  product_id           uuid REFERENCES products(id) ON DELETE SET NULL,
  link_method          text NOT NULL DEFAULT 'none'
                       CHECK (link_method IN ('none','sku','ean','learned','manual')),
  physical_quantity    numeric,
  result_status        text
                       CHECK (result_status IS NULL OR result_status IN ('unlinked','pending','ok','missing','surplus')),
  snapshot_product_name text,
  snapshot_sku          text,
  snapshot_ean          text,
  created_at           timestamptz DEFAULT now(),
  updated_at           timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS nfe_items_invoice_idx        ON nfe_invoice_items (invoice_id);
CREATE INDEX IF NOT EXISTS nfe_items_company_idx        ON nfe_invoice_items (company_id);
CREATE INDEX IF NOT EXISTS nfe_items_product_idx        ON nfe_invoice_items (product_id);
CREATE INDEX IF NOT EXISTS nfe_items_ean_norm_idx       ON nfe_invoice_items (company_id, nfe_ean_normalized);
CREATE INDEX IF NOT EXISTS nfe_items_code_idx           ON nfe_invoice_items (company_id, nfe_code);

ALTER TABLE nfe_invoice_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "nfe_items_select" ON nfe_invoice_items;
CREATE POLICY "nfe_items_select" ON nfe_invoice_items FOR SELECT
  TO authenticated USING (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "nfe_items_insert" ON nfe_invoice_items;
CREATE POLICY "nfe_items_insert" ON nfe_invoice_items FOR INSERT
  TO authenticated WITH CHECK (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "nfe_items_update" ON nfe_invoice_items;
CREATE POLICY "nfe_items_update" ON nfe_invoice_items FOR UPDATE
  TO authenticated
  USING (company_id::text = get_my_company_id())
  WITH CHECK (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "nfe_items_delete" ON nfe_invoice_items;
CREATE POLICY "nfe_items_delete" ON nfe_invoice_items FOR DELETE
  TO authenticated
  USING (company_id::text = get_my_company_id() AND get_my_role() IN ('owner','admin','manager'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. nfe_learned_associations
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nfe_learned_associations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL DEFAULT get_my_company_id()::uuid REFERENCES companies(id) ON DELETE CASCADE,
  match_type  text NOT NULL CHECK (match_type IN ('sku','ean')),
  match_value text NOT NULL,
  product_id  uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_by  uuid DEFAULT auth.uid(),
  created_at  timestamptz DEFAULT now(),
  CONSTRAINT nfe_learned_unique UNIQUE (company_id, match_type, match_value)
);

CREATE INDEX IF NOT EXISTS nfe_learned_lookup_idx ON nfe_learned_associations (company_id, match_type, match_value);

ALTER TABLE nfe_learned_associations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "nfe_learned_select" ON nfe_learned_associations;
CREATE POLICY "nfe_learned_select" ON nfe_learned_associations FOR SELECT
  TO authenticated USING (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "nfe_learned_insert" ON nfe_learned_associations;
CREATE POLICY "nfe_learned_insert" ON nfe_learned_associations FOR INSERT
  TO authenticated WITH CHECK (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "nfe_learned_update" ON nfe_learned_associations;
CREATE POLICY "nfe_learned_update" ON nfe_learned_associations FOR UPDATE
  TO authenticated
  USING (company_id::text = get_my_company_id())
  WITH CHECK (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "nfe_learned_delete" ON nfe_learned_associations;
CREATE POLICY "nfe_learned_delete" ON nfe_learned_associations FOR DELETE
  TO authenticated USING (company_id::text = get_my_company_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. nfe_count_events (immutable)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nfe_count_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL DEFAULT get_my_company_id()::uuid REFERENCES companies(id) ON DELETE CASCADE,
  invoice_id         uuid NOT NULL REFERENCES nfe_invoices(id) ON DELETE CASCADE,
  item_id            uuid NOT NULL REFERENCES nfe_invoice_items(id) ON DELETE CASCADE,
  product_id         uuid,
  sku                text,
  ean                text,
  delta              numeric NOT NULL,
  resulting_quantity numeric NOT NULL,
  mode               text NOT NULL CHECK (mode IN ('increment','set')),
  source             text NOT NULL DEFAULT 'manual' CHECK (source IN ('scanner','manual','camera','voice')),
  idempotency_key    uuid NOT NULL,
  created_by         uuid DEFAULT auth.uid(),
  created_at         timestamptz DEFAULT now(),
  CONSTRAINT nfe_count_events_idempotency_unique UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS nfe_events_item_idx    ON nfe_count_events (item_id, created_at);
CREATE INDEX IF NOT EXISTS nfe_events_invoice_idx ON nfe_count_events (invoice_id);
CREATE INDEX IF NOT EXISTS nfe_events_company_idx ON nfe_count_events (company_id);

ALTER TABLE nfe_count_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "nfe_events_select" ON nfe_count_events;
CREATE POLICY "nfe_events_select" ON nfe_count_events FOR SELECT
  TO authenticated USING (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "nfe_events_insert" ON nfe_count_events;
CREATE POLICY "nfe_events_insert" ON nfe_count_events FOR INSERT
  TO authenticated WITH CHECK (company_id::text = get_my_company_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- updated_at triggers (reuse existing update_updated_at_column())
-- ─────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS nfe_invoices_updated_at ON nfe_invoices;
CREATE TRIGGER nfe_invoices_updated_at
  BEFORE UPDATE ON nfe_invoices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS nfe_items_updated_at ON nfe_invoice_items;
CREATE TRIGGER nfe_items_updated_at
  BEFORE UPDATE ON nfe_invoice_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
