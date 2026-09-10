// Inventory Intelligence — contracts.
//
// The types every layer above the providers speaks. Nothing here mentions Tiny,
// Bling, SAP or any marketplace, and nothing here does I/O. When the first real
// API connects, it fills these shapes and no engine changes.
//
// ── The one idea this file exists for ───────────────────────────────────────
// A metric is never a bare number. It is either a value or a stated reason for
// its absence:
//
//     MetricValue<number> = { state: 'available', value: 5 }
//                         | { state: 'unavailable', reason: 'capability_missing' }
//
// This is not defensive style — it is the mechanism that makes "never lie to the
// user" enforceable instead of aspirational. A component cannot render `0` for a
// metric it does not have, because there is no `0` to reach: it has to narrow the
// union first, and the unavailable branch has no number in it. If the shape were
// `number | null` with a `?? 0` anywhere, the guarantee would be gone the first
// time someone was in a hurry.
//
// ── Layer split ────────────────────────────────────────────────────────────
//   analyticsEngine  raw aggregates → metrics          (what is true)
//   healthEngine     metrics → score + explanation     (how bad is it)
//   alertEngine      metrics → actionable alerts       (what to do)
//   components       present results                  (no arithmetic)

// ─────────────────────────────────────────────────────────────────────────────
// Availability
// ─────────────────────────────────────────────────────────────────────────────

/** Why a metric has no value. Each one produces different copy and a different
 *  call to action, which is why they are distinct rather than one 'no_data'. */
export type UnavailableReason =
  /** No integration exists at all. The onboarding state. */
  | 'no_connection'
  /** A connection exists but has never authenticated. */
  | 'no_credential'
  /** The provider does not offer this data. Not a defect — a fact about the
   *  provider, and the UI should hide rather than nag. */
  | 'capability_missing'
  /** The provider offers it and InventoryBlind does not persist it yet. Distinct
   *  from capability_missing on purpose: this one is our gap, not theirs, and
   *  conflating them would hide work we owe. */
  | 'not_stored'
  /** Connected and credentialed, but no sync has landed. */
  | 'never_synced'
  /** Synced, but nothing to compute from (no linked products, no stock rows). */
  | 'insufficient_data'
  /** Depends on customer configuration that does not exist yet — a minimum stock
   *  level, a deposit mapping. Actionable by the customer, so it gets copy that
   *  says what to configure. */
  | 'not_configured'
  /** The query failed. */
  | 'error';

export const UNAVAILABLE_COPY: Record<UnavailableReason, string> = {
  no_connection: 'Conecte seu ERP para visualizar este indicador.',
  no_credential: 'Configure a credencial da integração para visualizar este indicador.',
  capability_missing: 'Este provedor não fornece os dados necessários para este indicador.',
  not_stored: 'Este indicador ainda não está disponível para esta integração.',
  never_synced: 'Execute a primeira sincronização para visualizar este indicador.',
  insufficient_data: 'Dados insuficientes para calcular este indicador.',
  not_configured: 'Configure os parâmetros necessários para habilitar este indicador.',
  error: 'Não foi possível atualizar os dados.',
};

export type MetricValue<T> =
  | {
      state: 'available';
      value: T;
      /** When the underlying data was observed at the provider. Null when the
       *  metric is derived from our own records rather than a provider reading. */
      observedAt?: string | null;
    }
  | { state: 'unavailable'; reason: UnavailableReason };

export function available<T>(value: T, observedAt?: string | null): MetricValue<T> {
  return { state: 'available', value, observedAt: observedAt ?? null };
}

export function unavailable<T>(reason: UnavailableReason): MetricValue<T> {
  return { state: 'unavailable', reason };
}

export function isAvailable<T>(
  metric: MetricValue<T>
): metric is { state: 'available'; value: T; observedAt?: string | null } {
  return metric.state === 'available';
}

/** The value, or a fallback — for arithmetic only.
 *
 *  Deliberately NOT for display. Rendering a fallback is the exact failure this
 *  module prevents; use `isAvailable` in components and let the unavailable
 *  branch render its copy. */
export function valueOr<T>(metric: MetricValue<T>, fallback: T): T {
  return metric.state === 'available' ? metric.value : fallback;
}

// ─────────────────────────────────────────────────────────────────────────────
// Freshness
// ─────────────────────────────────────────────────────────────────────────────

/** How current the data is. Separate from the metrics themselves because one
 *  reading's age applies to every number derived from it — attaching it per
 *  metric would invite them to disagree. */
export type FreshnessState =
  | 'fresh'
  /** Older than the connection's own interval allows, but still usable. */
  | 'stale'
  /** So old that showing the numbers without a warning would be misleading. */
  | 'very_stale'
  | 'never_synced'
  | 'unknown';

