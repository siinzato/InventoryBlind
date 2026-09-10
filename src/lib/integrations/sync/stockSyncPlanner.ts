// Sync Engine — stock sync planner.
//
// Takes both sides of the world and produces a plan. It decides nothing about
// *how* to talk to a provider and touches no database: given the same inputs it
// always yields the same plan, which is what lets a caller show "isto é o que vai
// acontecer" before anything is written, and what lets the tests cover the matrix
// without a live account.
//
// Pure module: no I/O, no clock.

import { buildStockWriteKey } from '../matching.ts';
import { buildCountAdjustment, isNoOpWrite, type StockWrite, type StockWriteKind } from '../stockOperations.ts';
import {
  resolveStockConflict,
  type ConflictOutcome,
} from './conflictResolution.ts';
import type { ConflictPolicy, StockObservation, SyncItemOperation } from './syncTypes.ts';
import { ITEM_OPERATION_FOR_WRITE } from './syncTypes.ts';
import type { SyncDirection } from '../types.ts';

/** One product, as both systems see it, already matched by the mapping engine.
 *  `internalId === null` means the external record was never linked — it cannot
 *  participate in a stock decision, only in a product import. */
export interface StockPair {
  internalId: string | null;
  externalId: string;
  sku: string | null;
  warehouseExternalId: string | null;
  internal: StockObservation;
  external: StockObservation;
}

export interface PlannedInboundUpdate {
  internalId: string;
  externalId: string;
  previousQuantity: number;
  newQuantity: number;
  observedAt: string | null;
  policy: ConflictPolicy;
}

export interface PlannedOutboundWrite {
  internalId: string;
  externalId: string;
  write: StockWrite;
  operation: SyncItemOperation;
  previousQuantity: number;
  newQuantity: number;
  policy: ConflictPolicy;
}

export interface PlannedConflict {
  internalId: string | null;
  externalId: string;
  internal: StockObservation;
  external: StockObservation;
  outcome: ConflictOutcome;
}

export interface PlannedSkip {
  externalId: string;
  internalId: string | null;
  reason: 'in_sync' | 'unlinked' | 'no_op';
}

export interface StockSyncPlan {
  inbound: PlannedInboundUpdate[];
  outbound: PlannedOutboundWrite[];
  conflicts: PlannedConflict[];
  skipped: PlannedSkip[];
}

export interface PlanOptions {
  policy: ConflictPolicy;
  direction: SyncDirection;
  /** Which write shape the provider accepts, from
   *  stockOperations.preferredWriteKind. Null means it accepts none, so outbound
   *  decisions become conflicts rather than silently-dropped writes. */
  writeKind: StockWriteKind | null;
  /** Scope for the idempotency key — the job id, or a count session id. Two
   *  legitimately-repeated pushes of the same SKU must differ here, or the second
   *  will be swallowed as a duplicate of the first. */
  idempotencyScope: string;
  connectionId: string;
}

/** Build the plan.
 *
 *  Unlinked records are skipped rather than treated as new: without a mapping
 *  there is no internal row to update and no way to know which product the
 *  provider means. They belong to a product-import review, not a stock decision. */
