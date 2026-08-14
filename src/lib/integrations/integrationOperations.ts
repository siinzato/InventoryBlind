// Integration layer — server-side operations, from the client's side.
//
// integrationService.ts is CRUD over the integration tables. This file is the
// other half: the things the browser CANNOT do itself and must ask a server to do.
//
// Every function here is an Edge Function invocation, and the reason is always the
// same — the operation needs the provider credential, and the credential is not
// reachable from the browser by construction (integration_credentials has no
// policy for `authenticated` and its grants are revoked). A client that could do
// any of this directly would be a client that holds a token.
//
// The two read helpers at the bottom (adjustment queue, alerts) are plain queries
// under RLS. They live here rather than in integrationService because they are
// what the operator looks at *around* these operations.

import { supabase } from '../supabase';

// ─────────────────────────────────────────────────────────────────────────────
// Error reading
// ─────────────────────────────────────────────────────────────────────────────

/** Pull our own message out of a FunctionsHttpError.
 *
 *  Without this the customer sees the SDK's generic "Edge Function returned a
 *  non-2xx status code", which hides the specific, actionable message the function
 *  actually returned — the read-only refusal, the expired credential, the rate
 *  limit. Those messages exist to be read; this is what lets them be. */
async function readFunctionError(error: unknown, fallback: string): Promise<string> {
  const context = (error as { context?: unknown }).context;

  if (context instanceof Response) {
    try {
      // Cloned so the caller could still read the body — cheap insurance against
      // a consumed-stream bug if this is ever called twice.
      const body = await context.clone().json();
      if (typeof body?.error === 'string') return body.error;
    } catch {
      // Not JSON. The fallback is still better than throwing from an error handler.
    }
  }

  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && message.length > 0 && !message.includes('non-2xx')
    ? message
    : fallback;
}

// ─────────────────────────────────────────────────────────────────────────────
// Connection test
// ─────────────────────────────────────────────────────────────────────────────

export interface ConnectionTestOutcome {
  ok: boolean;
  message: string;
}

/** Validate the stored credential against the provider.
 *
 *  The cheapest useful call, and the first thing to run after pasting a token. The
 *  function updates the connection's status itself, so callers should refetch the
 *  connection afterwards rather than assuming. */
