// Integration Stock Write — Edge Function.
//
// The ONLY path that changes a balance inside the customer's ERP. It exists
// because integration-sync refuses outbound writes: an unguarded push from there
// would bypass stockWriteGuard, and the guard is the one thing standing between a
// mistake and a warehouse full of cancelled orders.
//
// ── The contract with the operator ───────────────────────────────────────────
// Nothing is invented here. This function sends only what somebody already
// approved, stored as a row in integration_stock_adjustments with approved_at set.
// It reads those rows, re-reads the provider's real balance, asks the guard, and
// sends what survives. Everything it refuses is recorded with a reason.
//
// ── Bias ────────────────────────────────────────────────────────────────────
// Every unclear case refuses. An adjustment that does not go out today is a
// nuisance; an adjustment that goes out wrong is cancelled orders. Those are not
// symmetric, and the code is not symmetric either.
//
// ── One product per run ─────────────────────────────────────────────────────
// Two approved adjustments on the same product are never sent in the same pass.
// The second one's assumed balance predates the first one's effect, so guarding it
// against the balance read at the start of the run would compound both changes.
// The extras are deferred, not dropped. See selectOneAdjustmentPerProduct.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { TinyConnector } from '../_shared/tinyConnector.ts';
import {
  authorizeCaller,
  authorizeConnection,
  authorizeCredential,
} from '../../../src/lib/integrations/authorization.ts';
import {
  decideOutboundWrite,
  selectOneAdjustmentPerProduct,
  summarizeProviderStock,
  type ApprovedAdjustment,
  type OutboundDecision,
  type VerifiedBalance,
} from '../../../src/lib/integrations/sync/outboundStockWriter.ts';
import { normalizeStockLevel } from '../../../src/lib/integrations/normalizers.ts';
import { TINY_STOCK_FIELD_MAP } from '../../../src/lib/integrations/providers/tiny/tinyProtocol.ts';
import { checkRateLimitGate } from '../../../src/lib/integrations/observability/rateLimitState.ts';
import { buildSafeLog } from '../../../src/lib/integrations/webhooks/webhookVerification.ts';
import type { Connector, ConnectorContext, WriteAck } from '../../../src/lib/integrations/connector.ts';
import type { StockWrite } from '../../../src/lib/integrations/stockOperations.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

/** Hard cap per invocation. Each adjustment costs at least two provider calls
 *  (read the balance, write) and the connector paces requests 1.1s apart, so 30
 *  adjustments is already ~70s of wall clock. The platform kills the invocation
 *  long before an unbounded batch would finish, and a killed invocation loses the
 *  record of what it already sent — the one outcome worse than a slow queue. */
const MAX_ADJUSTMENTS_PER_RUN = 30;

/** Stop starting new adjustments past this point and report the rest as remaining.
 *  Well under the platform ceiling, so the response and the status updates always
 *  get written. */
const TIME_BUDGET_MS = 90_000;

/** After this many failed attempts an adjustment stops being retried
 *  automatically. A transient drift clears itself on the next run; a structural
 *  problem does not, and retrying it forever would burn the provider quota and
 *  bury the real reason under identical errors. */
const MAX_ATTEMPTS = 5;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', ...extraHeaders },
  });
}

function connectorFor(providerKey: string): Connector | null {
  switch (providerKey) {
    case 'tiny':
      return new TinyConnector();
    default:
      return null;
  }
}

interface ConnectionRow {
  id: string;
  company_id: string;
  provider_key: string;
  status: string;
  configuration: Record<string, unknown> | null;
  sync_direction: string;
  credentials_set_at: string | null;
  external_account_id: string | null;
}

/** The columns the decision module needs, and no more. `secret` is not on this
 *  table; nothing here can select one. */
const ADJUSTMENT_COLUMNS =
  'id, external_product_id, sku, external_warehouse_id, target_warehouse_id, previous_quantity, ' +
  'counted_quantity, delta_quantity, write_kind, movement_reason, reason, idempotency_key, ' +
  'approved_at, attempts, origin';

interface AdjustmentRow extends ApprovedAdjustment {
  attempts: number;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

