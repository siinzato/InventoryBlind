// SyncRepository — server-side implementation.
//
// Mirrors src/lib/integrations/sync/supabaseSyncRepository.ts but takes the client
// as a parameter, because the browser version imports a browser Supabase client
// this runtime cannot use.
//
// ── The security difference from the browser version, and how it is compensated ──
// A scheduled or webhook-triggered sync has NO user JWT: there is nobody logged in
// at 3am when pg_cron fires. So this runs under service_role, which bypasses RLS
// entirely — the barrier that protects every other query in this project.
//
// The compensating control is that `companyId` is a constructor argument and EVERY
// query filters on it explicitly. That company id is never taken from a request: it
// comes from the connection row, which was itself fetched under RLS (manual sync) or
// from the job row the scheduler claimed (automatic sync).
//
// This is the one place in the codebase where "I forgot a filter" would become a
// cross-tenant write, so the filters are not optional and not inherited — each
// method carries its own, and `assertScoped` makes an unscoped construction
// impossible.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type {
  CreateJobInput,
  InboundStockUpdate,
  JobPatch,
  RecordItemInput,
  StockLevelSnapshot,
  SyncRepository,
  UpsertConflictInput,
} from '../../../src/lib/integrations/sync/syncEngine.ts';
import type { IncrementalState, SyncJob } from '../../../src/lib/integrations/sync/syncTypes.ts';
import { EMPTY_INCREMENTAL_STATE } from '../../../src/lib/integrations/sync/syncTypes.ts';

const CHUNK = 500;
const SYNC_STATE_KEY = 'syncState';

function chunked<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const JOB_COLUMNS = `
  id, connection_id, sync_type, direction, entity_type, trigger_source, status,
  records_total, processed_count, created_count, updated_count, skipped_count,
  failed_count, cursor_before, cursor_after, error_summary, started_at,
  finished_at, duration_ms, idempotency_key
`;

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

/** What a dry run would have done. Collected instead of written so an operator can
 *  see the exact effect of a sync before any of it reaches the database or the
 *  provider. */
export interface DryRunLedger {
  stockUpdates: InboundStockUpdate[];
  items: RecordItemInput[];
  conflicts: UpsertConflictInput[];
  stockLevels: StockLevelSnapshot[];
  cursorAdvancedTo: IncrementalState | null;
}

export interface DenoSyncRepositoryOptions {
  client: SupabaseClient;
  connectionId: string;
  /** Never from a request. See the header. */
  companyId: string;
  /** When true nothing is persisted; intents land in the ledger instead. */
  dryRun?: boolean;
}

