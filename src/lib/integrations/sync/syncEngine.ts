// Sync Engine — the orchestrator.
//
// Runs a job end to end: read, normalise, map, decide, apply, record. It knows
// nothing about any provider (that is the Adapter) and nothing about SQL (that is
// the SyncRepository port), which is why it can be tested against an in-memory
// fake with no database and no network.
//
// Two invariants it enforces so no caller has to remember them:
//   1. a job always reaches a terminal status, including when the engine itself
//      throws — a job stuck in `running` forever is worse than a failed one,
//      because a scheduler will not retry it and nobody knows it died;
//   2. nothing is overwritten without a decision. Every disagreement becomes an
//      applied policy or a conflict row, never a silent write.

import type { ProviderAdapter } from '../adapter.ts';
import type { ConnectorContext, WriteAck } from '../connector.ts';
import { IntegrationError, toIntegrationError } from '../errors.ts';
import { normalizeBatch, normalizeStockLevel, type StockFieldMap } from '../normalizers.ts';
import type { StockWrite } from '../stockOperations.ts';
import {
  planStockSync,
  type PlannedConflict,
  type PlannedOutboundWrite,
  type StockPair,
  type StockSyncPlan,
} from './stockSyncPlanner.ts';
import { aggregateStockByProduct, type AggregatedStock } from './stockAggregation.ts';
import {
  incrementalStateFor,
  type IncrementalState,
  type SyncConnectionConfig,
  type SyncItemOperation,
  type SyncItemStatus,
  type SyncJob,
  type SyncJobStatus,
  type SyncJobType,
} from './syncTypes.ts';
import type { StockWriteKind } from '../stockOperations.ts';
import type { SyncTrigger } from '../types.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Ports
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateJobInput {
  connectionId: string;
  syncType: SyncJobType;
  direction: 'inbound' | 'outbound';
  entityType: 'stock' | 'product' | 'location' | 'adjustment';
  triggerSource: SyncTrigger;
  idempotencyKey: string;
}

export interface JobPatch {
  status?: SyncJobStatus;
  recordsTotal?: number | null;
  processed?: number;
  created?: number;
  updated?: number;
  skipped?: number;
  failed?: number;
  cursorAfter?: string | null;
  errorSummary?: string | null;
  finishedAt?: string | null;
  durationMs?: number | null;
}

export interface RecordItemInput {
  jobId: string;
  connectionId: string;
  entityType: string;
  internalId: string | null;
  externalId: string | null;
  operation: SyncItemOperation;
  status: SyncItemStatus;
  previousValue?: unknown;
  newValue?: unknown;
  errorKind?: string | null;
  errorMessage?: string | null;
  attempts?: number;
  processedAt?: string | null;
}

export interface UpsertConflictInput {
  connectionId: string;
  jobId: string | null;
  entityType: 'stock';
  internalId: string | null;
  externalId: string;
  internalValue: unknown;
  externalValue: unknown;
  internalObservedAt: string | null;
  externalObservedAt: string | null;
  reason: string;
}

export interface InboundStockUpdate {
  internalId: string;
  quantity: number;
}

/** One deposit's balance, as the provider reported it. Persisted verbatim so the
 *  breakdown behind the Core's summed scalar is always recoverable. */
export interface StockLevelSnapshot {
  externalProductId: string;
  warehouseExternalId: string | null;
  warehouseName: string | null;
  quantity: number;
  reserved: number | null;
  available: number | null;
  observedAt: string;
}

/** Everything the engine needs from persistence. An interface rather than a
 *  direct Supabase dependency so the orchestration can be tested exhaustively
 *  with a fake, and so a future Edge Function can supply a service_role-backed
 *  implementation without the engine changing. */