  const startedAt = Date.now();

  try {
    const authHeader = req.headers.get('Authorization');

    const userClient: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: authHeader ? { Authorization: authHeader } : {} },
    });

    const { data: userData } = authHeader ? await userClient.auth.getUser() : { data: null };
    const { data: role } = userData?.user ? await userClient.rpc('get_my_role') : { data: null };

    const callerDenial = authorizeCaller({
      hasAuthHeader: authHeader != null,
      sessionUserId: userData?.user?.id ?? null,
      role: typeof role === 'string' ? role : null,
    });
    if (callerDenial) return json({ error: callerDenial.message, code: callerDenial.code }, callerDenial.status);

    const body = await req.json().catch(() => null);
    const connectionId = typeof body?.connectionId === 'string' ? body.connectionId.trim() : '';
    if (!connectionId) return json({ error: 'connectionId é obrigatório.', code: 'missing_connection_id' }, 400);

    // Strict equality, not truthiness: dryRun: "false" is a truthy string, and
    // reading it as "simulate" would skip a real write the operator asked for.
    const dryRun = body?.dryRun === true;

    // An explicit id list narrows the batch to what the operator selected. Absent,
    // every approved-and-pending adjustment on the connection is a candidate.
    const requestedIds = Array.isArray(body?.adjustmentIds)
      ? (body.adjustmentIds as unknown[]).filter((id): id is string => typeof id === 'string')
      : null;

    // Overrides are per adjustment AND per rejection code. A blanket switch would
    // outlive the situation that justified it.
    const overrides = readOverrides(body?.overrides);

    // ── Connection, under the caller's RLS ──────────────────────────────────
    const { data: connection, error: connectionError } = await userClient
      .from('integration_connections')
      .select(
        'id, company_id, provider_key, status, configuration, sync_direction, credentials_set_at, external_account_id'
      )
      .eq('id', connectionId)
      .maybeSingle<ConnectionRow>();

    if (connectionError) return json({ error: connectionError.message }, 500);

    const connector = connection ? connectorFor(connection.provider_key) : null;

    const connectionDenial = authorizeConnection({
      connection,
      // Always outbound here. This endpoint has no read-only mode, so a read-only
      // connection is refused before anything else happens.
      direction: 'outbound',
      connectorAvailable: connector != null,
    });
    if (connectionDenial) {
      return json({ error: connectionDenial.message, code: connectionDenial.code }, connectionDenial.status);
    }
    if (!connection || !connector) return json({ error: 'Conexão não encontrada.' }, 404);

    if (!connector.capabilities.write_stock && !connector.capabilities.write_adjustment) {
      return json(
        { error: 'Este provedor não aceita escrita de estoque.', code: 'provider_read_only' },
        409
      );
    }

    // ── Rate limit, before the credential is even touched ───────────────────
    const { data: rateLimitRow } = await userClient
      .from('integration_rate_limit_state')
      .select('connection_id, operation, remaining, limit_value, reset_at, retry_after_until, observed_at')
      .eq('connection_id', connection.id)
      .maybeSingle<{
        connection_id: string; operation: string; remaining: number | null;
        limit_value: number | null; reset_at: string | null;
        retry_after_until: string | null; observed_at: string;
      }>();

    const gate = checkRateLimitGate(
      rateLimitRow == null
        ? null
        : {
            connectionId: rateLimitRow.connection_id,
            operation: rateLimitRow.operation,
            remaining: rateLimitRow.remaining,
            limitValue: rateLimitRow.limit_value,
            resetAt: rateLimitRow.reset_at,
            retryAfterUntil: rateLimitRow.retry_after_until,
            observedAt: rateLimitRow.observed_at,
          },
      Date.now()
    );

    if (!gate.proceed) {
      // Refused before the credential is even read. Starting a write batch we
      // cannot finish would leave half the queue sent and half not, which is the
      // hardest state to reason about afterwards.
      return json(
        {
          error: 'Aguardando liberação do limite de requisições do provedor.',
          code: 'rate_limited',
          reason: gate.reason,
          retryAfterMs: gate.waitMs,
        },
        429,
        { 'Retry-After': String(Math.ceil(gate.waitMs / 1000)) }
      );
    }

    // ── The single privileged read ──────────────────────────────────────────
    const adminClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const { data: credential, error: credentialError } = await adminClient
      .from('integration_credentials')
      .select('secret, expires_at')
      .eq('connection_id', connection.id)
      .eq('company_id', connection.company_id)
      .maybeSingle<{ secret: string; expires_at: string | null }>();

    if (credentialError) {
      return json({ error: 'Não foi possível recuperar a credencial desta conexão.' }, 500);
    }

    const credentialDenial = authorizeCredential(
      credential ? { hasSecret: Boolean(credential.secret), expiresAt: credential.expires_at } : null,
      Date.now()
    );
    if (credentialDenial) {
      return json({ error: credentialDenial.message, code: credentialDenial.code }, credentialDenial.status);
    }
    if (!credential?.secret) return json({ error: 'Credencial não encontrada.' }, 409);

    const ctx: ConnectorContext = {
      connectionId: connection.id,
      secret: credential.secret,
      externalAccountId: connection.external_account_id,
      configuration: connection.configuration ?? {},
    };

    // ── The queue ───────────────────────────────────────────────────────────
    // Read under RLS, and additionally filtered by company_id. Belt and braces:
    // RLS already restricts it, and the explicit filter means a policy change
    // cannot silently widen this query.
    let query = userClient
      .from('integration_stock_adjustments')
      .select(ADJUSTMENT_COLUMNS)
      .eq('connection_id', connection.id)
      .eq('company_id', connection.company_id)
      .eq('sync_status', 'pending')
      .not('approved_at', 'is', null)
      .lt('attempts', MAX_ATTEMPTS)
      .order('approved_at', { ascending: true })
      .limit(MAX_ADJUSTMENTS_PER_RUN);

    if (requestedIds != null) {
      if (requestedIds.length === 0) {
        return json({ error: 'adjustmentIds veio vazio.', code: 'empty_selection' }, 400);
      }
      query = query.in('id', requestedIds);
    }

    const { data: queue, error: queueError } = await query.returns<AdjustmentRow[]>();
    if (queueError) return json({ error: queueError.message }, 500);

    if (!queue || queue.length === 0) {
      return json({ ok: true, sent: 0, refused: 0, deferred: 0, message: 'Nenhum lançamento aprovado pendente.' });
    }

    const { selected, deferred } = selectOneAdjustmentPerProduct(queue);

    // ── Decide, then send, one adjustment at a time ─────────────────────────
    // Not batched, deliberately. Tiny answers a multi-record write with a single
    // envelope, so a partial failure cannot be attributed to a record — and an
    // unattributable partial failure on a stock write means not knowing which
    // balances changed. One at a time costs requests and buys certainty.
    const results: AdjustmentOutcome[] = [];
    let timeExhausted = false;

    for (const adjustment of selected) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) {
        timeExhausted = true;
        break;
      }

      const outcome = await processAdjustment({
        adjustment,
        connector,
        ctx,
        overrides: overrides.get(adjustment.id) ?? [],
        dryRun,
        connectionId: connection.id,
        providerKey: connection.provider_key,
      });

      results.push(outcome);

      if (!dryRun) {
        await recordOutcome(userClient, adminClient, connection, adjustment, outcome);
      }
    }

    const notStarted = selected.length - results.length;

    const summary = {
      ok: true,
      dryRun,
      sent: results.filter(r => r.status === 'sent').length,
      failed: results.filter(r => r.status === 'failed').length,
      refused: results.filter(r => r.status === 'refused').length,
      /** Same product as another adjustment in this batch — next run picks it up. */
      deferred: deferred.length,
      /** Time budget ran out before these were started. Nothing was sent for them. */
      notStarted,
      timeExhausted,
      items: results.map(r => ({
        adjustmentId: r.adjustmentId,
        status: r.status,
        code: r.code ?? null,
        message: r.message ?? null,
        overridable: r.overridable ?? false,
        externalReference: r.externalReference ?? null,
      })),
    };

    console.log(
      JSON.stringify(
        buildSafeLog({
          event: dryRun ? 'stockWrite.simulated' : 'stockWrite.finished',
          connectionId: connection.id,
          provider: connection.provider_key,
          durationMs: Date.now() - startedAt,
          context: {
            sent: summary.sent,
            failed: summary.failed,
            refused: summary.refused,
            deferred: summary.deferred,
            notStarted,
          },
        })
      )
    );

    return json(summary);
  } catch (thrown) {
    console.error(
      JSON.stringify(
        buildSafeLog({
          event: 'stockWrite.crashed',
          message: thrown instanceof Error ? thrown.message : 'erro desconhecido',
          durationMs: Date.now() - startedAt,
        })
      )
    );
    return json({ error: 'Erro interno.' }, 500);
  }
});