export function planStockSync(pairs: StockPair[], options: PlanOptions): StockSyncPlan {
  const plan: StockSyncPlan = { inbound: [], outbound: [], conflicts: [], skipped: [] };

  for (const pair of pairs) {
    if (pair.internalId == null) {
      plan.skipped.push({ externalId: pair.externalId, internalId: null, reason: 'unlinked' });
      continue;
    }

    const outcome = resolveStockConflict({
      policy: options.policy,
      direction: options.direction,
      internal: pair.internal,
      external: pair.external,
    });

    if (outcome.kind === 'in_sync') {
      plan.skipped.push({ externalId: pair.externalId, internalId: pair.internalId, reason: 'in_sync' });
      continue;
    }

    // Explicit narrowing rather than requiresReview(): a boolean helper does not
    // narrow the union, and the compiler is right to insist here.
    if (outcome.kind === 'needs_review' || outcome.kind === 'blocked') {
      plan.conflicts.push({
        internalId: pair.internalId,
        externalId: pair.externalId,
        internal: pair.internal,
        external: pair.external,
        outcome,
      });
      continue;
    }

    if (outcome.kind === 'accept_external') {
      plan.inbound.push({
        internalId: pair.internalId,
        externalId: pair.externalId,
        previousQuantity: pair.internal.quantity,
        newQuantity: outcome.value,
        observedAt: pair.external.observedAt,
        policy: outcome.policy,
      });
      continue;
    }

    // outcome.kind === 'push_internal'
    if (options.writeKind == null) {
      // The policy says our number wins, but the provider cannot accept a write.
      // Recording a conflict is the honest outcome: dropping it would leave the
      // two systems permanently disagreeing with nothing to show for it.
      plan.conflicts.push({
        internalId: pair.internalId,
        externalId: pair.externalId,
        internal: pair.internal,
        external: pair.external,
        outcome: { kind: 'needs_review', reason: 'policy_manual_review' },
      });
      continue;
    }

    const write = buildCountAdjustment({
      productExternalId: pair.externalId,
      locationExternalId: pair.warehouseExternalId,
      systemQuantity: pair.external.quantity,
      countedQuantity: outcome.value,
      idempotencyKey: buildStockWriteKey({
        connectionId: options.connectionId,
        productExternalId: pair.externalId,
        warehouseExternalId: pair.warehouseExternalId,
        scope: options.idempotencyScope,
      }),
      reason: 'Sincronização de saldo InventoryBlind',
      kind: options.writeKind,
    });

    if (write == null || isNoOpWrite(write)) {
      plan.skipped.push({ externalId: pair.externalId, internalId: pair.internalId, reason: 'no_op' });
      continue;
    }

    plan.outbound.push({
      internalId: pair.internalId,
      externalId: pair.externalId,
      write,
      operation: ITEM_OPERATION_FOR_WRITE[options.writeKind],
      previousQuantity: pair.external.quantity,
      newQuantity: outcome.value,
      policy: outcome.policy,
    });
  }

  return plan;
}

/** Counters for the job record. Conflicts count as processed but not as updated:
 *  a conflict is work the engine did, and a decision it declined to make. */
export function planCounters(plan: StockSyncPlan): {
  processed: number;
  updated: number;
  skipped: number;
  conflicts: number;
} {
  return {
    processed: plan.inbound.length + plan.outbound.length + plan.conflicts.length + plan.skipped.length,
    updated: plan.inbound.length + plan.outbound.length,
    skipped: plan.skipped.length,
    conflicts: plan.conflicts.length,
  };
}

/** Turn approved count divergences into outbound writes.
 *
 *  This is the physical-count path, and it differs from `planStockSync` in one
 *  important way: there is no conflict policy to consult. An approved count *is*
 *  the decision — a human already looked at the divergence and signed it off, so
 *  re-litigating it against the ERP's number would undo the approval.
 *
 *  The idempotency scope is the session, so the same SKU counted in two different
 *  sessions produces two distinct writes rather than one being swallowed. */
export function planCountAdjustments(
  divergences: {
    internalId: string;
    externalId: string;
    warehouseExternalId: string | null;
    systemQuantity: number;
    countedQuantity: number;
  }[],
  options: {
    connectionId: string;
    sessionId: string;
    writeKind: StockWriteKind | null;
    reason?: string | null;
  }
): { writes: PlannedOutboundWrite[]; unsupported: string[]; noOps: string[] } {
  const writes: PlannedOutboundWrite[] = [];
  const unsupported: string[] = [];
  const noOps: string[] = [];

  for (const divergence of divergences) {
    if (options.writeKind == null) {
      unsupported.push(divergence.externalId);
      continue;
    }

    const write = buildCountAdjustment({
      productExternalId: divergence.externalId,
      locationExternalId: divergence.warehouseExternalId,
      systemQuantity: divergence.systemQuantity,
      countedQuantity: divergence.countedQuantity,
      idempotencyKey: buildStockWriteKey({
        connectionId: options.connectionId,
        productExternalId: divergence.externalId,
        warehouseExternalId: divergence.warehouseExternalId,
        scope: options.sessionId,
      }),
      reason: options.reason ?? `Contagem física ${options.sessionId}`,
      kind: options.writeKind,
    });

    if (write == null) {
      unsupported.push(divergence.externalId);
      continue;
    }
    if (isNoOpWrite(write)) {
      noOps.push(divergence.externalId);
      continue;
    }

    writes.push({
      internalId: divergence.internalId,
      externalId: divergence.externalId,
      write,
      operation: ITEM_OPERATION_FOR_WRITE[options.writeKind],
      previousQuantity: divergence.systemQuantity,
      newQuantity: divergence.countedQuantity,
      // Not a policy decision — a human approved this one.
      policy: 'inventoryblind_wins',
    });
  }

  return { writes, unsupported, noOps };
}