export interface SyncRepository {
  createJob(input: CreateJobInput): Promise<SyncJob>;
  updateJob(jobId: string, patch: JobPatch): Promise<void>;
  recordItems(items: RecordItemInput[]): Promise<void>;
  upsertConflicts(conflicts: UpsertConflictInput[]): Promise<void>;
  /** Apply accepted external balances to the Core. Returns which internal ids
   *  actually took, because a row can vanish between the read and the write. */
  applyInboundStock(updates: InboundStockUpdate[]): Promise<{ applied: string[]; failed: string[] }>;
  /** Persist the per-deposit breakdown. Called on every pass, independently of
   *  what the conflict policy decides about the Core's total. */
  saveStockLevels(levels: StockLevelSnapshot[]): Promise<void>;
  /** Current internal balances for the products in play. */
  loadInternalStock(internalIds: string[]): Promise<Map<string, { quantity: number; observedAt: string | null }>>;
  saveIncrementalState(connectionId: string, state: IncrementalState): Promise<void>;
  loadIncrementalState(connectionId: string): Promise<IncrementalState>;
}

export interface SyncEngineOptions {
  repository: SyncRepository;
  adapter: ProviderAdapter;
  connection: SyncConnectionConfig;
  /** Injected so tests are deterministic and a job's timestamps are consistent
   *  within one run rather than drifting between statements. */
  now: () => Date;
  newIdempotencyKey: () => string;
  /** Maps this provider's stock payload onto the normalised shape. Supplied by
   *  the connector, so the engine never learns a provider's field names. */
  stockFieldMap: StockFieldMap;
  /** Which write shape the provider accepts, from preferredWriteKind. */
  writeKind: StockWriteKind | null;
  /** Resolves an external product id to the internal row, from the mapping
   *  engine. Injected because loading the index is the caller's concern. */
  resolveInternalId: (externalId: string) => string | null;
}

export interface SyncOutcome {
  job: SyncJob;
  status: SyncJobStatus;
  plan: StockSyncPlan | null;
  error: IntegrationError | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Engine
// ─────────────────────────────────────────────────────────────────────────────

export class SyncEngine {
  private readonly options: SyncEngineOptions;

  constructor(options: SyncEngineOptions) {
    this.options = options;
  }