// ── One adjustment, end to end ──────────────────────────────────────────────

interface AdjustmentOutcome {
  adjustmentId: string;
  status: 'sent' | 'refused' | 'failed';
  code?: string;
  message?: string;
  overridable?: boolean;
  externalReference?: string | null;
  errorKind?: string | null;
}

async function processAdjustment(params: {
  adjustment: AdjustmentRow;
  connector: Connector;
  ctx: ConnectorContext;
  overrides: readonly string[];
  dryRun: boolean;
  connectionId: string;
  providerKey: string;
}): Promise<AdjustmentOutcome> {
  const { adjustment, connector, ctx, overrides, dryRun } = params;

  // ── 1. Re-read the provider's balance, right now ──────────────────────────
  // Not cached, not taken from integration_stock_levels. The whole point is to
  // compare the plan's assumption against what the ERP holds at this instant; a
  // stored value would be exactly the stale number the guard exists to catch.
  const verified = await readVerifiedBalance(connector, ctx, adjustment);

  // ── 2. Decide ────────────────────────────────────────────────────────────
  const decision: OutboundDecision = decideOutboundWrite({
    adjustment,
    verified: verified.balance,
    nowMs: Date.now(),
    overriddenCodes: overrides,
  });

  if (decision.status === 'refused') {
    return {
      adjustmentId: adjustment.id,
      status: 'refused',
      code: decision.code,
      message: decision.message,
      overridable: decision.overridable,
    };
  }

  if (dryRun) {
    return {
      adjustmentId: adjustment.id,
      status: 'sent',
      code: 'dry_run',
      message: describeIntent(decision.write),
    };
  }

  // ── 3. Send ──────────────────────────────────────────────────────────────
  const ack = await sendWrite(connector, ctx, decision.write);

  if (!ack.ok) {
    return {
      adjustmentId: adjustment.id,
      status: 'failed',
      code: ack.code,
      message: ack.message,
      errorKind: ack.errorKind,
    };
  }

  return {
    adjustmentId: adjustment.id,
    status: 'sent',
    externalReference: ack.externalReference,
    message: describeIntent(decision.write),
  };
}

