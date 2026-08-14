// Observability — persistent rate limit state and alert detection.
//
// Pure module: the clock and all inputs are passed in.
//
// Rate limit state has to survive between invocations. An Edge Function is
// stateless, so whatever the provider told us about our remaining budget is
// forgotten on every cold start — and the next run walks into the same 429 it just
// earned. Persisting it in integration_rate_limit_state turns that into a decision
// the next invocation can make before spending a request.

import type { RateLimitInfo } from '../result.ts';

export interface RateLimitRow {
  connectionId: string;
  operation: string;
  remaining: number | null;
  limitValue: number | null;
  resetAt: string | null;
  retryAfterUntil: string | null;
  observedAt: string;
}

export type GateDecision =
  | { proceed: true }
  /** Do not call the provider yet. `waitMs` is how long until it is worth trying. */
  | { proceed: false; reason: 'retry_after' | 'budget_exhausted'; waitMs: number };

/** Threshold at which we stop spending requests.
 *
 *  Not zero: a run that uses its last request leaves nothing for the retry it may
 *  need, and a 429 costs more than the request it saved. Keeping a small reserve
 *  means a transient failure can still be retried inside the same window. */
export const RATE_LIMIT_RESERVE = 3;

/** Should we call the provider right now?
 *
 *  A stale observation is ignored rather than obeyed: if the window has already
 *  reset, the remaining count we recorded is meaningless, and refusing to call
 *  because of a number from an expired window would stall the integration for no
 *  reason. */
export function checkRateLimitGate(
  row: RateLimitRow | null,
  nowMs: number
): GateDecision {
  if (row == null) return { proceed: true };

  // An explicit back-off instruction outranks everything else.
  if (row.retryAfterUntil != null) {
    const until = Date.parse(row.retryAfterUntil);
    if (!Number.isNaN(until) && until > nowMs) {
      return { proceed: false, reason: 'retry_after', waitMs: until - nowMs };
    }
  }

  const resetMs = row.resetAt != null ? Date.parse(row.resetAt) : Number.NaN;
  const windowHasReset = !Number.isNaN(resetMs) && resetMs <= nowMs;

  // Window expired: whatever remaining we recorded no longer applies.
  if (windowHasReset) return { proceed: true };

  if (row.remaining != null && row.remaining <= RATE_LIMIT_RESERVE) {
    // Hold until the window turns over. With no reset time we cannot know how long,
    // so proceeding is the lesser evil: a 429 is recoverable, an integration frozen
    // forever on a stale count is not.
    if (Number.isNaN(resetMs)) return { proceed: true };
    return { proceed: false, reason: 'budget_exhausted', waitMs: Math.max(0, resetMs - nowMs) };
  }

  return { proceed: true };
}

/** Merge what a provider just reported into the stored row.
 *
 *  `remaining` is taken from the newer observation even when it is higher: a window
 *  reset legitimately raises it, and keeping the minimum would leave the connection
 *  permanently throttled by its worst moment. */
