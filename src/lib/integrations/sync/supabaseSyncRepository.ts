// Sync Engine — Supabase implementation of the SyncRepository port.
//
// The only file in the sync layer that knows SQL exists. Everything above it is
// pure and tested against an in-memory fake; this is the adapter that makes the
// engine talk to the real database.
//
// Two rules it follows throughout:
//   - company_id is never sent from here. Every table defaults it to
//     get_my_company_id() and the RLS policy re-checks it, so the tenant comes
//     from the JWT and never from an argument this code could get wrong.
//   - writes are chunked. A 5.000-row upsert exceeds what PostgREST accepts in one
//     statement, and a silently truncated write is worse than a slow one.

import { supabase } from '../../supabase';
import type {
  CreateJobInput,
  InboundStockUpdate,
  JobPatch,
  RecordItemInput,
  StockLevelSnapshot,
  SyncRepository,
  UpsertConflictInput,
} from './syncEngine';
import type { IncrementalState } from './syncTypes';
import { EMPTY_INCREMENTAL_STATE } from './syncTypes';
import type { SyncJob } from './syncTypes';

const CHUNK = 500;

function chunked<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

interface JobRow {
  id: string;
  connection_id: string;
  sync_type: string;
  direction: string;
  entity_type: string;
  trigger_source: string;
  status: string;
  records_total: number | null;
  processed_count: number;
  created_count: number;
  updated_count: number;
  skipped_count: number;
  failed_count: number;
  cursor_before: string | null;
  cursor_after: string | null;
  error_summary: string | null;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  idempotency_key: string;
}

function toJob(row: JobRow): SyncJob {
  return {
    id: row.id,
    connectionId: row.connection_id,
    syncType: row.sync_type as SyncJob['syncType'],
    direction: row.direction as SyncJob['direction'],
    entityType: row.entity_type as SyncJob['entityType'],
    triggerSource: row.trigger_source as SyncJob['triggerSource'],
    status: row.status as SyncJob['status'],
    recordsTotal: row.records_total,
    processed: row.processed_count,
    created: row.created_count,
    updated: row.updated_count,
    skipped: row.skipped_count,
    failed: row.failed_count,
    cursorBefore: row.cursor_before,
    cursorAfter: row.cursor_after,
    errorSummary: row.error_summary,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms,
    idempotencyKey: row.idempotency_key,
  };
}

const JOB_COLUMNS = `
  id, connection_id, sync_type, direction, entity_type, trigger_source, status,
  records_total, processed_count, created_count, updated_count, skipped_count,
  failed_count, cursor_before, cursor_after, error_summary, started_at,
  finished_at, duration_ms, idempotency_key
`;

/** How the incremental cursor is stored.
 *
 *  It lives inside integration_connections.configuration rather than in its own
 *  columns because it is provider-shaped: one ERP returns a page token, another a
 *  revision number, a third only supports a timestamp. A jsonb sub-object absorbs
 *  all three without a migration per provider. */
const SYNC_STATE_KEY = 'syncState';

/** One repository per connection.
 *
 *  connection_id is a constructor argument rather than a per-call one because
 *  integration_stock_levels and integration_entity_links are both scoped by it,
 *  and threading it through every signature invites the one call that forgets. */