/** Read the provider's per-deposit balance for one product.
 *
 *  A read failure is not fatal: the decision continues with a null balance, and
 *  the guard's staleness rule then carries the whole burden. That is a deliberate
 *  trade — refusing every write because a read failed would stop the queue on a
 *  provider hiccup, while a null balance makes the guard stricter, not looser. */
async function readVerifiedBalance(
  connector: Connector,
  ctx: ConnectorContext,
  adjustment: ApprovedAdjustment
): Promise<{ balance: VerifiedBalance | null; reason: string | null }> {
  if (connector.getProductStock == null) {
    return { balance: null, reason: 'provider_has_no_stock_read' };
  }
  if (!adjustment.external_product_id) {
    // prepareWrite refuses this anyway; skipping the call avoids a pointless
    // request against an id we do not have.
    return { balance: null, reason: 'no_external_product' };
  }

  const result = await connector.getProductStock(ctx, adjustment.external_product_id);
  if (!result.success) {
    return { balance: null, reason: result.error.kind };
  }

  const observedAt = new Date().toISOString();
  const levels: { warehouseExternalId: string | null; quantity: number }[] = [];

  for (const record of result.data) {
    const normalized = normalizeStockLevel(record.payload, TINY_STOCK_FIELD_MAP, observedAt);
    // An unreadable row is skipped rather than counted as zero. Counting it as
    // zero would understate the total, and an understated total makes an increase
    // look larger than it is — the direction that gets writes wrongly refused, or
    // worse, makes a drift check pass on a wrong number.
    if (normalized.ok) {
      levels.push({
        warehouseExternalId: normalized.value.warehouseExternalId,
        quantity: normalized.value.quantity,
      });
    }
  }

  if (levels.length === 0) {
    // The provider answered but nothing was readable. Treated as "unknown", not
    // as "zero stock": zero would let a decrease look catastrophic and an absolute
    // write look safe.
    return { balance: null, reason: 'no_readable_stock_rows' };
  }

  return {
    balance: summarizeProviderStock(
      levels,
      // Only a transfer needs a source balance, and only the origin deposit counts.
      adjustment.write_kind === 'transfer' ? adjustment.external_warehouse_id : null
    ),
    reason: null,
  };
}

