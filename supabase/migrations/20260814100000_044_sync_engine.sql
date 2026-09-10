/*
# Sync Engine — bidirectional synchronisation (Fase 3)

## Summary
Builds the job/item/conflict model on top of the Fase 1 foundation and the Fase 2
engine. Still no provider API: this phase makes a sync *recordable, resumable and
arguable-with*, so that when a real connector lands there is somewhere honest to
put what it did.

## Deliberately NOT a new "sync_jobs" table
`integration_sync_runs` (migration 042) already is the job: one row per
execution, with connection, entity, direction, trigger, status, counters, cursor
and idempotency key. Creating a second table for the same concept would leave two
places to look for "what happened last night" and two things to keep in step. It
is extended in place instead:
  - `sync_type`      FULL / INCREMENTAL / MANUAL / SCHEDULED / WEBHOOK
  - `records_total`  what the provider claimed, vs `processed_count` we handled
  - status gains `pending`, so a queued job exists before a worker picks it up

`trigger_source` and `sync_type` overlap but are not the same axis and both are
worth keeping: a MANUAL trigger can start a FULL or an INCREMENTAL sync, and a
webhook always triggers an INCREMENTAL one. Collapsing them would lose the
distinction between "who started this" and "how much did it read".

## What this creates
1. integration_connections.conflict_policy    per-connection source-of-truth rule
2. integration_sync_items                     per-record granularity
3. integration_sync_conflicts                 disagreements, never silent overwrites
4. integration_stock_adjustments              count -> approval -> ERP, auditable

## Source of truth
`stock_source_of_truth boolean` from 042 was too coarse to express "ask a human".
`conflict_policy` replaces it as the real setting; the boolean is left in place
and untouched so nothing that reads it breaks, and it is documented below as
derived/legacy. Default is `manual_review`: the safe default for inventory is to
stop and ask, not to guess which side is right.
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. integration_sync_runs — extend into the full job record
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE integration_sync_runs
  ADD COLUMN IF NOT EXISTS sync_type text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS records_total integer,
  -- Short, aggregated, human-readable. Per-record detail lives in
  -- integration_sync_items; this is what a list row shows.
  ADD COLUMN IF NOT EXISTS error_summary text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'integration_sync_runs_sync_type_check'
  ) THEN
    ALTER TABLE integration_sync_runs
      ADD CONSTRAINT integration_sync_runs_sync_type_check
      CHECK (sync_type IN ('full','incremental','manual','scheduled','webhook'));
  END IF;
END $$;

-- `pending` did not exist in 042 because a run was only ever recorded once it
-- started. A queued job has to be representable before a worker claims it,
-- otherwise two workers can both "start" the same scheduled sync.
ALTER TABLE integration_sync_runs DROP CONSTRAINT IF EXISTS integration_sync_runs_status_check;
ALTER TABLE integration_sync_runs
  ADD CONSTRAINT integration_sync_runs_status_check
  CHECK (status IN ('pending','running','success','partial','failed','cancelled'));

-- Lets a worker find claimable jobs without scanning history.
CREATE INDEX IF NOT EXISTS integration_sync_runs_claimable_idx
  ON integration_sync_runs (status, started_at)
  WHERE status IN ('pending','running');

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. integration_connections.conflict_policy
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE integration_connections
  ADD COLUMN IF NOT EXISTS conflict_policy text NOT NULL DEFAULT 'manual_review';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'integration_connections_conflict_policy_check'
  ) THEN
    ALTER TABLE integration_connections
      ADD CONSTRAINT integration_connections_conflict_policy_check
      CHECK (conflict_policy IN ('erp_wins','inventoryblind_wins','last_write_wins','manual_review'));
  END IF;
END $$;

COMMENT ON COLUMN integration_connections.conflict_policy IS
  'Which side wins when internal and external stock disagree. Supersedes the '
  'coarser stock_source_of_truth boolean, which is kept for compatibility and '
  'should be treated as legacy. Defaults to manual_review because the safe '
  'default for inventory is to stop and ask.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. integration_sync_items — per-record granularity
--
-- One row per record a job touched. This is the audit trail: previous_value and
-- new_value are what make "the sync changed this" answerable months later, and
-- `attempts` is what proves a retry happened rather than a duplicate.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS integration_sync_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL DEFAULT get_my_company_id()::uuid
                    REFERENCES companies(id) ON DELETE CASCADE,
  job_id          uuid NOT NULL REFERENCES integration_sync_runs(id) ON DELETE CASCADE,
  connection_id   uuid NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
  entity_type     text NOT NULL CHECK (entity_type IN
                    ('product','variant','location','warehouse','brand','category','order','stock','adjustment')),
  internal_id     uuid,
  external_id     text,
  operation       text NOT NULL CHECK (operation IN
                    ('create','update','skip','delete','push_absolute','push_delta','push_transfer','push_movement')),
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','success','failed','skipped','conflict')),
  -- Audit values. jsonb rather than numeric because the same table records stock
  -- numbers, product field changes and order states.
  previous_value  jsonb,
  new_value       jsonb,
  error_kind      text,
  error_message   text,
  attempts        integer NOT NULL DEFAULT 0,
  processed_at    timestamptz,
  created_at      timestamptz DEFAULT now(),
  -- Same record, same job, same operation must collapse rather than duplicate:
  -- this is what makes a resumed or re-run job idempotent at item level.
  CONSTRAINT integration_sync_items_unique
    UNIQUE (job_id, entity_type, external_id, operation)
);

CREATE INDEX IF NOT EXISTS integration_sync_items_job_idx
  ON integration_sync_items (job_id, status);
CREATE INDEX IF NOT EXISTS integration_sync_items_internal_idx
  ON integration_sync_items (company_id, entity_type, internal_id);

ALTER TABLE integration_sync_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "integration_sync_items_select" ON integration_sync_items;
CREATE POLICY "integration_sync_items_select" ON integration_sync_items FOR SELECT
  TO authenticated USING (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "integration_sync_items_insert" ON integration_sync_items;
CREATE POLICY "integration_sync_items_insert" ON integration_sync_items FOR INSERT
  TO authenticated WITH CHECK (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "integration_sync_items_update" ON integration_sync_items;
CREATE POLICY "integration_sync_items_update" ON integration_sync_items FOR UPDATE
  TO authenticated
  USING (company_id::text = get_my_company_id())
  WITH CHECK (company_id::text = get_my_company_id());

-- No DELETE policy: an audit trail that can be quietly erased is not one.

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. integration_sync_conflicts
--
-- The whole point: when InventoryBlind says 100 and the ERP says 80, nothing is
-- overwritten. A row appears here and stays PENDING until a policy or a person
-- resolves it.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS integration_sync_conflicts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL DEFAULT get_my_company_id()::uuid
                      REFERENCES companies(id) ON DELETE CASCADE,
  connection_id     uuid NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
  -- Nullable: a conflict can be detected by a job or by a webhook outside one.
  job_id            uuid REFERENCES integration_sync_runs(id) ON DELETE SET NULL,
  entity_type       text NOT NULL CHECK (entity_type IN
                      ('product','variant','location','warehouse','brand','category','order','stock')),
  internal_id       uuid,
  external_id       text,
  /** Both sides, as observed. jsonb so a stock conflict can carry
   *  {quantity, reserved, warehouse} and a product conflict can carry fields. */
  internal_value    jsonb NOT NULL,
  external_value    jsonb NOT NULL,
  /** Observation timestamps, which is what last_write_wins needs to decide. Kept
   *  separate from detected_at: when we noticed is not when either side changed. */
  internal_observed_at timestamptz,
  external_observed_at timestamptz,
  detected_at       timestamptz NOT NULL DEFAULT now(),
  status            text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','resolved','ignored')),
  /** Which policy decided it, or 'manual'. Recorded so a later audit can tell an
   *  automatic resolution from a human one. */
  resolution        text CHECK (resolution IN
                      ('erp_wins','inventoryblind_wins','last_write_wins','manual','ignored')),
  resolved_value    jsonb,
  resolved_by       uuid,
  resolved_at       timestamptz,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now(),
  -- One open conflict per entity per connection. A second detection of the same
  -- unresolved disagreement updates the existing row instead of stacking a
  -- hundred identical review items after a hundred scheduled syncs.
  CONSTRAINT integration_sync_conflicts_open_unique
    UNIQUE (connection_id, entity_type, external_id, status)
);

