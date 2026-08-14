import { describe, expect, it, vi } from 'vitest';
import { ProviderAdapter } from '../../adapter';
import { IntegrationError } from '../../errors';
import { ok, fail } from '../../result';
import type { Connector, ConnectorContext, RawRecord, WriteAck } from '../../connector';
import type { PageInfo } from '../../pagination';
import type { ProviderCapabilities } from '../../types';
import {
  isImplausibleDivergence,
  quantitiesAgree,
  requiresReview,
  resolveStockConflict,
} from '../conflictResolution';
import { planCountAdjustments, planCounters, planStockSync, type StockPair } from '../stockSyncPlanner';
import { EMPTY_INCREMENTAL_STATE, incrementalStateFor } from '../syncTypes';
import { SyncEngine, type SyncRepository } from '../syncEngine';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const FULL_CAPS: ProviderCapabilities = {
  read_products: true,
  read_stock: true,
  read_stock_by_warehouse: true,
  write_stock: true,
  write_adjustment: true,
};

const STOCK_MAP = {
  productExternalId: ['produto_id'],
  warehouseExternalId: ['deposito'],
  quantity: ['saldo'],
};

function stockRecord(id: string, saldo: unknown, deposito = 'D1'): RawRecord {
  return { externalId: id, payload: { produto_id: id, saldo, deposito } };
}

/** Connector returning fixed pages. Records what it was asked, so a test can
 *  assert the engine walked pages rather than assuming it did. */
function fakeConnector(options: {
  pages?: RawRecord[][];
  failStockWith?: IntegrationError;
  writeAcks?: (writes: unknown[]) => WriteAck[];
  failWriteWith?: IntegrationError;
  capabilities?: ProviderCapabilities;
}): Connector & { calls: { operation: string }[] } {
  const calls: { operation: string }[] = [];
  const pages = options.pages ?? [];

  return {
    providerKey: 'fake',
    capabilities: options.capabilities ?? FULL_CAPS,
    pageStrategy: 'page',
    calls,
    testConnection: vi.fn(),
    async getStockByLocation(_ctx, request) {
      calls.push({ operation: 'getStockByLocation' });
      if (options.failStockWith) {
        return fail(options.failStockWith, { provider: 'fake', operation: 'getStockByLocation' });
      }
      const pageNumber = request.page.strategy === 'page' ? request.page.page : 1;
      const data = pages[pageNumber - 1] ?? [];
      const pagination: PageInfo = {
        strategy: 'page',
        hasNext: pageNumber < pages.length,
        limit: request.page.limit,
      };
      return ok(data, { provider: 'fake', operation: 'getStockByLocation', pagination });
    },
    async createStockAdjustment(_ctx, writes) {
      calls.push({ operation: 'createStockAdjustment' });
      if (options.failWriteWith) {
        return fail(options.failWriteWith, { provider: 'fake', operation: 'createStockAdjustment' });
      }
      const acks = options.writeAcks
        ? options.writeAcks(writes)
        : writes.map(w => ({ productExternalId: w.productExternalId, ok: true, pending: false }));
      return ok(acks, { provider: 'fake', operation: 'createStockAdjustment' });
    },
    async updateStock(_ctx, writes) {
      calls.push({ operation: 'updateStock' });
      const acks = writes.map(w => ({ productExternalId: w.productExternalId, ok: true, pending: false }));
      return ok(acks, { provider: 'fake', operation: 'updateStock' });
    },
  } as Connector & { calls: { operation: string }[] };
}

/** In-memory repository. The whole reason the engine takes a port: the entire
 *  orchestration is exercised with no Supabase and no network. */
function fakeRepository(internal: Record<string, number> = {}, observedAt: string | null = null) {
  const state = {
    jobs: [] as Record<string, unknown>[],
    patches: [] as { jobId: string; patch: Record<string, unknown> }[],
    items: [] as Record<string, unknown>[],
    conflicts: [] as Record<string, unknown>[],
    appliedStock: [] as { internalId: string; quantity: number }[],
    savedState: null as unknown,
    stockLevels: [] as { externalProductId: string; warehouseExternalId: string | null; quantity: number }[],
    incremental: { ...EMPTY_INCREMENTAL_STATE },
    /** Internal ids the apply step should report as failed. */
    failApplyFor: [] as string[],
  };

  const repository: SyncRepository = {
    async createJob(input) {
      const job = { id: `job-${state.jobs.length + 1}`, ...input, status: 'pending' };
      state.jobs.push(job);
      return job as never;
    },
    async updateJob(jobId, patch) {
      state.patches.push({ jobId, patch: patch as Record<string, unknown> });
    },
    async recordItems(items) {
      state.items.push(...(items as unknown as Record<string, unknown>[]));
    },
    async upsertConflicts(conflicts) {
      state.conflicts.push(...(conflicts as unknown as Record<string, unknown>[]));
    },
    async applyInboundStock(updates) {
      const applied: string[] = [];
      const failed: string[] = [];
      for (const update of updates) {
        if (state.failApplyFor.includes(update.internalId)) failed.push(update.internalId);
        else {
          applied.push(update.internalId);
          state.appliedStock.push(update);
        }
      }
      return { applied, failed };
    },
    async loadInternalStock(ids) {
      const map = new Map<string, { quantity: number; observedAt: string | null }>();
      for (const id of ids) {
        if (internal[id] !== undefined) map.set(id, { quantity: internal[id], observedAt });
      }
      return map;
    },
    async saveStockLevels(levels) {
      state.stockLevels.push(...levels);
    },
    async saveIncrementalState(_connectionId, next) {
      state.savedState = next;
    },
    async loadIncrementalState() {
      return state.incremental;
    },
  };

  return { repository, state };
}