interface SendResult {
  ok: boolean;
  externalReference: string | null;
  code?: string;
  message?: string;
  errorKind?: string | null;
}

/** Route the write to the connector method that matches its shape.
 *
 *  The mapping is explicit rather than "whatever method exists": sending an
 *  absolute write through the adjustment endpoint (or the reverse) is the single
 *  confusion this whole design is built to prevent, and a fallback chain is how
 *  that confusion gets introduced by accident. */
async function sendWrite(
  connector: Connector,
  ctx: ConnectorContext,
  write: StockWrite
): Promise<SendResult> {
  const method =
    write.kind === 'transfer'
      ? connector.createStockTransfer
      : write.kind === 'absolute'
        ? connector.updateStock
        : connector.createStockAdjustment;

  if (method == null) {
    return {
      ok: false,
      externalReference: null,
      code: 'operation_unsupported',
      message: `Este provedor não implementa a operação necessária para um lançamento do tipo ${write.kind}.`,
      errorKind: 'CAPABILITY_MISSING',
    };
  }

  const result = await method.call(connector, ctx, [write]);

  if (!result.success) {
    return {
      ok: false,
      externalReference: null,
      code: result.error.providerCode ?? result.error.kind,
      message: result.error.message,
      errorKind: result.error.kind,
    };
  }

  const ack: WriteAck | undefined = result.data[0];

  if (ack == null) {
    // The provider reported success but acknowledged nothing. Recorded as failed:
    // marking it sent would claim a balance change we cannot evidence.
    return {
      ok: false,
      externalReference: null,
      code: 'no_acknowledgement',
      message: 'O provedor respondeu sem confirmar o lançamento. Verifique o saldo antes de tentar novamente.',
      errorKind: 'PROVIDER_ERROR',
    };
  }

  if (!ack.ok) {
    return {
      ok: false,
      externalReference: ack.externalOperationId ?? null,
      code: ack.error?.providerCode ?? ack.error?.kind ?? 'provider_rejected',
      message: ack.error?.message ?? 'O provedor recusou o lançamento.',
      errorKind: ack.error?.kind ?? 'PROVIDER_ERROR',
    };
  }

  return { ok: true, externalReference: ack.externalOperationId ?? null };
}

/** A human-readable statement of what was sent, for the audit trail. Says which
 *  SHAPE the write had, because "ajustou o saldo" is exactly the ambiguity between
 *  absolute and delta that must never appear in a log. */
function describeIntent(write: StockWrite): string {
  switch (write.kind) {
    case 'absolute':
      return `Saldo definido como ${write.targetQuantity}.`;
    case 'delta':
      return `Saldo alterado em ${write.deltaQuantity > 0 ? '+' : ''}${write.deltaQuantity}.`;
    case 'movement':
      return `Movimento ${write.movementType} de ${write.quantity} unidade(s).`;
    case 'transfer':
      return `Transferência de ${write.quantity} unidade(s) de ${write.fromLocationExternalId} para ${write.toLocationExternalId}.`;
  }
}