export function createDenoSyncRepository(options: DenoSyncRepositoryOptions): {
  repository: SyncRepository;
  ledger: DryRunLedger;
} {
  const { client, connectionId, companyId, dryRun = false } = options;

  if (!companyId || !connectionId) {
    // Constructing without a scope would produce a repository whose queries touch
    // every tenant. Failing loudly here is the only acceptable outcome.
    throw new Error('denoSyncRepository requer companyId e connectionId.');
  }

  const ledger: DryRunLedger = {
    stockUpdates: [],
    items: [],
    conflicts: [],
    stockLevels: [],
    cursorAdvancedTo: null,
  };

  const repository: SyncRepository = {
    async createJob(input: CreateJobInput): Promise<SyncJob> {
      // A dry run still needs a job object to hang items off, but must not leave a
      // row behind: a simulation appearing in the sync history would be read as a
      // real execution.
      if (dryRun) {
        const nowIso = new Date().toISOString();
        return {
          id: `dryrun-${crypto.randomUUID()}`,
          connectionId: input.connectionId,
          syncType: input.syncType,
          direction: input.direction,
          entityType: input.entityType,
          triggerSource: input.triggerSource,
          status: 'running',
          recordsTotal: null,
          processed: 0, created: 0, updated: 0, skipped: 0, failed: 0,
          cursorBefore: null, cursorAfter: null, errorSummary: null,
          startedAt: nowIso, finishedAt: null, durationMs: null,
          idempotencyKey: input.idempotencyKey,
        };
      }

      const { data, error } = await client
        .from('integration_sync_runs')
        .insert({
          company_id: companyId,
          connection_id: input.connectionId,
          sync_type: input.syncType,
          direction: input.direction,
          entity_type: input.entityType,
          trigger_source: input.triggerSource,
          idempotency_key: input.idempotencyKey,
          status: 'running',
        })
        .select(JOB_COLUMNS)
        .single();

      if (error) throw error;
      return toJob(data as JobRow);
    },

    async updateJob(jobId: string, patch: JobPatch): Promise<void> {
      if (dryRun) return;

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

      const { error } = await client
        .from('integration_sync_runs')
        .update(row)
        .eq('id', jobId)
        .eq('company_id', companyId);

      if (error) throw error;
    },

    async recordItems(items: RecordItemInput[]): Promise<void> {
      if (items.length === 0) return;
      if (dryRun) {
        ledger.items.push(...items);
        return;
      }

      for (const batch of chunked(items)) {
        const { error } = await client.from('integration_sync_items').upsert(
          batch.map(item => ({
            company_id: companyId,
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
          })),
          { onConflict: 'job_id,entity_type,external_id,operation' }
        );
        if (error) throw error;
      }
    },

    async upsertConflicts(conflicts: UpsertConflictInput[]): Promise<void> {
      if (conflicts.length === 0) return;
      if (dryRun) {
        ledger.conflicts.push(...conflicts);
        return;
      }

      for (const batch of chunked(conflicts)) {
        const { error } = await client.from('integration_sync_conflicts').upsert(
          batch.map(conflict => ({
            company_id: companyId,
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
          })),
          { onConflict: 'connection_id,entity_type,external_id,status' }
        );
        if (error) throw error;
      }
    },

    /** Write the agreed total onto the Core product row.
     *
     *  One row at a time and never an upsert: an upsert would happily create products
     *  that do not exist, and a stock sync must never invent a product. The company
     *  filter is what stands in for RLS here — without it, a mismapped internal id
     *  would write into another tenant's catalogue. */
    async applyInboundStock(
      updates: InboundStockUpdate[]
    ): Promise<{ applied: string[]; failed: string[] }> {
      if (dryRun) {
        ledger.stockUpdates.push(...updates);
        return { applied: updates.map(update => update.internalId), failed: [] };
      }

      const applied: string[] = [];
      const failed: string[] = [];

      for (const update of updates) {
        const { data, error } = await client
          .from('products')
          .update({ stock_quantity: Math.round(update.quantity) })
          .eq('id', update.internalId)
          .eq('company_id', companyId)
          .select('id');

        if (error || data == null || data.length === 0) failed.push(update.internalId);
        else applied.push(update.internalId);
      }

      return { applied, failed };
    },

    async saveStockLevels(levels: StockLevelSnapshot[]): Promise<void> {
      if (levels.length === 0) return;
      if (dryRun) {
        ledger.stockLevels.push(...levels);
        return;
      }

      const externalIds = Array.from(new Set(levels.map(level => level.externalProductId)));
      const linkByExternalId = new Map<string, string>();

      for (const batch of chunked(externalIds, 300)) {
        const { data, error } = await client
          .from('integration_entity_links')
          .select('id, external_id')
          .eq('company_id', companyId)
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
          // No mapping row means the product was never linked. Inventing a link here
          // would bypass the matching rules the mapping engine exists to enforce.
          if (linkId == null) return null;
          return {
            company_id: companyId,
            connection_id: connectionId,
            entity_link_id: linkId,
            // '' rather than null: the UNIQUE includes this column and NULLs compare
            // as distinct, which would insert the same deposit again every pass.
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
        const { error } = await client
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
        const { data, error } = await client
          .from('products')
          .select('id, stock_quantity, updated_at')
          .eq('company_id', companyId)
          .in('id', batch);

        if (error) throw error;

        for (const row of (data ?? []) as {
          id: string;
          stock_quantity: number | null;
          updated_at: string | null;
        }[]) {
          map.set(row.id, {
            quantity: row.stock_quantity ?? 0,
            // Approximate: any edit to the product bumps updated_at, not only a stock
            // change. last_write_wins on this side is only as precise as that, which
            // is why manual_review remains the default policy.
            observedAt: row.updated_at,
          });
        }
      }

      return map;
    },

    async saveIncrementalState(_connection: string, state: IncrementalState): Promise<void> {
      if (dryRun) {
        // Advancing the cursor during a simulation would make the next real sync skip
        // everything the simulation read.
        ledger.cursorAdvancedTo = state;
        return;
      }

      const { data, error: readError } = await client
        .from('integration_connections')
        .select('configuration')
        .eq('id', connectionId)
        .eq('company_id', companyId)
        .single();

      if (readError) throw readError;

      const configuration = (data?.configuration ?? {}) as Record<string, unknown>;

      const { error } = await client
        .from('integration_connections')
        .update({
          configuration: { ...configuration, [SYNC_STATE_KEY]: state },
          sync_cursor: state.cursor,
          last_sync_at: new Date().toISOString(),
          last_successful_sync_at: new Date().toISOString(),
        })
        .eq('id', connectionId)
        .eq('company_id', companyId);

      if (error) throw error;
    },

    async loadIncrementalState(): Promise<IncrementalState> {
      const { data, error } = await client
        .from('integration_connections')
        .select('configuration, sync_cursor')
        .eq('id', connectionId)
        .eq('company_id', companyId)
        .maybeSingle();

      if (error) throw error;
      if (data == null) return { ...EMPTY_INCREMENTAL_STATE };

      const stored = ((data.configuration ?? {}) as Record<string, unknown>)[SYNC_STATE_KEY];
      if (stored == null || typeof stored !== 'object') {
        return {
          ...EMPTY_INCREMENTAL_STATE,
          cursor: (data.sync_cursor as string | null) ?? null,
        };
      }

      const state = stored as Partial<IncrementalState>;
      return {
        cursor: state.cursor ?? (data.sync_cursor as string | null) ?? null,
        updatedSince: state.updatedSince ?? null,
        externalRevision: state.externalRevision ?? null,
      };
    },
  };

  return { repository, ledger };
}