export function mergeRateLimit(
  previous: RateLimitRow | null,
  observed: RateLimitInfo | null | undefined,
  params: { connectionId: string; operation: string; nowMs: number }
): RateLimitRow {
  const nowIso = new Date(params.nowMs).toISOString();

  if (observed == null) {
    return (
      previous ?? {
        connectionId: params.connectionId,
        operation: params.operation,
        remaining: null,
        limitValue: null,
        resetAt: null,
        retryAfterUntil: null,
        observedAt: nowIso,
      }
    );
  }

  const retryAfterUntil =
    observed.retryAfterMs != null && observed.retryAfterMs > 0
      ? new Date(params.nowMs + observed.retryAfterMs).toISOString()
      : previous?.retryAfterUntil ?? null;

  return {
    connectionId: params.connectionId,
    operation: params.operation,
    remaining: observed.remaining ?? previous?.remaining ?? null,
    limitValue: observed.limit ?? previous?.limitValue ?? null,
    resetAt: observed.resetAt != null ? new Date(observed.resetAt).toISOString() : previous?.resetAt ?? null,
    retryAfterUntil,
    observedAt: nowIso,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Alert detection
//
// Every rule reads data the system already records. Detection is deliberately
// pure and separate from raising: the thresholds are the judgement worth testing,
// and writing the row is trivial.
// ─────────────────────────────────────────────────────────────────────────────

export type AlertKind =
  | 'integration_offline'
  | 'credential_expired'
  | 'sync_failing'
  | 'rate_limited'
  | 'webhook_broken'
  | 'pending_conflicts'
  | 'unmapped_deposits'
  | 'stale_sync';

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface DetectedAlert {
  kind: AlertKind;
  severity: AlertSeverity;
  message: string;
  context: Record<string, unknown>;
}

/** Thresholds, in one place so they can be reviewed together. */
export const ALERT_THRESHOLDS = {
  /** Consecutive failed runs before the integration is called broken. Three, not
   *  one: providers have brief outages, and alerting on the first failure trains
   *  people to ignore alerts. */
  consecutiveFailures: 3,
  /** Consecutive failures that make it critical rather than a warning. */
  criticalConsecutiveFailures: 6,
  /** Auto-sync on but nothing succeeded for this long — the integration is quietly
   *  dead, which is worse than one that fails loudly. */
  staleSyncMultiplier: 4,
  /** Open conflicts nobody is working. Stock disagreements do not resolve
   *  themselves and each one is a SKU that may be wrong on a marketplace. */
  pendingConflicts: 20,
  /** Webhook deliveries received but never processed. */
  unprocessedWebhooks: 5,
} as const;

export interface AlertInput {
  connectionId: string;
  status: string;
  autoSyncEnabled: boolean;
  syncIntervalMinutes: number | null;
  lastSuccessfulSyncAt: string | null;
  credentialExpiresAt: string | null;
  consecutiveFailures: number;
  lastErrorKind: string | null;
  pendingConflicts: number;
  unprocessedWebhooks: number;
  unmappedDeposits: string[];
  rateLimit: RateLimitRow | null;
  nowMs: number;
}

/** All conditions currently true for one connection.
 *
 *  Returns every match rather than the first: an integration can be rate-limited AND
 *  have a review queue, and hiding one behind the other means the second is found
 *  later than it should be. */
export function detectAlerts(input: AlertInput): DetectedAlert[] {
  const alerts: DetectedAlert[] = [];

  if (input.credentialExpiresAt != null) {
    const expiresMs = Date.parse(input.credentialExpiresAt);
    if (!Number.isNaN(expiresMs) && expiresMs <= input.nowMs) {
      alerts.push({
        kind: 'credential_expired',
        severity: 'critical',
        message: 'A credencial desta integração expirou. Reconecte para retomar a sincronização.',
        context: { expiredAt: input.credentialExpiresAt },
      });
    }
  }

  if (input.consecutiveFailures >= ALERT_THRESHOLDS.consecutiveFailures) {
    const critical = input.consecutiveFailures >= ALERT_THRESHOLDS.criticalConsecutiveFailures;
    alerts.push({
      kind: 'sync_failing',
      severity: critical ? 'critical' : 'warning',
      message: `${input.consecutiveFailures} sincronizações consecutivas falharam.`,
      context: { consecutiveFailures: input.consecutiveFailures, lastErrorKind: input.lastErrorKind },
    });
  }

  // Distinct from sync_failing: the connection itself is refusing, which is a
  // credential or permission problem rather than a data one.
  if (input.status === 'error') {
    alerts.push({
      kind: 'integration_offline',
      severity: 'critical',
      message: 'A integração está com erro e não está sincronizando.',
      context: { status: input.status, lastErrorKind: input.lastErrorKind },
    });
  }

  const gate = checkRateLimitGate(input.rateLimit, input.nowMs);
  if (!gate.proceed) {
    alerts.push({
      kind: 'rate_limited',
      severity: 'warning',
      message: 'A integração está aguardando a liberação do limite de requisições do provedor.',
      context: { reason: gate.reason, waitMs: gate.waitMs },
    });
  }

  // A quietly dead integration. Only meaningful when auto-sync is on: a manual
  // connection not syncing is a choice, not a fault.
  if (input.autoSyncEnabled && input.syncIntervalMinutes != null) {
    const toleranceMs =
      input.syncIntervalMinutes * 60 * 1000 * ALERT_THRESHOLDS.staleSyncMultiplier;
    const lastMs =
      input.lastSuccessfulSyncAt != null ? Date.parse(input.lastSuccessfulSyncAt) : Number.NaN;

    const neverSynced = Number.isNaN(lastMs);
    if (neverSynced || input.nowMs - lastMs > toleranceMs) {
      alerts.push({
        kind: 'stale_sync',
        severity: 'warning',
        message: neverSynced
          ? 'A sincronização automática está ligada, mas nenhuma execução foi concluída com sucesso ainda.'
          : 'A sincronização automática está ligada, mas nada foi concluído há muito mais tempo que o intervalo configurado.',
        context: {
          lastSuccessfulSyncAt: input.lastSuccessfulSyncAt,
          intervalMinutes: input.syncIntervalMinutes,
        },
      });
    }
  }

  if (input.unprocessedWebhooks >= ALERT_THRESHOLDS.unprocessedWebhooks) {
    alerts.push({
      kind: 'webhook_broken',
      severity: 'warning',
      message: `${input.unprocessedWebhooks} webhooks foram recebidos e não processados.`,
      context: { unprocessed: input.unprocessedWebhooks },
    });
  }

  if (input.pendingConflicts >= ALERT_THRESHOLDS.pendingConflicts) {
    alerts.push({
      kind: 'pending_conflicts',
      severity: 'warning',
      message: `${input.pendingConflicts} divergências de saldo aguardam revisão.`,
      context: { pendingConflicts: input.pendingConflicts },
    });
  }

  if (input.unmappedDeposits.length > 0) {
    alerts.push({
      kind: 'unmapped_deposits',
      severity: 'warning',
      message: `${input.unmappedDeposits.length} depósito(s) do ERP ainda não foram classificados e estão fora dos totais.`,
      // Deposit names are the customer's own labels, not sensitive, and naming them
      // is what makes the alert actionable.
      context: { deposits: input.unmappedDeposits.slice(0, 20) },
    });
  }

  return alerts;
}

/** Alert kinds no longer detected, which should be resolved.
 *
 *  Auto-resolving matters: an alert that stays open after the problem is fixed
 *  teaches people that alerts are noise. */
export function alertsToResolve(previouslyOpen: AlertKind[], detected: DetectedAlert[]): AlertKind[] {
  const active = new Set(detected.map(alert => alert.kind));
  return previouslyOpen.filter(kind => !active.has(kind));
}