export async function testConnection(connectionId: string): Promise<ConnectionTestOutcome> {
  const { data, error } = await supabase.functions.invoke('integration-sync', {
    body: { connectionId, testOnly: true },
  });

  if (error) return { ok: false, message: await readFunctionError(error, 'Falha ao testar a conexão.') };

  return {
    ok: data?.ok === true,
    message: typeof data?.message === 'string' ? data.message : 'Sem resposta do provedor.',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Inbound sync — reading stock from the provider
// ─────────────────────────────────────────────────────────────────────────────

export interface SyncOutcome {
  ok: boolean;
  message: string;
  status?: string;
  updates?: number;
  conflicts?: number;
  skipped?: number;
  dryRun: boolean;
}

/** Pull stock from the provider.
 *
 *  `dryRun` runs the entire cycle — read, map, conflict policy, guard — and reports
 *  what WOULD change without writing anything. It is the safe first move on a new
 *  connection, which is why it is an explicit argument rather than a hidden flag. */
export async function runInboundSync(
  connectionId: string,
  options: { syncType?: 'manual' | 'full' | 'incremental'; dryRun?: boolean } = {}
): Promise<SyncOutcome> {
  const dryRun = options.dryRun === true;

  const { data, error } = await supabase.functions.invoke('integration-sync', {
    body: {
      connectionId,
      direction: 'inbound',
      syncType: options.syncType ?? 'manual',
      dryRun,
    },
  });

  if (error) {
    return { ok: false, dryRun, message: await readFunctionError(error, 'Falha ao sincronizar.') };
  }

  return {
    ok: data?.ok !== false,
    dryRun: data?.dryRun === true,
    status: typeof data?.status === 'string' ? data.status : undefined,
    message: typeof data?.message === 'string' ? data.message : 'Sincronização concluída.',
    updates: numberOrUndefined(data?.updates ?? data?.preview?.updates?.length ?? data?.inbound),
    conflicts: numberOrUndefined(data?.conflicts ?? data?.preview?.conflicts?.length),
    skipped: numberOrUndefined(data?.skipped),
  };
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Outbound — sending approved adjustments to the provider
// ─────────────────────────────────────────────────────────────────────────────

export interface StockWriteItem {
  adjustmentId: string;
  status: 'sent' | 'refused' | 'failed';
  code: string | null;
  message: string | null;
  /** Whether an operator may force this refusal through. Structural refusals — a
   *  multi-deposit absolute write, a transfer larger than its source — are never
   *  overridable, and the UI must not offer a button that cannot work. */
  overridable: boolean;
  externalReference: string | null;
}

export interface StockWriteOutcome {
  ok: boolean;
  message?: string;
  dryRun: boolean;
  sent: number;
  refused: number;
  failed: number;
  /** Same product as another adjustment in the batch. Not an error — the next run
   *  picks it up against a freshly read balance. */
  deferred: number;
  /** The run's time budget ended before these were started. Nothing was sent. */
  notStarted: number;
  items: StockWriteItem[];
}

const EMPTY_WRITE = { sent: 0, refused: 0, failed: 0, deferred: 0, notStarted: 0, items: [] as StockWriteItem[] };

/** Send approved adjustments to the provider.
 *
 *  Always worth running with `dryRun: true` first: it re-reads the real balances
 *  and runs the guard, then reports the verdict per adjustment without sending
 *  anything. That is the only way to see a refusal before it matters.
 *
 *  `overrides` is scoped per adjustment AND per rejection code. A blanket "ignore
 *  the guard" switch would outlive the situation that justified it. */
export async function runStockWrite(
  connectionId: string,
  options: {
    adjustmentIds?: string[];
    dryRun?: boolean;
    overrides?: { adjustmentId: string; codes: string[] }[];
  } = {}
): Promise<StockWriteOutcome> {
  const dryRun = options.dryRun === true;

  const { data, error } = await supabase.functions.invoke('integration-stock-write', {
    body: {
      connectionId,
      adjustmentIds: options.adjustmentIds,
      dryRun,
      overrides: options.overrides,
    },
  });

  if (error) {
    return {
      ok: false,
      dryRun,
      message: await readFunctionError(error, 'Falha ao enviar lançamentos ao provedor.'),
      ...EMPTY_WRITE,
    };
  }

  return {
    ok: data?.ok === true,
    dryRun: data?.dryRun === true,
    message: typeof data?.message === 'string' ? data.message : undefined,
    sent: Number(data?.sent ?? 0),
    refused: Number(data?.refused ?? 0),
    failed: Number(data?.failed ?? 0),
    deferred: Number(data?.deferred ?? 0),
    notStarted: Number(data?.notStarted ?? 0),
    items: Array.isArray(data?.items) ? (data.items as StockWriteItem[]) : [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The adjustment queue
// ─────────────────────────────────────────────────────────────────────────────

export type AdjustmentSyncStatus = 'pending' | 'sent' | 'confirmed' | 'failed' | 'skipped';
export type AdjustmentWriteKind = 'absolute' | 'delta' | 'transfer' | 'movement';

export interface QueuedAdjustment {
  id: string;
  sku: string | null;
  externalProductId: string | null;
  warehouse: string | null;
  targetWarehouse: string | null;
  previousQuantity: number;
  countedQuantity: number;
  deltaQuantity: number;
  writeKind: AdjustmentWriteKind;
  movementReason: string | null;
  origin: string;
  syncStatus: AdjustmentSyncStatus;
  attempts: number;
  approvedAt: string | null;
  errorKind: string | null;
  errorMessage: string | null;
  externalReference: string | null;
}

const ADJUSTMENT_COLUMNS =
  'id, sku, external_product_id, external_warehouse_id, target_warehouse_id, previous_quantity, ' +
  'counted_quantity, delta_quantity, write_kind, movement_reason, origin, sync_status, attempts, ' +
  'approved_at, error_kind, error_message, external_reference';

export async function listAdjustments(
  connectionId: string,
  options: { statuses?: AdjustmentSyncStatus[]; limit?: number } = {}
): Promise<QueuedAdjustment[]> {
  let query = supabase
    .from('integration_stock_adjustments')
    .select(ADJUSTMENT_COLUMNS)
    .eq('connection_id', connectionId)
    // Oldest approval first: that is the order the operator intended and the order
    // the writer sends in, so the list reads the same way the queue drains.
    .order('approved_at', { ascending: true, nullsFirst: false })
    .limit(options.limit ?? 100);

  if (options.statuses?.length) query = query.in('sync_status', options.statuses);

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map(toQueuedAdjustment);
}

function toQueuedAdjustment(row: unknown): QueuedAdjustment {
  const r = row as Record<string, unknown>;
  return {
    id: r.id as string,
    sku: (r.sku as string | null) ?? null,
    externalProductId: (r.external_product_id as string | null) ?? null,
    warehouse: (r.external_warehouse_id as string | null) ?? null,
    targetWarehouse: (r.target_warehouse_id as string | null) ?? null,
    previousQuantity: Number(r.previous_quantity ?? 0),
    countedQuantity: Number(r.counted_quantity ?? 0),
    deltaQuantity: Number(r.delta_quantity ?? 0),
    writeKind: r.write_kind as AdjustmentWriteKind,
    movementReason: (r.movement_reason as string | null) ?? null,
    origin: r.origin as string,
    syncStatus: r.sync_status as AdjustmentSyncStatus,
    attempts: Number(r.attempts ?? 0),
    approvedAt: (r.approved_at as string | null) ?? null,
    errorKind: (r.error_kind as string | null) ?? null,
    errorMessage: (r.error_message as string | null) ?? null,
    externalReference: (r.external_reference as string | null) ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Alerts
//
// Surfaced in-app rather than e-mailed. Sending mail needs an external provider
// key this project does not hold, and an alert nobody can see is worse than one
// that lives where the operator already works. integration_alerts is the durable
// record either way, so wiring e-mail or Slack later reads these same rows.
// ─────────────────────────────────────────────────────────────────────────────

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface IntegrationAlert {
  id: string;
  connectionId: string | null;
  kind: string;
  severity: AlertSeverity;
  message: string;
  context: Record<string, unknown>;
  status: 'open' | 'acknowledged' | 'resolved';
  firstSeenAt: string;
  lastSeenAt: string;
  /** How many times this alert fired before being resolved. The raise RPC
   *  increments rather than inserting a duplicate, so a flapping provider produces
   *  one row with a high count instead of a hundred rows. */
  occurrences: number;
}

export async function listAlerts(
  options: { connectionId?: string; includeResolved?: boolean; limit?: number } = {}
): Promise<IntegrationAlert[]> {
  let query = supabase
    .from('integration_alerts')
    .select(
      'id, connection_id, kind, severity, message, context, status, first_seen_at, last_seen_at, occurrences'
    )
    .order('last_seen_at', { ascending: false })
    .limit(options.limit ?? 50);

  if (options.connectionId) query = query.eq('connection_id', options.connectionId);
  if (options.includeResolved !== true) query = query.in('status', ['open', 'acknowledged']);

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map(row => {
    const r = row as Record<string, unknown>;
    return {
      id: r.id as string,
      connectionId: (r.connection_id as string | null) ?? null,
      kind: r.kind as string,
      severity: r.severity as AlertSeverity,
      message: r.message as string,
      context: (r.context as Record<string, unknown> | null) ?? {},
      status: r.status as IntegrationAlert['status'],
      firstSeenAt: r.first_seen_at as string,
      lastSeenAt: r.last_seen_at as string,
      occurrences: Number(r.occurrences ?? 1),
    };
  });
}

/** Resolve an alert through the RPC rather than a direct UPDATE.
 *
 *  Keyed by (connection, kind) rather than by row id, matching how the raise RPC
 *  works: one open row per connection per kind, incremented on each occurrence. So
 *  resolving is "this condition is handled", not "hide this row" — and if the
 *  condition recurs, a new occurrence reopens it instead of silently appending to
 *  something already marked resolved.
 *
 *  The RPC is SECURITY DEFINER and records who resolved it. A direct update would
 *  pass RLS but skip that, and an alert history with no author is not an audit
 *  trail. */
export async function resolveAlert(alert: Pick<IntegrationAlert, 'connectionId' | 'kind'>): Promise<void> {
  const { error } = await supabase.rpc('integration_resolve_alert', {
    p_connection_id: alert.connectionId,
    p_kind: alert.kind,
  });
  if (error) throw error;
}