function buildEngine(options: {
  connector: Connector;
  policy?: 'erp_wins' | 'inventoryblind_wins' | 'last_write_wins' | 'manual_review';
  direction?: 'inbound' | 'outbound' | 'bidirectional';
  internal?: Record<string, number>;
  internalObservedAt?: string | null;
  writeKind?: 'absolute' | 'delta' | null;
  mapping?: Record<string, string>;
}) {
  const { repository, state } = fakeRepository(options.internal ?? {}, options.internalObservedAt ?? null);
  const adapter = new ProviderAdapter({
    connector: options.connector,
    direction: options.direction ?? 'bidirectional',
    sleep: async () => {},
    now: () => 0,
    random: () => 0,
  });

  const mapping = options.mapping ?? {};
  let clock = 0;

  const engine = new SyncEngine({
    repository,
    adapter,
    connection: {
      connectionId: 'conn-1',
      providerKey: 'fake',
      direction: options.direction ?? 'bidirectional',
      conflictPolicy: options.policy ?? 'erp_wins',
    },
    now: () => new Date(clock += 1000),
    newIdempotencyKey: () => 'idem-1',
    stockFieldMap: STOCK_MAP,
    writeKind: options.writeKind === undefined ? 'delta' : options.writeKind,
    resolveInternalId: externalId => mapping[externalId] ?? null,
  });

  return { engine, state, adapter };
}

const CTX: ConnectorContext = {
  connectionId: 'conn-1',
  secret: 'irrelevant',
  externalAccountId: null,
  configuration: {},
};

function lastPatch(state: { patches: { patch: Record<string, unknown> }[] }) {
  return state.patches[state.patches.length - 1].patch;
}

// ─────────────────────────────────────────────────────────────────────────────
// Conflict policy matrix
// ─────────────────────────────────────────────────────────────────────────────