export interface Freshness {
  state: FreshnessState;
  observedAt: string | null;
  ageMs: number | null;
  /** The threshold that produced this verdict, so the UI can say *why* something
   *  counts as stale instead of asserting it. */
  staleAfterMs: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Connection context
// ─────────────────────────────────────────────────────────────────────────────

/** What the intelligence layer needs to know about a connection. A projection of
 *  integration_connections plus its provider's capabilities — not the row itself,
 *  because the engines must not be able to reach a credential field even by
 *  accident. */
export interface ConnectionContext {
  id: string;
  providerKey: string;
  displayName: string;
  status: string;
  syncDirection: string;
  autoSyncEnabled: boolean;
  syncIntervalMinutes: number | null;
  credentialsSetAt: string | null;
  lastSyncAt: string | null;
  lastSuccessfulSyncAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  /** Straight from integration_providers. This is what lets the Dashboard hide a
   *  metric a provider cannot supply without ever asking which provider it is. */
  capabilities: Record<string, boolean>;
}

/** Which connections a set of metrics covers. `null` connectionId means every
 *  connection in the company — the consolidated view. */
export interface MetricScope {
  connectionId: string | null;
  connections: ConnectionContext[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Raw aggregates — the wire shape of integration_intelligence_snapshot
//
// snake_case because that is what the RPC returns. Renaming on arrival would add
// a mapping layer whose only job is to be a place for typos.
// ─────────────────────────────────────────────────────────────────────────────

export interface RawSnapshot {
  company_scoped: boolean;
  connection_found?: boolean;
  generated_at?: string;
  connections?: RawConnection[];
  catalog?: RawCatalog;
  stock?: RawStock;
  warehouses?: { named_count: number };
  discrepancies?: RawDiscrepancies;
  sync?: RawSync;
  adjustments?: RawAdjustments;
  alerts?: RawAlerts;
}

export interface RawConnection {
  id: string;
  provider_key: string;
  display_name: string;
  status: string;
  sync_direction: string;
  auto_sync_enabled: boolean;
  sync_interval_minutes: number | null;
  credentials_set_at: string | null;
  last_sync_at: string | null;
  last_successful_sync_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  capabilities: Record<string, boolean> | null;
}

export interface RawCatalog {
  linked_products: number;
  without_ean: number;
  without_sku: number;
  auto_matched: number;
  last_linked_at: string | null;
}

export interface RawStock {
  products_with_stock_rows: number;
  negative_products: number;
  zero_products: number;
  positive_products: number;
  products_with_negative_warehouse: number;
  products_without_warehouse: number;
  total_units: number;
  total_reserved: number;
  oldest_observed_at: string | null;
  newest_observed_at: string | null;
}

export interface RawDiscrepancies {
  open: number;
  resolved: number;
  oldest_open_at: string | null;
  newest_open_at: string | null;
}

export interface RawSync {
  total_runs: number;
  pending: number;
  running: number;
  failed_recent: number;
  partial_recent: number;
  succeeded_recent: number;
  last_run_at: string | null;
  last_success_at: string | null;
  last_duration_ms: number | null;
  last_records_total: number | null;
}

export interface RawAdjustments {
  pending: number;
  sent: number;
  confirmed: number;
  failed: number;
  awaiting_approval: number;
  oldest_pending_at: string | null;
}

export interface RawAlerts {
  open: number;
  critical: number;
  warning: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Metrics — what the Analytics Engine produces
// ─────────────────────────────────────────────────────────────────────────────

export interface CatalogMetrics {
  /** Products linked to a provider record. The honest denominator for everything
   *  else: a catalogue metric over unlinked products would describe nothing. */
  linkedProducts: MetricValue<number>;
  withoutEan: MetricValue<number>;
  withoutSku: MetricValue<number>;
  /** Links created by an automatic rule and never confirmed. Not an error, but
   *  the likeliest origin of a balance written against the wrong product. */
  autoMatched: MetricValue<number>;
}

export interface StockMetrics {
  /** Products whose summed balance across every deposit is below zero. */
  negativeProducts: MetricValue<number>;
  /** Balance exactly zero. Kept apart from negative on purpose — one is a
   *  stock-out, the other is a bookkeeping error, and merging them produces a
   *  number that answers neither question. */
  zeroProducts: MetricValue<number>;
  positiveProducts: MetricValue<number>;
  /** Total is fine but at least one deposit is negative. Invisible to any view
   *  that only looks at totals, and always a posting error. */
  negativeWarehouseProducts: MetricValue<number>;
  withoutWarehouse: MetricValue<number>;
  totalUnits: MetricValue<number>;
  reservedUnits: MetricValue<number>;
  /** Below the customer's configured minimum. Unavailable until a minimum exists
   *  — inventing a threshold would produce alarm about a rule nobody set. */
  belowMinimum: MetricValue<number>;
}

export interface DiscrepancyMetrics {
  open: MetricValue<number>;
  oldestOpenAt: string | null;
}

export type SyncState = 'synced' | 'syncing' | 'warning' | 'error' | 'offline' | 'never';

export interface SyncMetrics {
  state: SyncState;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastDurationMs: number | null;
  lastRecordsTotal: MetricValue<number>;
  failedRecent: MetricValue<number>;
  partialRecent: MetricValue<number>;
  inFlight: MetricValue<number>;
  freshness: Freshness;
}

export interface AdjustmentMetrics {
  pending: MetricValue<number>;
  failed: MetricValue<number>;
  sent: MetricValue<number>;
  awaitingApproval: MetricValue<number>;
  oldestPendingAt: string | null;
}

/** Metrics that need entities InventoryBlind does not persist yet.
 *
 *  They exist in the contract rather than being omitted so the gap is visible and
 *  typed: when a movements or orders table lands, these stop being permanently
 *  `not_stored` and nothing else has to change. Omitting them would make the
 *  missing capability invisible in code review. */
export interface ActivityMetrics {
  movements: MetricValue<number>;
  /** Sales that MIGHT have been affected by unavailability. The wording is load
   *  bearing: without order data proving causality, "cancelled for lack of stock"
   *  would be a claim the data cannot support. */
  potentiallyAffectedSales: MetricValue<number>;
}

export interface InventoryMetrics {
  scope: MetricScope;
  generatedAt: string;
  catalog: CatalogMetrics;
  stock: StockMetrics;
  discrepancies: DiscrepancyMetrics;
  sync: SyncMetrics;
  adjustments: AdjustmentMetrics;
  activity: ActivityMetrics;
  openAlerts: MetricValue<number>;
  criticalAlerts: MetricValue<number>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Health — what the Health Engine produces
// ─────────────────────────────────────────────────────────────────────────────

export type HealthStatus = 'excellent' | 'healthy' | 'warning' | 'critical' | 'unknown';

export const HEALTH_STATUS_LABEL: Record<HealthStatus, string> = {
  excellent: 'Excelente',
  healthy: 'Saudável',
  warning: 'Requer atenção',
  critical: 'Crítico',
  unknown: 'Indisponível',
};

/** One deduction, with everything needed to explain itself.
 *
 *  `points` is what came off the score and `detail` says which observation caused
 *  it. Both derive from the same computation the score does, so an explanation can
 *  never disagree with the number it explains — the failure mode of every
 *  hand-written "principais impactos" list. */
export interface HealthDeduction {
  factor: HealthFactorKey;
  label: string;
  points: number;
  detail: string;
  /** Where clicking should take the operator. */
  drillTo: DrillTarget | null;
}

export type HealthFactorKey =
  | 'negative_stock'
  | 'negative_warehouse'
  | 'discrepancies'
  | 'sync_failures'
  | 'stale_data'
  | 'missing_ean'
  | 'missing_warehouse'
  | 'failed_adjustments';

export interface HealthScore {
  status: HealthStatus;
  /** 0–100, or null when nothing could be evaluated. Null rather than 0: a score
   *  of zero means "everything is broken", and an unmeasured integration is not
   *  the same as a broken one. */
  score: number | null;
  deductions: HealthDeduction[];
  /** Which factors were evaluated, and which could not be. A score built from two
   *  of eight factors is not as trustworthy as one built from eight, and hiding
   *  that would make an incomplete score look authoritative. */
  evaluatedFactors: HealthFactorKey[];
  skippedFactors: { factor: HealthFactorKey; reason: UnavailableReason }[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Alerts — what the Alert Engine produces
// ─────────────────────────────────────────────────────────────────────────────

export type AlertSeverity = 'critical' | 'warning' | 'info';

/** Where a card or alert leads. A closed set rather than free-form strings so a
 *  typo is a compile error instead of a dead click. */
export type DrillTarget =
  | 'negative_stock'
  | 'discrepancies'
  | 'sync_log'
  | 'adjustment_queue'
  | 'missing_ean'
  | 'missing_warehouse'
  | 'integration_settings'
  | 'minimum_stock_settings';

export interface InventoryAlert {
  id: string;
  severity: AlertSeverity;
  /** Concrete and countable. "5 SKUs com saldo negativo", never "seu estoque
   *  parece precisar de atenção". */
  title: string;
  /** What it means and why it matters. */
  detail: string;
  /** What to do about it. */
  action: string;
  drillTo: DrillTarget | null;
  /** The count behind the alert, for sorting and for the badge. */
  count: number | null;
}