CREATE INDEX IF NOT EXISTS integration_sync_conflicts_pending_idx
  ON integration_sync_conflicts (company_id, status, detected_at DESC);

ALTER TABLE integration_sync_conflicts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "integration_sync_conflicts_select" ON integration_sync_conflicts;
CREATE POLICY "integration_sync_conflicts_select" ON integration_sync_conflicts FOR SELECT
  TO authenticated USING (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "integration_sync_conflicts_insert" ON integration_sync_conflicts;
CREATE POLICY "integration_sync_conflicts_insert" ON integration_sync_conflicts FOR INSERT
  TO authenticated WITH CHECK (company_id::text = get_my_company_id());

-- Resolving is a decision, not routine data entry: restricted to the roles that
-- can already change inventory policy.
DROP POLICY IF EXISTS "integration_sync_conflicts_update" ON integration_sync_conflicts;
CREATE POLICY "integration_sync_conflicts_update" ON integration_sync_conflicts FOR UPDATE
  TO authenticated
  USING (company_id::text = get_my_company_id() AND get_my_role() IN ('owner','admin','manager'))
  WITH CHECK (company_id::text = get_my_company_id() AND get_my_role() IN ('owner','admin','manager'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. integration_stock_adjustments
--
-- The count -> divergence -> approval -> InventoryBlind -> Sync -> ERP flow, as
-- one auditable row per SKU per destination.
--
-- Distinct from erp_sync_events (migration 039), which is already wired into the
-- physical-count Edge Function and stays untouched: that table is Tiny-specific
-- and count-session-specific. This one is provider-agnostic and covers any
-- adjustment origin, including a future manual one. Both can coexist; the older
-- path keeps working while new work targets this table.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS integration_stock_adjustments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL DEFAULT get_my_company_id()::uuid
                        REFERENCES companies(id) ON DELETE CASCADE,
  connection_id       uuid NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
  job_id              uuid REFERENCES integration_sync_runs(id) ON DELETE SET NULL,
  product_id          uuid,
  external_product_id text,
  sku                 text,
  external_warehouse_id text,
  /** Where the adjustment came from. 'physical_count' links a session; 'manual'
   *  and 'reconciliation' cover the other two real origins. */
  origin              text NOT NULL DEFAULT 'physical_count'
                        CHECK (origin IN ('physical_count','manual','reconciliation','conflict_resolution')),
  /** Nullable because not every origin has a session. */
  source_session_id   uuid REFERENCES physical_count_sessions(id) ON DELETE SET NULL,
  previous_quantity   numeric NOT NULL,
  counted_quantity    numeric NOT NULL,
  /** Stored rather than derived. The delta is what was actually sent, and if the
   *  provider later reports a different balance we need to know what we asked
   *  for, not what the current numbers imply. */
  delta_quantity      numeric NOT NULL,
  /** Which of the four write shapes was used. This is the absolute-vs-delta
   *  record: reading a row later must not require guessing whether 94 meant
   *  "set to 94" or "add 94". */
  write_kind          text NOT NULL CHECK (write_kind IN ('absolute','delta','transfer','movement')),
  reason              text,
  approved_by         uuid,
  approved_at         timestamptz,
  requested_by        uuid DEFAULT auth.uid(),
  sync_status         text NOT NULL DEFAULT 'pending'
                        CHECK (sync_status IN ('pending','sent','confirmed','failed','skipped')),
  /** The provider's id for the document it created, when it creates one. This is
   *  the external reference that makes the adjustment traceable on their side. */
  external_reference  text,
  error_kind          text,
  error_message       text,
  attempts            integer NOT NULL DEFAULT 0,
  sent_at             timestamptz,
  confirmed_at        timestamptz,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now(),
  /** Carried from the engine. UNIQUE is the guarantee that a retried push cannot
   *  post the same adjustment to a customer's ERP twice — the single most
   *  expensive duplicate in this whole system. */
  idempotency_key     text NOT NULL,
  CONSTRAINT integration_stock_adjustments_idempotency_unique UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS integration_stock_adjustments_pending_idx
  ON integration_stock_adjustments (connection_id, sync_status, created_at);
CREATE INDEX IF NOT EXISTS integration_stock_adjustments_session_idx
  ON integration_stock_adjustments (source_session_id);

ALTER TABLE integration_stock_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "integration_stock_adjustments_select" ON integration_stock_adjustments;
CREATE POLICY "integration_stock_adjustments_select" ON integration_stock_adjustments FOR SELECT
  TO authenticated USING (company_id::text = get_my_company_id());

-- Creating an adjustment means proposing a write to the customer's ERP. Same
-- roles that can approve a count.
DROP POLICY IF EXISTS "integration_stock_adjustments_insert" ON integration_stock_adjustments;
CREATE POLICY "integration_stock_adjustments_insert" ON integration_stock_adjustments FOR INSERT
  TO authenticated
  WITH CHECK (company_id::text = get_my_company_id() AND get_my_role() IN ('owner','admin','manager'));

DROP POLICY IF EXISTS "integration_stock_adjustments_update" ON integration_stock_adjustments;
CREATE POLICY "integration_stock_adjustments_update" ON integration_stock_adjustments FOR UPDATE
  TO authenticated
  USING (company_id::text = get_my_company_id() AND get_my_role() IN ('owner','admin','manager'))
  WITH CHECK (company_id::text = get_my_company_id() AND get_my_role() IN ('owner','admin','manager'));

-- No DELETE policy: a sent adjustment is a record of something that happened in
-- an external system and must not be removable.

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. updated_at triggers
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
    DROP TRIGGER IF EXISTS integration_sync_conflicts_updated_at ON integration_sync_conflicts;
    CREATE TRIGGER integration_sync_conflicts_updated_at
      BEFORE UPDATE ON integration_sync_conflicts
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

    DROP TRIGGER IF EXISTS integration_stock_adjustments_updated_at ON integration_stock_adjustments;
    CREATE TRIGGER integration_stock_adjustments_updated_at
      BEFORE UPDATE ON integration_stock_adjustments
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;
