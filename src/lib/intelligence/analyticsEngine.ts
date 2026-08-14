// Analytics Engine — raw aggregates into metrics.
//
// Pure. No I/O, no Supabase, no React. Give it a snapshot and it tells you what is
// true; it does not decide whether that is good (healthEngine) or what to do about
// it (alertEngine).
//
// ── The job is deciding what is unavailable, not counting ────────────────────
// The counting already happened in SQL. What this file actually does is answer,
// for each metric, one question: *is there a basis for this number?* Four ways
// there might not be, and they must not be confused:
//
//   no connection            nothing to measure
//   no capability            the provider does not offer it
//   nothing stored           we do not persist it yet — our gap, not theirs
//   nothing synced/linked    the plumbing exists but no data came through
//
// Every one of those returns zero from SQL. Reporting that zero as a value is how
// a Dashboard ends up telling a customer they have no negative stock when in truth
// it has never looked.

import {
  available,
  unavailable,
  type ActivityMetrics,
  type AdjustmentMetrics,
  type CatalogMetrics,
  type ConnectionContext,
  type DiscrepancyMetrics,
  type Freshness,
  type FreshnessState,
  type InventoryMetrics,
  type MetricScope,
  type MetricValue,
  type RawConnection,
  type RawSnapshot,
  type SyncMetrics,
  type SyncState,
  type StockMetrics,
  type UnavailableReason,
} from './contracts';

// ─────────────────────────────────────────────────────────────────────────────
// Thresholds
//
// Named and exported so tests pin the same numbers the UI explains, and so a
// change is one edit rather than a hunt through comparisons.
// ─────────────────────────────────────────────────────────────────────────────

/** Fallback staleness window for a connection with no interval configured. A
 *  manual-only integration is not expected to be minutes-fresh, so an hour is the
 *  point at which "recent" stops being true rather than an SLA. */
export const DEFAULT_STALE_AFTER_MS = 60 * 60 * 1000;

/** With an interval configured, stale means we have missed it by this multiple.
 *  Three rather than one because a single missed cycle is normal jitter — a
 *  scheduler that runs every 5 minutes will routinely be 6 minutes late, and
 *  warning about that would train the operator to ignore the warning. */
export const STALE_INTERVAL_MULTIPLIER = 3;

/** Past this, the numbers get shown with an explicit warning rather than
 *  presented as current. */
export const VERY_STALE_AFTER_MS = 6 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// Connection reading
// ─────────────────────────────────────────────────────────────────────────────

export function toConnectionContext(raw: RawConnection): ConnectionContext {
  return {
    id: raw.id,
    providerKey: raw.provider_key,
    displayName: raw.display_name,
    status: raw.status,
    syncDirection: raw.sync_direction,
    autoSyncEnabled: raw.auto_sync_enabled === true,
    syncIntervalMinutes: raw.sync_interval_minutes,
    credentialsSetAt: raw.credentials_set_at,
    lastSyncAt: raw.last_sync_at,
    lastSuccessfulSyncAt: raw.last_successful_sync_at,
    lastError: raw.last_error,
    lastErrorAt: raw.last_error_at,
    capabilities: raw.capabilities ?? {},
  };
}

/** Connections a scope actually covers. A connection filter narrows to one; no
 *  filter means all of them. */
export function connectionsInScope(scope: MetricScope): ConnectionContext[] {
  if (scope.connectionId == null) return scope.connections;
  return scope.connections.filter(c => c.id === scope.connectionId);
}

/** Does ANY connection in scope offer this capability?
 *
 *  Any rather than all, deliberately. In a consolidated view over an ERP that
 *  reports deposits and a marketplace that does not, deposit metrics are still
 *  meaningful — they describe the ERP's share. Requiring all would blank a metric
 *  because of a connection that was never going to contribute to it. */
export function hasCapability(scope: MetricScope, capability: string): boolean {
  return connectionsInScope(scope).some(c => c.capabilities[capability] === true);
}

/** The blocking condition that applies to every metric, or null when the
 *  integration is in a state where measuring makes sense.
 *
 *  Ordered from most to least fundamental, because reporting "dados
 *  insuficientes" to someone who has not connected anything sends them looking for
 *  a data problem they do not have. */