describe('conflict resolution', () => {
  const obs = (quantity: number, observedAt: string | null = null) => ({ quantity, observedAt });

  it('treats float noise as agreement, not as a disagreement to review', () => {
    expect(quantitiesAgree(10, 10.0005)).toBe(true);
    expect(quantitiesAgree(10, 10.5)).toBe(false);
  });

  it('reports in_sync when both sides match', () => {
    const outcome = resolveStockConflict({
      policy: 'manual_review', direction: 'bidirectional', internal: obs(100), external: obs(100),
    });
    expect(outcome).toEqual({ kind: 'in_sync' });
  });

  it('defaults to review rather than guessing a winner', () => {
    // InventoryBlind 100 vs ERP 80: nothing is overwritten.
    const outcome = resolveStockConflict({
      policy: 'manual_review', direction: 'bidirectional', internal: obs(100), external: obs(80),
    });
    expect(outcome).toEqual({ kind: 'needs_review', reason: 'policy_manual_review' });
    expect(requiresReview(outcome)).toBe(true);
  });

  it('erp_wins accepts the external value', () => {
    expect(resolveStockConflict({
      policy: 'erp_wins', direction: 'bidirectional', internal: obs(100), external: obs(80),
    })).toEqual({ kind: 'accept_external', policy: 'erp_wins', value: 80 });
  });

  it('inventoryblind_wins pushes the internal value', () => {
    expect(resolveStockConflict({
      policy: 'inventoryblind_wins', direction: 'bidirectional', internal: obs(100), external: obs(80),
    })).toEqual({ kind: 'push_internal', policy: 'inventoryblind_wins', value: 100 });
  });

  it('last_write_wins follows the later observation, in both directions', () => {
    const externalNewer = resolveStockConflict({
      policy: 'last_write_wins', direction: 'bidirectional',
      internal: obs(100, '2026-01-01T00:00:00Z'), external: obs(80, '2026-01-02T00:00:00Z'),
    });
    expect(externalNewer).toMatchObject({ kind: 'accept_external', value: 80 });

    const internalNewer = resolveStockConflict({
      policy: 'last_write_wins', direction: 'bidirectional',
      internal: obs(100, '2026-01-03T00:00:00Z'), external: obs(80, '2026-01-02T00:00:00Z'),
    });
    expect(internalNewer).toMatchObject({ kind: 'push_internal', value: 100 });
  });

  it('refuses last_write_wins when a timestamp is missing', () => {
    // "Latest" is unknowable, and guessing silently picks a winner.
    expect(resolveStockConflict({
      policy: 'last_write_wins', direction: 'bidirectional',
      internal: obs(100, null), external: obs(80, '2026-01-02T00:00:00Z'),
    })).toEqual({ kind: 'needs_review', reason: 'missing_timestamps' });
  });

  it('refuses last_write_wins on an unparseable timestamp', () => {
    expect(resolveStockConflict({
      policy: 'last_write_wins', direction: 'bidirectional',
      internal: obs(100, 'not-a-date'), external: obs(80, '2026-01-02T00:00:00Z'),
    })).toEqual({ kind: 'needs_review', reason: 'missing_timestamps' });
  });

  it('refuses to flip a coin on simultaneous writes', () => {
    expect(resolveStockConflict({
      policy: 'last_write_wins', direction: 'bidirectional',
      internal: obs(100, '2026-01-02T00:00:00Z'), external: obs(80, '2026-01-02T00:00:00Z'),
    })).toEqual({ kind: 'needs_review', reason: 'simultaneous_writes' });
  });

  it('blocks a policy that wants to write through a read-only connection', () => {
    expect(resolveStockConflict({
      policy: 'inventoryblind_wins', direction: 'inbound', internal: obs(100), external: obs(80),
    })).toEqual({ kind: 'blocked', reason: 'direction', wanted: 'outbound', direction: 'inbound' });
  });

  it('blocks erp_wins on a write-only connection', () => {
    expect(resolveStockConflict({
      policy: 'erp_wins', direction: 'outbound', internal: obs(100), external: obs(80),
    })).toEqual({ kind: 'blocked', reason: 'direction', wanted: 'inbound', direction: 'outbound' });
  });

  it('stops an implausible divergence even under an automatic policy', () => {
    // This is the mismapped-SKU guard: erp_wins must not replace 5 with 50.000.
    expect(isImplausibleDivergence(5, 50_000)).toBe(true);
    expect(resolveStockConflict({
      policy: 'erp_wins', direction: 'bidirectional', internal: obs(5), external: obs(50_000),
    })).toEqual({ kind: 'needs_review', reason: 'implausible_divergence' });
  });

  it('does not flag ordinary variance as implausible', () => {
    expect(isImplausibleDivergence(100, 80)).toBe(false);   // below the floor
    expect(isImplausibleDivergence(1, 12)).toBe(false);      // ratio high, gap tiny
    expect(isImplausibleDivergence(5000, 4000)).toBe(false); // big gap, low ratio
    expect(isImplausibleDivergence(5000, 0)).toBe(false);    // never imported: plausible
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Planner
// ─────────────────────────────────────────────────────────────────────────────

describe('stock sync planner', () => {
  const pair = (over: Partial<StockPair> = {}): StockPair => ({
    internalId: 'p1',
    externalId: 'e1',
    sku: null,
    warehouseExternalId: 'D1',
    internal: { quantity: 100, observedAt: null },
    external: { quantity: 80, observedAt: '2026-01-01T00:00:00Z' },
    ...over,
  });

  const options = {
    policy: 'erp_wins' as const,
    direction: 'bidirectional' as const,
    writeKind: 'delta' as const,
    idempotencyScope: 'job-1',
    connectionId: 'conn-1',
  };

  it('plans an inbound update under erp_wins', () => {
    const plan = planStockSync([pair()], options);
    expect(plan.inbound).toHaveLength(1);
    expect(plan.inbound[0]).toMatchObject({ previousQuantity: 100, newQuantity: 80 });
    expect(plan.outbound).toHaveLength(0);
  });

  it('skips an unlinked record instead of treating it as new', () => {
    // Without a mapping there is no internal row and no way to know which product
    // the provider means; it belongs to a product import, not a stock decision.
    const plan = planStockSync([pair({ internalId: null })], options);
    expect(plan.skipped).toEqual([{ externalId: 'e1', internalId: null, reason: 'unlinked' }]);
  });

  it('skips matching balances', () => {
    const plan = planStockSync(
      [pair({ external: { quantity: 100, observedAt: null } })],
      options
    );
    expect(plan.skipped[0]).toMatchObject({ reason: 'in_sync' });
  });

  it('plans an outbound delta under inventoryblind_wins, signed against the provider', () => {
    const plan = planStockSync([pair()], { ...options, policy: 'inventoryblind_wins' });
    expect(plan.outbound).toHaveLength(1);
    // Provider has 80, we say 100: the delta sent is +20.
    expect(plan.outbound[0].write).toMatchObject({ kind: 'delta', deltaQuantity: 20 });
    expect(plan.outbound[0].operation).toBe('push_delta');
  });

  it('plans an absolute write when that is all the provider accepts', () => {
    const plan = planStockSync([pair()], {
      ...options, policy: 'inventoryblind_wins', writeKind: 'absolute',
    });
    expect(plan.outbound[0].write).toMatchObject({
      kind: 'absolute', targetQuantity: 100, expectedCurrentQuantity: 80,
    });
    expect(plan.outbound[0].operation).toBe('push_absolute');
  });

  it('records a conflict when the policy wants to write but the provider cannot', () => {
    // Dropping it would leave both systems permanently disagreeing with nothing
    // to show for it.
    const plan = planStockSync([pair()], {
      ...options, policy: 'inventoryblind_wins', writeKind: null,
    });
    expect(plan.outbound).toHaveLength(0);
    expect(plan.conflicts).toHaveLength(1);
  });

  it('gives every write a distinct, deterministic idempotency key', () => {
    const plan = planStockSync(
      [pair({ externalId: 'e1' }), pair({ externalId: 'e2', internalId: 'p2' })],
      { ...options, policy: 'inventoryblind_wins' }
    );
    const keys = plan.outbound.map(w => w.write.idempotencyKey);
    expect(new Set(keys).size).toBe(2);

    const again = planStockSync([pair({ externalId: 'e1' })], { ...options, policy: 'inventoryblind_wins' });
    expect(again.outbound[0].write.idempotencyKey).toBe(keys[0]);
  });

  it('counts conflicts as processed but not as updated', () => {
    const plan = planStockSync(
      [pair(), pair({ externalId: 'e2', internalId: 'p2' })],
      { ...options, policy: 'manual_review' }
    );
    expect(planCounters(plan)).toEqual({ processed: 2, updated: 0, skipped: 0, conflicts: 2 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Count adjustments
// ─────────────────────────────────────────────────────────────────────────────

describe('planCountAdjustments', () => {
  const divergence = {
    internalId: 'p1', externalId: 'e1', warehouseExternalId: 'D1',
    systemQuantity: 100, countedQuantity: 94,
  };

  it('does not re-litigate an approved count against the ERP', () => {
    // A human already signed this off; consulting a policy would undo the approval.
    const result = planCountAdjustments([divergence], {
      connectionId: 'conn-1', sessionId: 's-1', writeKind: 'delta',
    });
    expect(result.writes).toHaveLength(1);
    expect(result.writes[0].write).toMatchObject({ kind: 'delta', deltaQuantity: -6 });
    expect(result.writes[0].policy).toBe('inventoryblind_wins');
  });

  it('expresses the same count as an absolute when required', () => {
    const result = planCountAdjustments([divergence], {
      connectionId: 'conn-1', sessionId: 's-1', writeKind: 'absolute',
    });
    // SET_STOCK 94, not DELTA -6. Same divergence, different instruction.
    expect(result.writes[0].write).toMatchObject({ kind: 'absolute', targetQuantity: 94 });
  });

  it('separates two sessions counting the same SKU', () => {
    const a = planCountAdjustments([divergence], { connectionId: 'c', sessionId: 's-1', writeKind: 'delta' });
    const b = planCountAdjustments([divergence], { connectionId: 'c', sessionId: 's-2', writeKind: 'delta' });
    expect(a.writes[0].write.idempotencyKey).not.toBe(b.writes[0].write.idempotencyKey);
  });

  it('is idempotent for the same session', () => {
    const a = planCountAdjustments([divergence], { connectionId: 'c', sessionId: 's-1', writeKind: 'delta' });
    const b = planCountAdjustments([divergence], { connectionId: 'c', sessionId: 's-1', writeKind: 'delta' });
    expect(a.writes[0].write.idempotencyKey).toBe(b.writes[0].write.idempotencyKey);
  });

  it('reports unsupported instead of silently dropping', () => {
    const result = planCountAdjustments([divergence], {
      connectionId: 'c', sessionId: 's-1', writeKind: null,
    });
    expect(result.writes).toHaveLength(0);
    expect(result.unsupported).toEqual(['e1']);
  });

  it('drops a zero-delta count rather than calling the provider', () => {
    const result = planCountAdjustments(
      [{ ...divergence, countedQuantity: 100 }],
      { connectionId: 'c', sessionId: 's-1', writeKind: 'delta' }
    );
    expect(result.writes).toHaveLength(0);
    expect(result.noOps).toEqual(['e1']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Incremental state
// ─────────────────────────────────────────────────────────────────────────────

describe('incremental state', () => {
  const stored = { cursor: 'c9', updatedSince: '2026-01-01T00:00:00Z', externalRevision: 'r5' };

  it('a full sync discards prior state, which is what makes it the recovery tool', () => {
    expect(incrementalStateFor('full', stored)).toEqual(EMPTY_INCREMENTAL_STATE);
  });

  it('every other type resumes', () => {
    for (const type of ['incremental', 'manual', 'scheduled', 'webhook'] as const) {
      expect(incrementalStateFor(type, stored)).toEqual(stored);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Engine — inbound
// ─────────────────────────────────────────────────────────────────────────────

describe('SyncEngine inbound stock', () => {
  it('runs a full sync across pages and applies accepted balances', async () => {
    const connector = fakeConnector({
      pages: [[stockRecord('e1', 80)], [stockRecord('e2', 55)]],
    });
    const { engine, state } = buildEngine({
      connector, policy: 'erp_wins',
      internal: { p1: 100, p2: 40 },
      mapping: { e1: 'p1', e2: 'p2' },
    });

    const outcome = await engine.runInboundStockSync(CTX, { syncType: 'full', trigger: 'manual' });

    expect(outcome.status).toBe('success');
    expect(connector.calls.filter(c => c.operation === 'getStockByLocation')).toHaveLength(2);
    expect(state.appliedStock).toEqual([
      { internalId: 'p1', quantity: 80 },
      { internalId: 'p2', quantity: 55 },
    ]);
    expect(lastPatch(state)).toMatchObject({ status: 'success', updated: 2, recordsTotal: 2 });
  });

  it('advances the incremental cursor only on a complete walk', async () => {
    const connector = fakeConnector({ pages: [[stockRecord('e1', 80)]] });
    const { engine, state } = buildEngine({
      connector, policy: 'erp_wins', internal: { p1: 100 }, mapping: { e1: 'p1' },
    });
    await engine.runInboundStockSync(CTX, { syncType: 'incremental', trigger: 'schedule' });
    expect(state.savedState).not.toBeNull();
  });

  it('does not advance the cursor after a failed page', async () => {
    // Saving it would permanently skip whatever the failed page contained.
    const connector = fakeConnector({
      failStockWith: new IntegrationError({ kind: 'PROVIDER_UNAVAILABLE', message: 'down' }),
    });
    const { engine, state } = buildEngine({ connector, policy: 'erp_wins' });

    const outcome = await engine.runInboundStockSync(CTX, { syncType: 'incremental', trigger: 'schedule' });

    expect(state.savedState).toBeNull();
    expect(outcome.status).toBe('failed');
  });

  it('records a conflict and writes nothing under manual_review', async () => {
    const connector = fakeConnector({ pages: [[stockRecord('e1', 80)]] });
    const { engine, state } = buildEngine({
      connector, policy: 'manual_review', internal: { p1: 100 }, mapping: { e1: 'p1' },
    });

    const outcome = await engine.runInboundStockSync(CTX, { syncType: 'manual', trigger: 'manual' });

    expect(state.appliedStock).toHaveLength(0);
    expect(state.conflicts).toHaveLength(1);
    expect(state.conflicts[0]).toMatchObject({ externalId: 'e1', reason: 'policy_manual_review' });
    // Open decisions must not read as a green run.
    expect(outcome.status).toBe('partial');
  });

  it('records an unreadable provider record as failed without aborting the page', async () => {
    const connector = fakeConnector({
      pages: [[stockRecord('e1', 80), { externalId: 'e2', payload: { produto_id: 'e2' } }]],
    });
    const { engine, state } = buildEngine({
      connector, policy: 'erp_wins', internal: { p1: 100 }, mapping: { e1: 'p1', e2: 'p2' },
    });

    const outcome = await engine.runInboundStockSync(CTX, { syncType: 'full', trigger: 'manual' });

    // The good record still applied; the bad one is a failed item.
    expect(state.appliedStock).toEqual([{ internalId: 'p1', quantity: 80 }]);
    expect(state.items.filter(i => i.status === 'failed')).toHaveLength(1);
    expect(outcome.status).toBe('partial');
  });

  it('reports failed when the apply step rejects every update', async () => {
    const connector = fakeConnector({ pages: [[stockRecord('e1', 80)]] });
    const { engine, state } = buildEngine({
      connector, policy: 'erp_wins', internal: { p1: 100 }, mapping: { e1: 'p1' },
    });
    state.failApplyFor.push('p1');

    const outcome = await engine.runInboundStockSync(CTX, { syncType: 'full', trigger: 'manual' });
    expect(outcome.status).toBe('failed');
  });

  it('writes an audit item carrying both the previous and the new value', async () => {
    const connector = fakeConnector({ pages: [[stockRecord('e1', 80)]] });
    const { engine, state } = buildEngine({
      connector, policy: 'erp_wins', internal: { p1: 100 }, mapping: { e1: 'p1' },
    });
    await engine.runInboundStockSync(CTX, { syncType: 'full', trigger: 'manual' });

    const item = state.items.find(i => i.operation === 'update');
    expect(item).toMatchObject({
      previousValue: { quantity: 100 },
      newValue: { quantity: 80, policy: 'erp_wins' },
      status: 'success',
    });
  });

  it('always reaches a terminal status, even when the repository throws', async () => {
    // A job stuck in `running` is worse than a failed one: a scheduler will not
    // retry it and nobody knows it died.
    const connector = fakeConnector({ pages: [[stockRecord('e1', 80)]] });
    const { engine, state } = buildEngine({
      connector, policy: 'erp_wins', internal: { p1: 100 }, mapping: { e1: 'p1' },
    });
    state.failApplyFor.push('__none__');
    const original = engine as unknown as { options: { repository: SyncRepository } };
    original.options.repository.recordItems = async () => {
      throw new Error('database exploded');
    };

    const outcome = await engine.runInboundStockSync(CTX, { syncType: 'full', trigger: 'manual' });

    expect(outcome.status).toBe('failed');
    expect(lastPatch(state)).toMatchObject({ status: 'failed' });
  });

  it('skips a record whose balance already matches', async () => {
    const connector = fakeConnector({ pages: [[stockRecord('e1', 100)]] });
    const { engine, state } = buildEngine({
      connector, policy: 'erp_wins', internal: { p1: 100 }, mapping: { e1: 'p1' },
    });

    const outcome = await engine.runInboundStockSync(CTX, { syncType: 'full', trigger: 'manual' });

    expect(state.appliedStock).toHaveLength(0);
    expect(outcome.status).toBe('success');
    expect(lastPatch(state)).toMatchObject({ skipped: 1 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Engine — outbound
// ─────────────────────────────────────────────────────────────────────────────

describe('SyncEngine outbound push', () => {
  const writes = [
    {
      internalId: 'p1', externalId: 'e1',
      write: { kind: 'delta' as const, productExternalId: 'e1', locationExternalId: 'D1', deltaQuantity: -6, idempotencyKey: 'k1' },
      operation: 'push_delta' as const, previousQuantity: 100, newQuantity: 94,
      policy: 'inventoryblind_wins' as const,
    },
    {
      internalId: 'p2', externalId: 'e2',
      write: { kind: 'delta' as const, productExternalId: 'e2', locationExternalId: 'D1', deltaQuantity: 3, idempotencyKey: 'k2' },
      operation: 'push_delta' as const, previousQuantity: 10, newQuantity: 13,
      policy: 'inventoryblind_wins' as const,
    },
  ];

  it('pushes the batch in one call and records each ack', async () => {
    const connector = fakeConnector({});
    const { engine, state } = buildEngine({ connector, writeKind: 'delta' });

    const outcome = await engine.runOutboundStockPush(CTX, writes, { syncType: 'manual', trigger: 'manual' });

    expect(outcome.status).toBe('success');
    // Providers rate-limit per request: two writes must be one call.
    expect(connector.calls.filter(c => c.operation === 'createStockAdjustment')).toHaveLength(1);
    expect(state.items).toHaveLength(2);
    expect(lastPatch(state)).toMatchObject({ status: 'success', updated: 2 });
  });

  it('reports partial when the provider rejects some records', async () => {
    const connector = fakeConnector({
      writeAcks: () => [
        { productExternalId: 'e1', ok: true, pending: false },
        {
          productExternalId: 'e2', ok: false, pending: false,
          error: new IntegrationError({ kind: 'VALIDATION', message: 'SKU inexistente' }),
        },
      ],
    });
    const { engine, state } = buildEngine({ connector, writeKind: 'delta' });

    const outcome = await engine.runOutboundStockPush(CTX, writes, { syncType: 'manual', trigger: 'manual' });

    expect(outcome.status).toBe('partial');
    expect(state.items.filter(i => i.status === 'failed')).toHaveLength(1);
    expect(lastPatch(state)).toMatchObject({ updated: 1, failed: 1 });
  });

  it('treats a missing ack as failed, not as success', async () => {
    // A provider returning fewer acks than we sent has done something we cannot
    // verify; assuming it worked is how a lost adjustment becomes invisible.
    const connector = fakeConnector({
      writeAcks: () => [{ productExternalId: 'e1', ok: true, pending: false }],
    });
    const { engine, state } = buildEngine({ connector, writeKind: 'delta' });

    const outcome = await engine.runOutboundStockPush(CTX, writes, { syncType: 'manual', trigger: 'manual' });

    expect(outcome.status).toBe('partial');
    const unconfirmed = state.items.find(i => i.externalId === 'e2');
    expect(unconfirmed).toMatchObject({ status: 'failed' });
    expect(String(unconfirmed?.errorMessage)).toContain('não confirmou');
  });

  it('keeps a pending ack out of both the success and the failure count', async () => {
    // Structurally ready but not actually sent — not a failure.
    const connector = fakeConnector({
      writeAcks: () => [
        { productExternalId: 'e1', ok: false, pending: true },
        { productExternalId: 'e2', ok: false, pending: true },
      ],
    });
    const { engine, state } = buildEngine({ connector, writeKind: 'delta' });

    const outcome = await engine.runOutboundStockPush(CTX, writes, { syncType: 'manual', trigger: 'manual' });

    expect(outcome.status).toBe('success');
    expect(lastPatch(state)).toMatchObject({ updated: 0, failed: 0, skipped: 2 });
  });

  it('records every write as failed when the whole batch fails', async () => {
    const connector = fakeConnector({
      failWriteWith: new IntegrationError({ kind: 'AUTH_INVALID', message: 'chave inválida' }),
    });
    const { engine, state } = buildEngine({ connector, writeKind: 'delta' });

    const outcome = await engine.runOutboundStockPush(CTX, writes, { syncType: 'manual', trigger: 'manual' });

    expect(outcome.status).toBe('failed');
    // A retry needs a per-SKU record to reconcile against, not one opaque error.
    expect(state.items).toHaveLength(2);
    expect(state.items.every(i => i.status === 'failed')).toBe(true);
  });

  it('succeeds trivially with nothing to push, without calling the provider', async () => {
    const connector = fakeConnector({});
    const { engine, state } = buildEngine({ connector, writeKind: 'delta' });

    const outcome = await engine.runOutboundStockPush(CTX, [], { syncType: 'manual', trigger: 'manual' });

    expect(outcome.status).toBe('success');
    expect(connector.calls).toHaveLength(0);
    expect(lastPatch(state)).toMatchObject({ status: 'success', processed: 0 });
  });

  it('refuses to push through an inbound-only connection', async () => {
    const connector = fakeConnector({});
    const { engine } = buildEngine({ connector, direction: 'inbound', writeKind: 'delta' });

    const outcome = await engine.runOutboundStockPush(CTX, writes, { syncType: 'manual', trigger: 'manual' });

    expect(outcome.status).toBe('failed');
    expect(connector.calls).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Retry, through the adapter the engine uses
// ─────────────────────────────────────────────────────────────────────────────

describe('retry through the engine adapter', () => {
  it('retries a temporary failure and then succeeds', async () => {
    let attempts = 0;
    const connector = {
      providerKey: 'fake',
      capabilities: FULL_CAPS,
      pageStrategy: 'page' as const,
      testConnection: vi.fn(),
      async getStockByLocation(_ctx: ConnectorContext, request: { page: { limit: number } }) {
        attempts++;
        if (attempts < 3) {
          return fail(new IntegrationError({ kind: 'NETWORK', message: 'flap' }), {
            provider: 'fake', operation: 'getStockByLocation',
          });
        }
        return ok([stockRecord('e1', 80)], {
          provider: 'fake', operation: 'getStockByLocation',
          pagination: { strategy: 'page', hasNext: false, limit: request.page.limit },
        });
      },
    } as unknown as Connector;

    const { engine, state } = buildEngine({
      connector, policy: 'erp_wins', internal: { p1: 100 }, mapping: { e1: 'p1' },
    });

    const outcome = await engine.runInboundStockSync(CTX, { syncType: 'full', trigger: 'manual' });

    expect(attempts).toBe(3);
    expect(outcome.status).toBe('success');
    expect(state.appliedStock).toEqual([{ internalId: 'p1', quantity: 80 }]);
  });

  it('gives up after the ceiling instead of retrying forever', async () => {
    let attempts = 0;
    const connector = {
      providerKey: 'fake',
      capabilities: FULL_CAPS,
      pageStrategy: 'page' as const,
      testConnection: vi.fn(),
      async getStockByLocation() {
        attempts++;
        return fail(new IntegrationError({ kind: 'NETWORK', message: 'always down' }), {
          provider: 'fake', operation: 'getStockByLocation',
        });
      },
    } as unknown as Connector;

    const { engine } = buildEngine({ connector, policy: 'erp_wins' });
    const outcome = await engine.runInboundStockSync(CTX, { syncType: 'full', trigger: 'manual' });

    // DEFAULT_RETRY_POLICY.maxAttempts = 3.
    expect(attempts).toBe(3);
    expect(outcome.status).toBe('failed');
  });

  it('does not retry a permanent failure', async () => {
    let attempts = 0;
    const connector = {
      providerKey: 'fake',
      capabilities: FULL_CAPS,
      pageStrategy: 'page' as const,
      testConnection: vi.fn(),
      async getStockByLocation() {
        attempts++;
        return fail(new IntegrationError({ kind: 'AUTH_INVALID', message: 'bad key' }), {
          provider: 'fake', operation: 'getStockByLocation',
        });
      },
    } as unknown as Connector;

    const { engine } = buildEngine({ connector, policy: 'erp_wins' });
    await engine.runInboundStockSync(CTX, { syncType: 'full', trigger: 'manual' });

    expect(attempts).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Per-warehouse aggregation
//
// The Core holds one scalar per product; providers report per deposit. Comparing
// a single deposit against the total invents conflicts, so deposits are summed
// before any decision and the breakdown is kept separately.
// ─────────────────────────────────────────────────────────────────────────────

describe('stock aggregation', () => {
  const level = (
    productExternalId: string,
    quantity: number,
    warehouseExternalId: string | null,
    extra: Partial<{ reserved: number | null; available: number | null; observedAt: string }> = {}
  ) => ({
    productExternalId,
    warehouseExternalId,
    warehouseName: null,
    quantity,
    reserved: extra.reserved ?? null,
    available: extra.available ?? null,
    observedAt: extra.observedAt ?? '2026-01-01T00:00:00.000Z',
  });

  it('sums deposits into one balance per product', async () => {
    const { aggregateStockByProduct } = await import('../stockAggregation');
    const result = aggregateStockByProduct([
      level('e1', 80, 'D1'),
      level('e1', 30, 'D2'),
      level('e2', 5, 'D1'),
    ]);

    expect(result).toHaveLength(2);
    const e1 = result.find(r => r.productExternalId === 'e1');
    expect(e1?.total.quantity).toBe(110);
    expect(e1?.breakdown).toHaveLength(2);
  });

  it('keeps reserved null when no deposit reports it', async () => {
    const { aggregateStockByProduct } = await import('../stockAggregation');
    const [entry] = aggregateStockByProduct([level('e1', 80, 'D1'), level('e1', 30, 'D2')]);
    // Summing nulls as zero would turn "we don't know" into "none reserved",
    // which reads as more available stock than exists.
    expect(entry.total.reserved).toBeNull();
  });

  it('sums reserved when at least one deposit reports it', async () => {
    const { aggregateStockByProduct } = await import('../stockAggregation');
    const [entry] = aggregateStockByProduct([
      level('e1', 80, 'D1', { reserved: 5 }),
      level('e1', 30, 'D2', { reserved: 2 }),
    ]);
    expect(entry.total.reserved).toBe(7);
  });

  it('takes the freshest observation, not the oldest', async () => {
    const { aggregateStockByProduct } = await import('../stockAggregation');
    const [entry] = aggregateStockByProduct([
      level('e1', 80, 'D1', { observedAt: '2026-01-01T00:00:00.000Z' }),
      level('e1', 30, 'D2', { observedAt: '2026-03-01T00:00:00.000Z' }),
    ]);
    // Claiming the oldest would make a current balance look stale enough for
    // last_write_wins to discard it.
    expect(entry.total.observedAt).toBe('2026-03-01T00:00:00.000Z');
  });

  it('sums a deposit split across pages instead of deduplicating it', async () => {
    const { aggregateStockByProduct } = await import('../stockAggregation');
    const [entry] = aggregateStockByProduct([level('e1', 40, 'D1'), level('e1', 25, 'D1')]);
    expect(entry.total.quantity).toBe(65);
  });

  it('flags products spread over more than one deposit', async () => {
    const { aggregateStockByProduct, hasMultiWarehouseProducts } = await import('../stockAggregation');
    expect(hasMultiWarehouseProducts(aggregateStockByProduct([level('e1', 80, 'D1')]))).toBe(false);
    expect(
      hasMultiWarehouseProducts(aggregateStockByProduct([level('e1', 80, 'D1'), level('e1', 30, 'D2')]))
    ).toBe(true);
  });
});

describe('SyncEngine with multiple deposits', () => {
  it('compares the summed total, not one deposit, so agreement is not a conflict', async () => {
    // CD-SP 80 + CD-RJ 30 = 110 internal. Per-deposit comparison would have
    // reported two divergences here.
    const connector = fakeConnector({
      pages: [[stockRecord('e1', 80, 'D1'), stockRecord('e1', 30, 'D2')]],
    });
    const { engine, state } = buildEngine({
      connector, policy: 'manual_review', internal: { p1: 110 }, mapping: { e1: 'p1' },
    });

    const outcome = await engine.runInboundStockSync(CTX, { syncType: 'full', trigger: 'manual' });

    expect(state.conflicts).toHaveLength(0);
    expect(outcome.status).toBe('success');
  });

  it('applies the summed total to the Core scalar', async () => {
    const connector = fakeConnector({
      pages: [[stockRecord('e1', 80, 'D1'), stockRecord('e1', 30, 'D2')]],
    });
    const { engine, state } = buildEngine({
      connector, policy: 'erp_wins', internal: { p1: 50 }, mapping: { e1: 'p1' },
    });

    await engine.runInboundStockSync(CTX, { syncType: 'full', trigger: 'manual' });

    expect(state.appliedStock).toEqual([{ internalId: 'p1', quantity: 110 }]);
  });

  it('persists the per-deposit breakdown even when the total is left untouched', async () => {
    const connector = fakeConnector({
      pages: [[stockRecord('e1', 80, 'D1'), stockRecord('e1', 30, 'D2')]],
    });
    const { engine, state } = buildEngine({
      connector, policy: 'manual_review', internal: { p1: 999 }, mapping: { e1: 'p1' },
    });

    await engine.runInboundStockSync(CTX, { syncType: 'full', trigger: 'manual' });

    // Nothing applied (manual_review), but the breakdown survives.
    expect(state.appliedStock).toHaveLength(0);
    expect(state.stockLevels).toHaveLength(2);
    expect(state.stockLevels.map(l => l.warehouseExternalId).sort()).toEqual(['D1', 'D2']);
  });
});