export function createSupabaseSyncRepository(connectionId: string): SyncRepository {
  return {
    async createJob(input: CreateJobInput): Promise<SyncJob> {
      const { data, error } = await supabase
        .from('integration_sync_runs')
        .insert({
          connection_id: input.connectionId,
          sync_type: input.syncType,
          direction: input.direction,
          entity_type: input.entityType,
          trigger_source: input.triggerSource,
          idempotency_key: input.idempotencyKey,
          status: 'pending',
        })
        .select(JOB_COLUMNS)
        .single();

      if (error) throw error;
      return toJob(data as JobRow);
    },

    async updateJob(jobId: string, patch: JobPatch): Promise<void> {
      // Mapped field by field rather than spread: the engine speaks camelCase and
      // the table snake_case, and an unmapped key would be silently dropped by
      // PostgREST instead of failing.
      const row: Record<string, unknown> = {};
      if (patch.status !== undefined) row.status = patch.status;
      if (patch.recordsTotal !== undefined) row.records_total = patch.recordsTotal;
      if (patch.processed !== undefined) row.processed_count = patch.processed;
      if (patch.created !== undefined) row.created_count = patch.created;
      if (patch.updated !== undefined) row.updated_count = patch.updated;
      if (patch.skipped !== undefined) row.skipped_count = patch.skipped;
      if (patch.failed !== undefined) row.failed_count = patch.failed;
      if (patch.cursorAfter !== undefined) row.cursor_after = patch.cursorAfter;
      if (patch.errorSummary !== undefined) row.error_summary = patch.errorSummary;
      if (patch.finishedAt !== undefined) row.finished_at = patch.finishedAt;
      if (patch.durationMs !== undefined) row.duration_ms = patch.durationMs;

      if (Object.keys(row).length === 0) return;

      const { error } = await supabase.from('integration_sync_runs').update(row).eq('id', jobId);
      if (error) throw error;
    },

    async recordItems(items: RecordItemInput[]): Promise<void> {
      if (items.length === 0) return;

      for (const batch of chunked(items)) {
        const rows = batch.map(item => ({
          job_id: item.jobId,
          connection_id: item.connectionId,
          entity_type: item.entityType,
          internal_id: item.internalId,
          external_id: item.externalId,
          operation: item.operation,
          status: item.status,
          previous_value: item.previousValue ?? null,
          new_value: item.newValue ?? null,
          error_kind: item.errorKind ?? null,
          error_message: item.errorMessage ?? null,
          attempts: item.attempts ?? 0,
          processed_at: item.processedAt ?? null,
        }));

        // onConflict matches the UNIQUE the migration declared, so a resumed or
        // re-run job updates its own items instead of duplicating them.
        const { error } = await supabase
          .from('integration_sync_items')
          .upsert(rows, { onConflict: 'job_id,entity_type,external_id,operation' });

        if (error) throw error;
      }
    },

    async upsertConflicts(conflicts: UpsertConflictInput[]): Promise<void> {
      if (conflicts.length === 0) return;

      for (const batch of chunked(conflicts)) {
        const rows = batch.map(conflict => ({
          connection_id: conflict.connectionId,
          job_id: conflict.jobId,
          entity_type: conflict.entityType,
          internal_id: conflict.internalId,
          external_id: conflict.externalId,
          internal_value: conflict.internalValue,
          external_value: conflict.externalValue,
          internal_observed_at: conflict.internalObservedAt,
          external_observed_at: conflict.externalObservedAt,
          status: 'pending',
        }));

        // Re-detecting the same open disagreement refreshes the row rather than
        // stacking a hundred identical review items after a hundred scheduled syncs.
        const { error } = await supabase
          .from('integration_sync_conflicts')
          .upsert(rows, { onConflict: 'connection_id,entity_type,external_id,status' });

        if (error) throw error;
      }
    },

    /** Write the agreed total onto the Core product row.
     *
     *  `products.stock_quantity` is an integer column, so a fractional total is
     *  rounded rather than rejected — a provider reporting 10.5 units of something
     *  sold whole is a unit-of-measure mismatch, and refusing the whole sync over
     *  it would be worse than storing 11 and keeping the exact figure in
     *  integration_stock_levels.
     *
     *  Applied one row at a time on purpose: an upsert would happily create
     *  products that do not exist, and a stock sync must never invent a product.
     *  Anything that does not match an existing row is reported as failed so the
     *  job records it instead of silently skipping. */
    async applyInboundStock(
      updates: InboundStockUpdate[]
    ): Promise<{ applied: string[]; failed: string[] }> {
      const applied: string[] = [];
      const failed: string[] = [];

      for (const update of updates) {
        const { data, error } = await supabase
          .from('products')
          .update({ stock_quantity: Math.round(update.quantity) })
          .eq('id', update.internalId)
          .select('id');

        if (error || data == null || data.length === 0) failed.push(update.internalId);
        else applied.push(update.internalId);
      }

      return { applied, failed };
    },

    async saveStockLevels(levels: StockLevelSnapshot[]): Promise<void> {
      if (levels.length === 0) return;

      // integration_stock_levels keys on entity_link_id, so each snapshot has to be
      // attached to the product's mapping row. Loaded in one query rather than per
      // level: a 5.000-SKU pass would otherwise be 5.000 round trips.
      const externalIds = Array.from(new Set(levels.map(level => level.externalProductId)));
      const linkByExternalId = new Map<string, string>();

      for (const batch of chunked(externalIds, 300)) {
        const { data, error } = await supabase
          .from('integration_entity_links')
          .select('id, external_id')
          .eq('connection_id', connectionId)
          .eq('entity_type', 'product')
          .in('external_id', batch);

        if (error) throw error;
        for (const row of (data ?? []) as { id: string; external_id: string }[]) {
          linkByExternalId.set(row.external_id, row.id);
        }
      }

      const rows = levels
        .map(level => {
          const linkId = linkByExternalId.get(level.externalProductId);
          // No mapping row means the product was never linked. Its balance has
          // nowhere to hang, and inventing a link here would bypass the matching
          // rules the mapping engine exists to enforce.
          if (linkId == null) return null;
          return {
            connection_id: connectionId,
            entity_link_id: linkId,
            // '' rather than null: the table's UNIQUE includes this column, and
            // NULLs compare as distinct, which would let the same deposit insert
            // twice on every pass.
            external_warehouse_id: level.warehouseExternalId ?? '',
            external_warehouse_name: level.warehouseName,
            quantity: level.quantity,
            reserved_quantity: level.reserved,
            available_quantity: level.available,
            observed_at: level.observedAt,
          };
        })
        .filter((row): row is NonNullable<typeof row> => row !== null);

      if (rows.length === 0) return;

      for (const batch of chunked(rows)) {
        const { error } = await supabase
          .from('integration_stock_levels')
          .upsert(batch, { onConflict: 'connection_id,entity_link_id,external_warehouse_id' });
        if (error) throw error;
      }
    },

    async loadInternalStock(
      internalIds: string[]
    ): Promise<Map<string, { quantity: number; observedAt: string | null }>> {
      const map = new Map<string, { quantity: number; observedAt: string | null }>();
      if (internalIds.length === 0) return map;

      for (const batch of chunked(internalIds, 300)) {
        const { data, error } = await supabase
          .from('products')
          .select('id, stock_quantity, updated_at')
          .in('id', batch);

        if (error) throw error;

        for (const row of (data ?? []) as { id: string; stock_quantity: number | null; updated_at: string | null }[]) {
          map.set(row.id, {
            quantity: row.stock_quantity ?? 0,
            // products.updated_at is the closest thing to "when this balance was
            // last touched". It is approximate — any edit to the row bumps it — so
            // last_write_wins on this side is only as precise as that. Documented
            // rather than hidden, because a wrong winner is the cost.
            observedAt: row.updated_at,
          });
        }
      }

      return map;
    },

    async saveIncrementalState(connectionId: string, state: IncrementalState): Promise<void> {
      // Read-modify-write on the jsonb so unrelated configuration keys survive.
      const { data, error: readError } = await supabase
        .from('integration_connections')
        .select('configuration')
        .eq('id', connectionId)
        .single();

      if (readError) throw readError;

      const configuration = ((data?.configuration ?? {}) as Record<string, unknown>);

      const { error } = await supabase
        .from('integration_connections')
        .update({
          configuration: { ...configuration, [SYNC_STATE_KEY]: state },
          sync_cursor: state.cursor,
          last_successful_sync_at: new Date().toISOString(),
        })
        .eq('id', connectionId);

      if (error) throw error;
    },

    async loadIncrementalState(connectionId: string): Promise<IncrementalState> {
      const { data, error } = await supabase
        .from('integration_connections')
        .select('configuration, sync_cursor')
        .eq('id', connectionId)
        .maybeSingle();

      if (error) throw error;
      if (data == null) return { ...EMPTY_INCREMENTAL_STATE };

      const stored = ((data.configuration ?? {}) as Record<string, unknown>)[SYNC_STATE_KEY];
      if (stored == null || typeof stored !== 'object') {
        // Falls back to the dedicated column, which is what a connector using only
        // a cursor will have written.
        return { ...EMPTY_INCREMENTAL_STATE, cursor: (data.sync_cursor as string | null) ?? null };
      }

      const state = stored as Partial<IncrementalState>;
      return {
        cursor: state.cursor ?? (data.sync_cursor as string | null) ?? null,
        updatedSince: state.updatedSince ?? null,
        externalRevision: state.externalRevision ?? null,
      };
    },
  };
}
