// Sync Engine — domain types.
//
// Type-only module: safe under browser and Deno, no imports with side effects.

import type { EntityType, SyncDirection, SyncFlow, SyncTrigger } from '../types.ts';
import type { StockWriteKind } from '../stockOperations.ts';
import type { IntegrationErrorKind } from '../errors.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Job
// ─────────────────────────────────────────────────────────────────────────────

/** How much the job reads.
 *
 *  A separate axis from `SyncTrigger` (who started it), and both matter: a MANUAL
 *  trigger can start a FULL or an INCREMENTAL sync, and a webhook always implies
 *  an incremental one. Collapsing the two loses the difference between "who" and
 *  "how much". */
export type SyncJobType = 'full' | 'incremental' | 'manual' | 'scheduled' | 'webhook';

export type SyncJobStatus = 'pending' | 'running' | 'success' | 'partial' | 'failed' | 'cancelled';

export type SyncEntityType = EntityType | 'stock' | 'adjustment';

export interface SyncJob {
  id: string;
  connectionId: string;
  syncType: SyncJobType;
  direction: SyncFlow;
  entityType: SyncEntityType;
  triggerSource: SyncTrigger;
  status: SyncJobStatus;
  /** What the provider claimed the total was, when it says. Distinct from
   *  `processed` — the gap between them is how a truncated walk is noticed. */
  recordsTotal: number | null;
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  cursorBefore: string | null;
  cursorAfter: string | null;
  errorSummary: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  idempotencyKey: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Item
// ─────────────────────────────────────────────────────────────────────────────

export type SyncItemOperation =
  | 'create'
  | 'update'
  | 'skip'
  | 'delete'
  | 'push_absolute'
  | 'push_delta'
  | 'push_transfer'
  | 'push_movement';

export type SyncItemStatus = 'pending' | 'success' | 'failed' | 'skipped' | 'conflict';

/** One record a job touched. `previousValue`/`newValue` are the audit trail: they
 *  are what makes "the sync changed this" answerable months later. */
export interface SyncItem {
  id: string;
  jobId: string;
  connectionId: string;
  entityType: SyncEntityType;
  internalId: string | null;
  externalId: string | null;
  operation: SyncItemOperation;
  status: SyncItemStatus;
  previousValue: unknown;
  newValue: unknown;
  errorKind: IntegrationErrorKind | null;
  errorMessage: string | null;
  attempts: number;
  processedAt: string | null;
}

/** Maps a write shape onto the item operation recorded for it, so reading an item
 *  row later never requires guessing whether 94 meant "set to 94" or "add 94". */
export const ITEM_OPERATION_FOR_WRITE: Record<StockWriteKind, SyncItemOperation> = {
  absolute: 'push_absolute',
  delta: 'push_delta',
  transfer: 'push_transfer',
  movement: 'push_movement',
};

// ─────────────────────────────────────────────────────────────────────────────
// Conflict
// ─────────────────────────────────────────────────────────────────────────────

/** Which side wins when the two disagree.
 *
 *  `manual_review` is the default rather than `erp_wins` because an ERP is not
 *  automatically right — it is frequently the thing being corrected by a count. */
export type ConflictPolicy =
  | 'erp_wins'
  | 'inventoryblind_wins'
  | 'last_write_wins'
  | 'manual_review';

export type ConflictStatus = 'pending' | 'resolved' | 'ignored';

/** A balance as one side reports it. `observedAt` is nullable because plenty of
 *  providers do not timestamp a stock read — and that absence is exactly what
 *  makes `last_write_wins` undecidable, so it must be representable. */
export interface StockObservation {
  quantity: number;
  reserved?: number | null;
  available?: number | null;
  warehouseExternalId?: string | null;
  observedAt: string | null;
}

export interface SyncConflict {
  id: string;
  connectionId: string;
  jobId: string | null;
  entityType: EntityType | 'stock';
  internalId: string | null;
  externalId: string | null;
  internalValue: unknown;
  externalValue: unknown;
  internalObservedAt: string | null;
  externalObservedAt: string | null;
  detectedAt: string;
  status: ConflictStatus;
  resolution: ConflictPolicy | 'manual' | 'ignored' | null;
  resolvedValue: unknown;
  resolvedBy: string | null;
  resolvedAt: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stock adjustment (count -> approval -> ERP)
// ─────────────────────────────────────────────────────────────────────────────

export type AdjustmentOrigin =
  | 'physical_count'
  | 'manual'
  | 'reconciliation'
  | 'conflict_resolution';

export type AdjustmentSyncStatus = 'pending' | 'sent' | 'confirmed' | 'failed' | 'skipped';

export interface StockAdjustment {
  id: string;
  connectionId: string;
  jobId: string | null;
  productId: string | null;
  externalProductId: string | null;
  sku: string | null;
  externalWarehouseId: string | null;
  origin: AdjustmentOrigin;
  sourceSessionId: string | null;
  previousQuantity: number;
  countedQuantity: number;
  /** Stored, not derived: this is what was actually sent. If the provider later
   *  reports a different balance we need to know what we asked for, not what the
   *  current numbers imply. */
  deltaQuantity: number;
  writeKind: StockWriteKind;
  reason: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  syncStatus: AdjustmentSyncStatus;
  /** Provider's id for the document it created — the trace on their side. */
  externalReference: string | null;
  errorKind: IntegrationErrorKind | null;
  errorMessage: string | null;
  attempts: number;
  sentAt: string | null;
  confirmedAt: string | null;
  idempotencyKey: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Incremental sync state
// ─────────────────────────────────────────────────────────────────────────────

/** How a provider expresses "what changed since last time". Providers support
 *  different subsets, so the engine carries whichever applies rather than forcing
 *  one shape. */
export interface IncrementalState {
  /** Opaque provider cursor / sync token. */
  cursor: string | null;
  /** Timestamp boundary for providers that filter by change time. */
  updatedSince: string | null;
  /** Monotonic revision, for providers that version their catalogue. */
  externalRevision: string | null;
}

export const EMPTY_INCREMENTAL_STATE: IncrementalState = {
  cursor: null,
  updatedSince: null,
  externalRevision: null,
};

/** Decide what a job of this type should read.
 *
 *  A FULL sync deliberately discards prior state: that is what makes it the
 *  recovery tool when an incremental walk has drifted or a cursor has gone stale.
 *  Everything else resumes. */
export function incrementalStateFor(
  syncType: SyncJobType,
  stored: IncrementalState
): IncrementalState {
  if (syncType === 'full') return EMPTY_INCREMENTAL_STATE;
  return stored;
}

/** Connection settings the engine needs. A narrow view on purpose: the engine
 *  should not be able to read a credential even by accident. */
export interface SyncConnectionConfig {
  connectionId: string;
  providerKey: string;
  direction: SyncDirection;
  conflictPolicy: ConflictPolicy;
}