  /** ERP/Marketplace -> InventoryBlind, for stock.
   *
   *  Walks every page, normalises, maps, plans against the connection's conflict
   *  policy and applies only what the policy actually decided. A partial page walk
   *  is reported as `partial`, never as success: a truncated catalogue treated as
   *  complete would let a later step conclude that missing SKUs were deleted. */
  async runInboundStockSync(
    ctx: ConnectorContext,
    params: { syncType: SyncJobType; trigger: SyncTrigger }
  ): Promise<SyncOutcome> {
    const { repository, adapter, connection, now, newIdempotencyKey } = this.options;
    const startedAt = now();

    const job = await repository.createJob({
      connectionId: connection.connectionId,
      syncType: params.syncType,
      direction: 'inbound',
      entityType: 'stock',
      triggerSource: params.trigger,
      idempotencyKey: newIdempotencyKey(),
    });

    try {
      await repository.updateJob(job.id, { status: 'running' });

      const stored = await repository.loadIncrementalState(connection.connectionId);
      const state = incrementalStateFor(params.syncType, stored);

      const collected = await adapter.collect(
        'getStockByLocation',
        ctx,
        (c, request) => adapter.connector.getStockByLocation!(c, request),
        { updatedSince: state.updatedSince }
      );

      // Normalise before deciding anything: a record we cannot read must not
      // participate in a stock decision.
      const observedAt = startedAt.toISOString();
      // .payload, not the RawRecord wrapper: the normalizer expects the provider's
      // own object, and handing it the wrapper silently fails every record.
      const { values, failures } = normalizeBatch(collected.records.map(record => record.payload), payload =>
        normalizeStockLevel(payload, this.options.stockFieldMap, observedAt)
      );

      // Sum deposits into one balance per product BEFORE comparing. Comparing a
      // single deposit against the Core's total invents conflicts: 80 vs 110 looks
      // like a divergence when 80 + 30 = 110 agrees exactly.
      const aggregated = aggregateStockByProduct(values);

      // Per-deposit detail is persisted regardless of what the policy decides, so
      // the breakdown survives even when the scalar total is left untouched.
      await repository.saveStockLevels(
        aggregated.flatMap(entry =>
          entry.breakdown.map(row => ({
            externalProductId: entry.productExternalId,
            warehouseExternalId: row.warehouseExternalId,
            warehouseName: row.warehouseName,
            quantity: row.quantity,
            reserved: row.reserved,
            available: row.available,
            observedAt: row.observedAt,
          }))
        )
      );

      const pairs = await this.buildPairs(aggregated);
      const plan = planStockSync(pairs, {
        policy: connection.conflictPolicy,
        direction: connection.direction,
        writeKind: this.options.writeKind,
        idempotencyScope: job.id,
        connectionId: connection.connectionId,
      });

      const applied = plan.inbound.length > 0
        ? await repository.applyInboundStock(
            plan.inbound.map(update => ({ internalId: update.internalId, quantity: update.newQuantity }))
          )
        : { applied: [], failed: [] };

      const appliedSet = new Set(applied.applied);

      await repository.recordItems([
        ...plan.inbound.map(update => ({
          jobId: job.id,
          connectionId: connection.connectionId,
          entityType: 'stock',
          internalId: update.internalId,
          externalId: update.externalId,
          operation: 'update' as SyncItemOperation,
          status: (appliedSet.has(update.internalId) ? 'success' : 'failed') as SyncItemStatus,
          previousValue: { quantity: update.previousQuantity },
          newValue: { quantity: update.newQuantity, policy: update.policy },
          errorMessage: appliedSet.has(update.internalId) ? null : 'Produto não encontrado ao aplicar o saldo.',
          processedAt: observedAt,
        })),
        ...plan.skipped.map(skip => ({
          jobId: job.id,
          connectionId: connection.connectionId,
          entityType: 'stock',
          internalId: skip.internalId,
          externalId: skip.externalId,
          operation: 'skip' as SyncItemOperation,
          status: 'skipped' as SyncItemStatus,
          newValue: { reason: skip.reason },
          processedAt: observedAt,
        })),
        ...plan.conflicts.map(conflict => this.conflictItem(job.id, conflict, observedAt)),
        ...failures.map(failure => ({
          jobId: job.id,
          connectionId: connection.connectionId,
          entityType: 'stock',
          internalId: null,
          externalId: failure.externalId,
          operation: 'skip' as SyncItemOperation,
          status: 'failed' as SyncItemStatus,
          errorKind: failure.error.kind,
          errorMessage: failure.error.message,
          processedAt: observedAt,
        })),
      ]);

      if (plan.conflicts.length > 0) {
        await repository.upsertConflicts(
          plan.conflicts.map(conflict => ({
            connectionId: connection.connectionId,
            jobId: job.id,
            entityType: 'stock' as const,
            internalId: conflict.internalId,
            externalId: conflict.externalId,
            internalValue: conflict.internal,
            externalValue: conflict.external,
            internalObservedAt: conflict.internal.observedAt,
            externalObservedAt: conflict.external.observedAt,
            reason: conflict.outcome.kind === 'needs_review' ? conflict.outcome.reason : 'blocked_by_direction',
          }))
        );
      }

      // Only advance the cursor on a complete walk. Saving it after a truncated
      // one would skip whatever the failed page contained, permanently.
      if (collected.complete) {
        await repository.saveIncrementalState(connection.connectionId, {
          cursor: null,
          updatedSince: observedAt,
          externalRevision: state.externalRevision,
        });
      }

      const failedCount = failures.length + applied.failed.length;
      // `processed` must be everything attempted, not just what normalised:
      // otherwise a page of 1 good + 1 unreadable record compares failed(1)
      // against processed(1) and reports a total failure instead of a partial one.
      const attempted = pairs.length + failures.length;
      const status = this.terminalStatus({
        complete: collected.complete,
        failed: failedCount,
        conflicts: plan.conflicts.length,
        processed: attempted,
      });

      const finishedAt = now();
      await repository.updateJob(job.id, {
        status,
        recordsTotal: collected.records.length,
        processed: attempted,
        updated: appliedSet.size,
        skipped: plan.skipped.length,
        failed: failedCount,
        errorSummary: this.summarise(collected.error, failedCount, plan.conflicts.length),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
      });

      return { job, status, plan, error: collected.error };
    } catch (thrown) {
      return this.failJob(job, startedAt, toIntegrationError(thrown));
    }
  }