// ── Recording ───────────────────────────────────────────────────────────────

/** Write the outcome back to the adjustment row.
 *
 *  A refusal or failure keeps sync_status 'pending' until MAX_ATTEMPTS, because a
 *  drift or a provider hiccup clears itself on the next run. Past that it becomes
 *  'failed' and stops being retried — the error stays visible, and the queue does
 *  not spin on a structural problem.
 *
 *  A non-overridable refusal goes to 'failed' immediately: it will refuse
 *  identically forever, so retrying it four more times only delays the operator
 *  finding out. */
async function recordOutcome(
  client: SupabaseClient,
  adminClient: SupabaseClient,
  connection: ConnectionRow,
  adjustment: AdjustmentRow,
  outcome: AdjustmentOutcome
): Promise<void> {
  const now = new Date().toISOString();
  const attempts = adjustment.attempts + 1;

  if (outcome.status === 'sent') {
    await client
      .from('integration_stock_adjustments')
      .update({
        // 'sent', not 'confirmed': the provider accepted it, and confirmation is
        // the next inbound sync agreeing that the balance matches. Claiming
        // 'confirmed' here would assert something nobody verified.
        sync_status: 'sent',
        attempts,
        sent_at: now,
        external_reference: outcome.externalReference ?? null,
        error_kind: null,
        error_message: null,
      })
      .eq('id', adjustment.id);

    // Only the Logística Reversa origin raises/resolves alerts today (see below) —
    // resolving here is what closes one it may have raised on an earlier attempt.
    // A no-op RPC call when nothing is open; failure here must never fail the send
    // that already succeeded, so it is swallowed.
    if (adjustment.origin === 'reverse_logistics') {
      try {
        await adminClient.rpc('integration_resolve_alert', { p_connection_id: connection.id, p_kind: 'sync_failing' });
      } catch { /* alerting is best-effort */ }
    }
    return;
  }

  const permanent =
    (outcome.status === 'refused' && outcome.overridable === false) || attempts >= MAX_ATTEMPTS;

  await client
    .from('integration_stock_adjustments')
    .update({
      sync_status: permanent ? 'failed' : 'pending',
      attempts,
      error_kind: outcome.errorKind ?? outcome.code ?? null,
      error_message: outcome.message ?? null,
    })
    .eq('id', adjustment.id);

  // Guarded by origin so physical_count/manual/reconciliation/conflict_resolution
  // keep their exact current behaviour — no alert was raised for them before this
  // change, and none is raised for them now. Only the new reverse_logistics origin
  // gets this notification, per the reverse-logistics sync spec.
  if (permanent && adjustment.origin === 'reverse_logistics') {
    try {
      await adminClient.rpc('integration_raise_alert', {
        p_company_id: connection.company_id,
        p_connection_id: connection.id,
        p_kind: 'sync_failing',
        p_severity: 'warning',
        p_message: `Falha ao sincronizar entrada de estoque da Logística Reversa com o Tiny (SKU ${adjustment.sku ?? '—'}).`,
        p_context: { adjustmentId: adjustment.id, sku: adjustment.sku, errorKind: outcome.errorKind ?? outcome.code ?? null },
      });
    } catch { /* alerting is best-effort */ }
  }
}

/** Parse the override list.
 *
 *  Shape: `[{ adjustmentId, codes: ['increase_too_large'] }]`. Anything malformed
 *  is dropped rather than interpreted — an override is permission to change a
 *  customer's stock balance, and a half-understood one must not count. */
function readOverrides(raw: unknown): Map<string, string[]> {
  const map = new Map<string, string[]>();
  if (!Array.isArray(raw)) return map;

  for (const entry of raw) {
    if (entry == null || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const id = typeof record.adjustmentId === 'string' ? record.adjustmentId : null;
    if (!id) continue;
    const codes = Array.isArray(record.codes)
      ? record.codes.filter((c): c is string => typeof c === 'string')
      : [];
    if (codes.length === 0) continue;
    map.set(id, codes);
  }

  return map;
}