export function scopeBlocker(scope: MetricScope): UnavailableReason | null {
  const connections = connectionsInScope(scope);

  if (connections.length === 0) return 'no_connection';
  if (connections.every(c => c.credentialsSetAt == null)) return 'no_credential';
  if (connections.every(c => c.lastSyncAt == null)) return 'never_synced';

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Freshness
// ─────────────────────────────────────────────────────────────────────────────

export function staleAfterMsFor(connections: readonly ConnectionContext[]): number {
  // The most permissive window in scope. Taking the strictest would mark a
  // consolidated view stale because of one fast-cycling connection, which says
  // nothing useful about the rest.
  const windows = connections.map(c =>
    c.syncIntervalMinutes != null && c.syncIntervalMinutes > 0
      ? c.syncIntervalMinutes * 60 * 1000 * STALE_INTERVAL_MULTIPLIER
      : DEFAULT_STALE_AFTER_MS
  );

  return windows.length === 0 ? DEFAULT_STALE_AFTER_MS : Math.max(...windows);
}

export function assessFreshness(
  observedAt: string | null,
  connections: readonly ConnectionContext[],
  nowMs: number
): Freshness {
  const staleAfterMs = staleAfterMsFor(connections);

  if (observedAt == null) {
    return {
      state: connections.length === 0 ? 'unknown' : 'never_synced',
      observedAt: null,
      ageMs: null,
      staleAfterMs,
    };
  }

  const parsed = Date.parse(observedAt);
  if (Number.isNaN(parsed)) {
    // An unparseable timestamp is 'unknown', never 'fresh'. Treating it as fresh
    // would present data of unknown age as current.
    return { state: 'unknown', observedAt, ageMs: null, staleAfterMs };
  }

  // Clamped at zero: a provider clock running ahead produces a negative age, and a
  // negative age is not "extra fresh" — it is zero with a clock problem.
  const ageMs = Math.max(0, nowMs - parsed);

  const state: FreshnessState =
    ageMs > VERY_STALE_AFTER_MS ? 'very_stale' : ageMs > staleAfterMs ? 'stale' : 'fresh';

  return { state, observedAt, ageMs, staleAfterMs };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sync state
// ─────────────────────────────────────────────────────────────────────────────

/** Collapse run history and connection state into one badge.
 *
 *  Order matters and encodes a judgement: a revoked credential outranks a running
 *  sync, because the sync is going to fail. Showing 'syncing' would have the
 *  operator waiting for a result that cannot arrive. */
export function deriveSyncState(
  raw: RawSnapshot['sync'],
  connections: readonly ConnectionContext[],
  freshness: Freshness
): SyncState {
  if (connections.length === 0) return 'offline';
  if (connections.every(c => c.status === 'revoked' || c.credentialsSetAt == null)) return 'offline';
  if (connections.some(c => c.status === 'error')) return 'error';

  if (raw == null || raw.total_runs === 0) return 'never';
  if (raw.running > 0) return 'syncing';
  if (raw.failed_recent > 0) return 'error';

  // Stale and partial are both 'warning': the integration works but what it
  // produced cannot be fully trusted, which is the same instruction to the
  // operator — look before acting.
  if (raw.partial_recent > 0) return 'warning';
  if (freshness.state === 'stale' || freshness.state === 'very_stale') return 'warning';

  if (raw.succeeded_recent > 0 || raw.last_success_at != null) return 'synced';

  // Runs exist, none succeeded, none failed recently. Not an error we can point
  // at, but not a healthy state either.
  return 'warning';
}

// ─────────────────────────────────────────────────────────────────────────────
// The engine
// ─────────────────────────────────────────────────────────────────────────────

export interface BuildMetricsInput {
  snapshot: RawSnapshot;
  connectionId: string | null;
  nowMs: number;
  /** Whether the customer has configured minimum stock levels. Passed in rather
   *  than read here: this file does no I/O, and the flag comes from a different
   *  subsystem entirely. False keeps `belowMinimum` unavailable, which is the
   *  honest answer — a threshold nobody set cannot be breached. */
  hasMinimumStockConfigured?: boolean;
}

export function buildInventoryMetrics(input: BuildMetricsInput): InventoryMetrics {
  const { snapshot, connectionId, nowMs } = input;

  const connections = (snapshot.connections ?? []).map(toConnectionContext);
  const scope: MetricScope = { connectionId, connections };
  const inScope = connectionsInScope(scope);

  const generatedAt = snapshot.generated_at ?? new Date(nowMs).toISOString();

  // A snapshot with no company context, or a connection filter that resolved to
  // nothing, means every metric is unavailable for the same reason. Short-circuited
  // rather than threaded through each metric so there is one place this is decided.
  if (snapshot.company_scoped === false || snapshot.connection_found === false) {
    return allUnavailable(scope, generatedAt, 'no_connection', nowMs);
  }

  const blocker = scopeBlocker(scope);

  const stockFreshness = assessFreshness(snapshot.stock?.newest_observed_at ?? null, inScope, nowMs);
  const syncFreshness = assessFreshness(
    snapshot.sync?.last_success_at ?? snapshot.sync?.last_run_at ?? null,
    inScope,
    nowMs
  );

  if (blocker != null) {
    return allUnavailable(scope, generatedAt, blocker, nowMs);
  }

  const catalog = snapshot.catalog;
  const stock = snapshot.stock;
  const observedAt = stock?.newest_observed_at ?? null;

  // Linked products is the denominator for every catalogue metric. With none, a
  // "0 sem EAN" would be true and useless — nothing has been linked to check.
  const catalogBasis: UnavailableReason | null =
    catalog == null || catalog.linked_products === 0 ? 'insufficient_data' : null;

  // Likewise for stock: zero stock rows is not "no negative stock", it is "no
  // reading". The distinction is the whole point.
  const stockBasis: UnavailableReason | null =
    stock == null || stock.products_with_stock_rows === 0 ? 'insufficient_data' : null;

  const catalogMetrics: CatalogMetrics = {
    linkedProducts: gated(catalogBasis, () => available(catalog!.linked_products, catalog!.last_linked_at)),
    // Requires product reads to mean anything: a provider that does not expose
    // products cannot be missing an EAN on one.
    withoutEan: gatedByCapability(
      scope,
      'read_products',
      catalogBasis,
      () => available(catalog!.without_ean, catalog!.last_linked_at)
    ),
    withoutSku: gatedByCapability(
      scope,
      'read_products',
      catalogBasis,
      () => available(catalog!.without_sku, catalog!.last_linked_at)
    ),
    autoMatched: gated(catalogBasis, () => available(catalog!.auto_matched, catalog!.last_linked_at)),
  };

  const stockMetrics: StockMetrics = {
    negativeProducts: gatedByCapability(scope, 'read_stock', stockBasis, () =>
      available(stock!.negative_products, observedAt)
    ),
    zeroProducts: gatedByCapability(scope, 'read_stock', stockBasis, () =>
      available(stock!.zero_products, observedAt)
    ),
    positiveProducts: gatedByCapability(scope, 'read_stock', stockBasis, () =>
      available(stock!.positive_products, observedAt)
    ),
    // Needs per-warehouse detail specifically. With only a total, a single negative
    // deposit is not observable, and reporting zero would assert it does not happen.
    negativeWarehouseProducts: gatedByCapability(scope, 'read_stock_by_warehouse', stockBasis, () =>
      available(stock!.products_with_negative_warehouse, observedAt)
    ),
    withoutWarehouse: gatedByCapability(scope, 'read_stock_by_warehouse', stockBasis, () =>
      available(stock!.products_without_warehouse, observedAt)
    ),
    totalUnits: gatedByCapability(scope, 'read_stock', stockBasis, () =>
      available(stock!.total_units, observedAt)
    ),
    reservedUnits: gatedByCapability(scope, 'read_reserved_stock', stockBasis, () =>
      available(stock!.total_reserved, observedAt)
    ),
    // Not stored anywhere yet AND dependent on customer configuration. Reported as
    // not_configured because that is the actionable half — the copy tells them what
    // to set up rather than describing an internal gap they cannot fix.
    belowMinimum: unavailable('not_configured'),
  };

  const discrepancies: DiscrepancyMetrics = {
    open: available(snapshot.discrepancies?.open ?? 0),
    oldestOpenAt: snapshot.discrepancies?.oldest_open_at ?? null,
  };

  const syncMetrics: SyncMetrics = {
    state: deriveSyncState(snapshot.sync, inScope, syncFreshness),
    lastRunAt: snapshot.sync?.last_run_at ?? null,
    lastSuccessAt: snapshot.sync?.last_success_at ?? null,
    lastDurationMs: snapshot.sync?.last_duration_ms ?? null,
    lastRecordsTotal:
      snapshot.sync?.last_records_total == null
        ? unavailable('insufficient_data')
        : available(snapshot.sync.last_records_total),
    failedRecent: available(snapshot.sync?.failed_recent ?? 0),
    partialRecent: available(snapshot.sync?.partial_recent ?? 0),
    inFlight: available((snapshot.sync?.pending ?? 0) + (snapshot.sync?.running ?? 0)),
    freshness: stockFreshness,
  };

  const adjustments: AdjustmentMetrics = {
    pending: available(snapshot.adjustments?.pending ?? 0),
    failed: available(snapshot.adjustments?.failed ?? 0),
    sent: available(snapshot.adjustments?.sent ?? 0),
    awaitingApproval: available(snapshot.adjustments?.awaiting_approval ?? 0),
    oldestPendingAt: snapshot.adjustments?.oldest_pending_at ?? null,
  };

  // Both permanently unavailable today, for two different reasons that must stay
  // distinct. Movements: no provider we support reads them AND we have no table.
  // Orders: Tiny does expose them, but InventoryBlind has nowhere to put them — so
  // that one is our gap, and saying capability_missing would blame the provider for
  // work we owe.
  const activity: ActivityMetrics = {
    movements: hasCapability(scope, 'read_movements')
      ? unavailable('not_stored')
      : unavailable('capability_missing'),
    potentiallyAffectedSales: hasCapability(scope, 'read_orders')
      ? unavailable('not_stored')
      : unavailable('capability_missing'),
  };

  return {
    scope,
    generatedAt,
    catalog: catalogMetrics,
    stock: stockMetrics,
    discrepancies,
    sync: syncMetrics,
    adjustments,
    activity,
    openAlerts: available(snapshot.alerts?.open ?? 0),
    criticalAlerts: available(snapshot.alerts?.critical ?? 0),
  };
}

/** Apply a basis gate: when there is no basis, the reason wins over the value. */
function gated<T>(basis: UnavailableReason | null, produce: () => MetricValue<T>): MetricValue<T> {
  return basis == null ? produce() : unavailable(basis);
}

/** Capability first, then basis.
 *
 *  Order matters: for a provider that does not offer stock at all,
 *  'capability_missing' is the truthful reason and 'insufficient_data' would send
 *  the operator looking for a sync problem instead of telling them the provider
 *  simply does not report it. */
function gatedByCapability<T>(
  scope: MetricScope,
  capability: string,
  basis: UnavailableReason | null,
  produce: () => MetricValue<T>
): MetricValue<T> {
  if (!hasCapability(scope, capability)) return unavailable('capability_missing');
  return gated(basis, produce);
}

/** Every metric unavailable for one shared reason.
 *
 *  Written out in full rather than built by iterating keys, so adding a metric to
 *  the contract is a compile error here until it is handled — the alternative
 *  silently defaults new metrics to available-looking zeros. */
function allUnavailable(
  scope: MetricScope,
  generatedAt: string,
  reason: UnavailableReason,
  nowMs: number
): InventoryMetrics {
  const inScope = connectionsInScope(scope);

  return {
    scope,
    generatedAt,
    catalog: {
      linkedProducts: unavailable(reason),
      withoutEan: unavailable(reason),
      withoutSku: unavailable(reason),
      autoMatched: unavailable(reason),
    },
    stock: {
      negativeProducts: unavailable(reason),
      zeroProducts: unavailable(reason),
      positiveProducts: unavailable(reason),
      negativeWarehouseProducts: unavailable(reason),
      withoutWarehouse: unavailable(reason),
      totalUnits: unavailable(reason),
      reservedUnits: unavailable(reason),
      belowMinimum: unavailable(reason === 'no_connection' ? reason : 'not_configured'),
    },
    discrepancies: { open: unavailable(reason), oldestOpenAt: null },
    sync: {
      state: reason === 'no_connection' || reason === 'no_credential' ? 'offline' : 'never',
      lastRunAt: null,
      lastSuccessAt: null,
      lastDurationMs: null,
      lastRecordsTotal: unavailable(reason),
      failedRecent: unavailable(reason),
      partialRecent: unavailable(reason),
      inFlight: unavailable(reason),
      freshness: assessFreshness(null, inScope, nowMs),
    },
    adjustments: {
      pending: unavailable(reason),
      failed: unavailable(reason),
      sent: unavailable(reason),
      awaitingApproval: unavailable(reason),
      oldestPendingAt: null,
    },
    activity: {
      movements: unavailable(reason),
      potentiallyAffectedSales: unavailable(reason),
    },
    openAlerts: unavailable(reason),
    criticalAlerts: unavailable(reason),
  };
}