  /** InventoryBlind -> ERP/Marketplace, for a prepared set of writes.
   *
   *  Batched into one adapter call because providers rate-limit per request. Each
   *  ack is recorded individually so a partial batch is visible per SKU rather
   *  than collapsed into one verdict. */
  async runOutboundStockPush(
    ctx: ConnectorContext,
    writes: PlannedOutboundWrite[],
    params: { syncType: SyncJobType; trigger: SyncTrigger }
  ): Promise<SyncOutcome> {
    const { repository, adapter, connection, now, newIdempotencyKey } = this.options;
    const startedAt = now();

    const job = await repository.createJob({
      connectionId: connection.connectionId,
      syncType: params.syncType,
      direction: 'outbound',
      entityType: 'adjustment',
      triggerSource: params.trigger,
      idempotencyKey: newIdempotencyKey(),
    });

    try {
      await repository.updateJob(job.id, { status: 'running' });

      if (writes.length === 0) {
        const finishedAt = now();
        await repository.updateJob(job.id, {
          status: 'success',
          recordsTotal: 0,
          processed: 0,
          finishedAt: finishedAt.toISOString(),
          durationMs: finishedAt.getTime() - startedAt.getTime(),
        });
        return { job, status: 'success', plan: null, error: null };
      }

      const operation = this.operationForWriteKind();
      const payload: StockWrite[] = writes.map(write => write.write);

      const result = await adapter.execute<WriteAck[]>(operation, () => {
        const connector = adapter.connector as unknown as Record<string, unknown>;
        const fn = connector[operation] as (
          c: ConnectorContext,
          w: StockWrite[]
        ) => Promise<never>;
        return fn.call(connector, ctx, payload);
      });

      const processedAt = now().toISOString();

      if (!result.success) {
        // The whole batch failed: every write is recorded as failed with the same
        // cause, so a retry has a per-SKU record to reconcile against instead of a
        // single opaque job error.
        await repository.recordItems(
          writes.map(write => ({
            jobId: job.id,
            connectionId: connection.connectionId,
            entityType: 'adjustment',
            internalId: write.internalId,
            externalId: write.externalId,
            operation: write.operation,
            status: 'failed' as SyncItemStatus,
            previousValue: { quantity: write.previousQuantity },
            newValue: { quantity: write.newQuantity },
            errorKind: result.error.kind,
            errorMessage: result.error.message,
            attempts: 1,
            processedAt,
          }))
        );
        return this.failJob(job, startedAt, result.error, writes.length);
      }

      const ackByExternalId = new Map(result.data.map(ack => [ack.productExternalId, ack]));
      let succeeded = 0;
      let failed = 0;
      let pending = 0;

      await repository.recordItems(
        writes.map(write => {
          const ack = ackByExternalId.get(write.externalId);
          // A missing ack is not a success. A provider that returns fewer acks
          // than we sent has done something we cannot verify, and assuming it
          // worked is how a lost adjustment becomes invisible.
          const status: SyncItemStatus =
            ack == null ? 'failed' : ack.pending ? 'pending' : ack.ok ? 'success' : 'failed';

          if (status === 'success') succeeded++;
          else if (status === 'pending') pending++;
          else failed++;

          return {
            jobId: job.id,
            connectionId: connection.connectionId,
            entityType: 'adjustment',
            internalId: write.internalId,
            externalId: write.externalId,
            operation: write.operation,
            status,
            previousValue: { quantity: write.previousQuantity },
            newValue: { quantity: write.newQuantity, policy: write.policy },
            errorKind: ack?.error?.kind ?? null,
            errorMessage:
              ack == null
                ? 'O provedor não confirmou este registro.'
                : ack.error?.message ?? null,
            attempts: 1,
            processedAt,
          };
        })
      );

      const status: SyncJobStatus =
        failed === 0 ? 'success' : succeeded + pending === 0 ? 'failed' : 'partial';

      const finishedAt = now();
      await repository.updateJob(job.id, {
        status,
        recordsTotal: writes.length,
        processed: writes.length,
        updated: succeeded,
        failed,
        skipped: pending,
        errorSummary: failed > 0 ? `${failed} de ${writes.length} registros recusados pelo provedor.` : null,
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
      });

      return { job, status, plan: null, error: null };
    } catch (thrown) {
      return this.failJob(job, startedAt, toIntegrationError(thrown), writes.length);
    }
  }

  // ── internals ────────────────────────────────────────────────────────────

  /** One pair per product, never per deposit — the aggregation upstream already
   *  collapsed deposits into a single total, which is the only figure comparable
   *  to the Core's scalar. */
  private async buildPairs(aggregated: AggregatedStock[]): Promise<StockPair[]> {
    const resolved = aggregated.map(entry => ({
      entry,
      internalId: this.options.resolveInternalId(entry.productExternalId),
    }));

    const internalIds = resolved
      .map(item => item.internalId)
      .filter((id): id is string => id !== null);

    const internalStock = internalIds.length > 0
      ? await this.options.repository.loadInternalStock(internalIds)
      : new Map<string, { quantity: number; observedAt: string | null }>();

    return resolved.map(({ entry, internalId }) => {
      const internal = internalId != null ? internalStock.get(internalId) : undefined;
      // A single-deposit product carries its deposit id so an outbound write lands
      // in the right place. With several deposits there is no single target, so it
      // is null and the provider applies the write to its own default — pushing a
      // summed total into one arbitrary deposit would be worse than letting the
      // provider decide.
      const singleWarehouse =
        entry.breakdown.length === 1 ? entry.breakdown[0].warehouseExternalId : null;

      return {
        internalId,
        externalId: entry.productExternalId,
        sku: null,
        warehouseExternalId: singleWarehouse,
        internal: {
          quantity: internal?.quantity ?? 0,
          observedAt: internal?.observedAt ?? null,
        },
        external: entry.total,
      };
    });
  }

  private conflictItem(jobId: string, conflict: PlannedConflict, processedAt: string): RecordItemInput {
    return {
      jobId,
      connectionId: this.options.connection.connectionId,
      entityType: 'stock',
      internalId: conflict.internalId,
      externalId: conflict.externalId,
      operation: 'skip',
      status: 'conflict',
      previousValue: conflict.internal,
      newValue: conflict.external,
      errorMessage:
        conflict.outcome.kind === 'needs_review' ? conflict.outcome.reason : 'blocked_by_direction',
      processedAt,
    };
  }

  private operationForWriteKind():
    | 'updateStock'
    | 'createStockAdjustment'
    | 'createStockTransfer'
    | 'createMovement' {
    switch (this.options.writeKind) {
      case 'movement':
        return 'createMovement';
      case 'transfer':
        return 'createStockTransfer';
      case 'delta':
        return 'createStockAdjustment';
      case 'absolute':
      default:
        return 'updateStock';
    }
  }

  /** A walk that did not finish is `partial` even when nothing failed, because
   *  the data is incomplete and downstream steps must not treat it as the whole
   *  truth. Conflicts also prevent `success`: the job did work but left decisions
   *  open, and a green status would hide a review queue. */
  private terminalStatus(params: {
    complete: boolean;
    failed: number;
    conflicts: number;
    processed: number;
  }): SyncJobStatus {
    if (!params.complete && params.processed === 0) return 'failed';
    if (!params.complete) return 'partial';
    if (params.failed > 0) return params.failed >= params.processed && params.processed > 0 ? 'failed' : 'partial';
    if (params.conflicts > 0) return 'partial';
    return 'success';
  }

  private summarise(
    error: IntegrationError | null,
    failed: number,
    conflicts: number
  ): string | null {
    const parts: string[] = [];
    if (error) parts.push(error.message);
    if (failed > 0) parts.push(`${failed} registro(s) com erro.`);
    if (conflicts > 0) parts.push(`${conflicts} divergência(s) aguardando revisão.`);
    return parts.length > 0 ? parts.join(' ') : null;
  }

  /** Terminal failure, always recorded. This is invariant 1: a job that dies must
   *  not be left `running`, or a scheduler will never retry it and nobody will
   *  know it stopped. */
  private async failJob(
    job: SyncJob,
    startedAt: Date,
    error: IntegrationError,
    processed = 0
  ): Promise<SyncOutcome> {
    const finishedAt = this.options.now();
    try {
      await this.options.repository.updateJob(job.id, {
        status: 'failed',
        processed,
        errorSummary: error.message,
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
      });
    } catch {
      // Recording the failure itself failed. Swallowed deliberately: the original
      // error is the one worth returning, and throwing here would replace a
      // diagnosable provider error with a database one.
    }
    return { job, status: 'failed', plan: null, error };
  }
}
