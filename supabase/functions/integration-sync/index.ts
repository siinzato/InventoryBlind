// Integration Sync — Edge Function.
//
// The server-side entry point for every provider sync. Resolves the credential,
// builds the connector, runs the engine, records the job.
//
// ── Privilege split, the most important thing in this file ───────────────────
// TWO Supabase clients, on purpose:
//
//   userClient    ANON key + the caller's JWT. Every read and write of business
//                 data goes through it, so RLS remains the barrier exactly as it
//                 is for the browser. Same pattern as blindai-agent/erp-sync.
//
//   adminClient   service_role. Used for ONE query: reading the row from
//                 integration_credentials, which has no policy for
//                 `authenticated` by design (migration 042).
//
// The split matters because service_role bypasses RLS entirely. Using it for the
// data path would mean a bug in this file could read or write another tenant's
// inventory. Confining it to the credential lookup keeps that impossible, and the
// tenant of that lookup is derived from a connection row already fetched under
// RLS — so the caller cannot reach a credential they do not own.
//
// ── Dry run ─────────────────────────────────────────────────────────────────
// `dryRun: true` runs the whole cycle against the real provider — reads, mapping,
// conflict policy, the guard — and reports exactly what WOULD be written without
// sending a single write. It exists so a customer can validate an integration with
// their real catalogue before the first byte of stock is changed.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { TinyConnector } from '../_shared/tinyConnector.ts';
import { createDenoSyncRepository } from '../_shared/denoSyncRepository.ts';
import { SyncEngine } from '../../../src/lib/integrations/sync/syncEngine.ts';
import { ProviderAdapter } from '../../../src/lib/integrations/adapter.ts';
import { preferredWriteKind } from '../../../src/lib/integrations/stockOperations.ts';
import { TINY_STOCK_FIELD_MAP } from '../../../src/lib/integrations/providers/tiny/tinyProtocol.ts';
import { checkRateLimitGate } from '../../../src/lib/integrations/observability/rateLimitState.ts';
// The authorization decisions are pure and unit-tested in
// src/lib/integrations/__tests__/authorization.test.ts. This file supplies the
// facts and executes the verdict; it does not decide.
import {
  authorizeCaller,
  authorizeConnection,
  authorizeCredential,
  parseSyncRequest,
} from '../../../src/lib/integrations/authorization.ts';
import { buildSafeLog } from '../../../src/lib/integrations/webhooks/webhookVerification.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

/** Connector registry. Adding a provider is one entry here plus its connector —
 *  no change to this function's logic, which is the whole point of the contract. */
function connectorFor(providerKey: string) {
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
  display_name: string;
  external_account_id: string | null;
  status: string;
  configuration: Record<string, unknown> | null;
  sync_direction: string;
  conflict_policy: string;
  credentials_set_at: string | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get('Authorization');

    // ── Everything business-related runs under the caller's own RLS ─────────
    // Built with whatever header arrived; if there is none, getUser() returns no
    // user and authorizeCaller refuses below. The client is inert until used.
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
    const parsed = parseSyncRequest(body);
    if ('status' in parsed) return json({ error: parsed.message, code: parsed.code }, parsed.status);
    const { connectionId, direction, syncType, dryRun } = parsed;

    // Fetched under RLS: a connection from another company simply is not visible,
    // so this doubles as the tenancy check. `secret` is not selectable here.
    const { data: connection, error: connectionError } = await userClient
      .from('integration_connections')
      .select(
        'id, company_id, provider_key, display_name, external_account_id, status, configuration, sync_direction, conflict_policy, credentials_set_at'
      )
      .eq('id', connectionId)
      .maybeSingle<ConnectionRow>();

    if (connectionError) return json({ error: connectionError.message }, 500);

    const connector = connection ? connectorFor(connection.provider_key) : null;

    const connectionDenial = authorizeConnection({
      connection,
      direction,
      connectorAvailable: connector != null,
    });
    if (connectionDenial) {
      return json({ error: connectionDenial.message, code: connectionDenial.code }, connectionDenial.status);
    }
    // Unreachable: authorizeConnection already denied both cases. Written as a
    // real guard rather than a `!` assertion so the narrowing is proven by
    // control flow instead of asserted, and a future reordering of the checks
    // above cannot turn a null into a runtime crash.
    if (!connection || !connector) return json({ error: 'Conexão não encontrada.' }, 404);

    // ── The single privileged operation ─────────────────────────────────────
    // Scoped to the connection we already authorised above, and further filtered
    // by its company_id so even a bug in the id cannot cross tenants.
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
      // The message is deliberately generic: a credential-store error must not leak
      // anything about the row.
      return json({ error: 'Não foi possível recuperar a credencial desta conexão.' }, 500);
    }
    // Only the presence of the secret is handed to the decision function, never
    // the secret itself.
    const credentialDenial = authorizeCredential(
      credential ? { hasSecret: Boolean(credential.secret), expiresAt: credential.expires_at } : null,
      Date.now()
    );
    if (credentialDenial) {
      return json({ error: credentialDenial.message, code: credentialDenial.code }, credentialDenial.status);
    }
    // Unreachable — authorizeCredential denies a missing secret. Same reasoning as
    // the connection guard above: proven by control flow, not asserted.
    if (!credential?.secret) {
      return json({ error: 'Credencial não encontrada. Configure-a novamente.' }, 409);
    }

    const ctx = {
      connectionId: connection.id,
      secret: credential.secret,
      externalAccountId: connection.external_account_id,
      configuration: connection.configuration ?? {},
    };

    // ── testConnection: the cheapest useful call, and the first thing to run ──
    if (body?.testOnly === true) {
      const result = await connector.testConnection(ctx);

      const patch = result.success
        ? { status: 'active', last_error: null, last_error_at: null }
        : {
            // A provider outage must not flip a working connection to `error`:
            // that reads as "your credential is broken" and sends the customer
            // looking for a problem they do not have.
            status: result.error.retryable ? connection.status : 'error',
            last_error: result.error.message,
            last_error_at: new Date().toISOString(),
          };

      await userClient.from('integration_connections').update(patch).eq('id', connection.id);

      return json({
        ok: result.success,
        message: result.success ? result.data.message : result.error.message,
        errorKind: result.success ? null : result.error.kind,
        retryable: result.success ? false : result.error.retryable,
      });
    }

    // ── Rate limit gate ─────────────────────────────────────────────────────
    // Checked before spending a request: an Edge Function is stateless, so what the
    // provider told us last time only survives because it is in a table.
    const { data: rateLimitRow } = await adminClient
      .from('integration_rate_limit_state')
      .select('connection_id, operation, remaining, limit_value, reset_at, retry_after_until, observed_at')
      .eq('connection_id', connection.id)
      .eq('operation', '*')
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
      // 429 with Retry-After: whatever called us — a person or the scheduler — can
      // come back rather than burn the remaining budget.
      return new Response(
        JSON.stringify({
          error: 'Aguardando liberação do limite de requisições do provedor.',
          reason: gate.reason,
          retryAfterMs: gate.waitMs,
        }),
        {
          status: 429,
          headers: {
            ...CORS_HEADERS,
            'Content-Type': 'application/json',
            'Retry-After': String(Math.ceil(gate.waitMs / 1000)),
          },
        }
      );
    }

    // ── Build the engine ────────────────────────────────────────────────────
    // service_role for the data path here, NOT the user client: the same code runs
    // for a scheduled sync where no user session exists. The compensating control is
    // that the repository scopes every query by companyId, and that company id comes
    // from the connection row fetched under RLS above — never from the request.
    const { repository, ledger } = createDenoSyncRepository({
      client: adminClient,
      connectionId: connection.id,
      companyId: connection.company_id,
      dryRun,
    });

    const adapter = new ProviderAdapter({
      // No cast: TinyConnector declares `implements Connector` against the real
      // interface, so a signature drift fails here at compile time.
      connector,
      direction: connection.sync_direction as 'inbound' | 'outbound' | 'bidirectional',
      onAttempt: event => {
        console.log(
          JSON.stringify(
            buildSafeLog({
              event: 'provider.attempt',
              connectionId: connection.id,
              provider: connection.provider_key,
              status: event.success ? 'ok' : 'fail',
              errorKind: event.errorKind ?? null,
              context: { operation: event.operation, attempt: event.attempt, delayedMs: event.delayedMs },
            })
          )
        );
      },
    });

    // The mapping index is loaded once and resolved in memory: a per-record query
    // would turn a 2.000-SKU catalogue into 2.000 round trips.
    const linkIndex = new Map<string, string | null>();
    {
      const PAGE = 1000;
      let from = 0;
      for (;;) {
        const { data, error } = await adminClient
          .from('integration_entity_links')
          .select('external_id, internal_id')
          .eq('company_id', connection.company_id)
          .eq('connection_id', connection.id)
          .eq('entity_type', 'product')
          .range(from, from + PAGE - 1);

        if (error) return json({ error: 'Falha ao carregar o mapeamento de produtos.' }, 500);

        const rows = (data ?? []) as { external_id: string; internal_id: string | null }[];
        for (const row of rows) linkIndex.set(row.external_id, row.internal_id);
        // A silently truncated index would make linked products look new.
        if (rows.length < PAGE) break;
        from += PAGE;
      }
    }

    const engine = new SyncEngine({
      repository,
      adapter,
      connection: {
        connectionId: connection.id,
        providerKey: connection.provider_key,
        direction: connection.sync_direction as 'inbound' | 'outbound' | 'bidirectional',
        conflictPolicy: connection.conflict_policy as
          | 'erp_wins' | 'inventoryblind_wins' | 'last_write_wins' | 'manual_review',
      },
      now: () => new Date(),
      newIdempotencyKey: () => crypto.randomUUID(),
      stockFieldMap: TINY_STOCK_FIELD_MAP,
      // The least destructive shape this provider accepts.
      writeKind: preferredWriteKind(connector.capabilities),
      resolveInternalId: externalId => linkIndex.get(externalId) ?? null,
    });

    if (direction === 'outbound') {
      // Outbound needs a prepared, guarded set of writes. Building them from
      // approved adjustments is a separate endpoint's job — running an unguarded
      // push from here would bypass stockWriteGuard, which is the one thing
      // protecting the customer's ERP from a wrong balance.
      return json(
        {
          error:
            'O envio ao provedor é feito a partir de ajustes aprovados, não deste endpoint. Use integration-stock-write.',
          code: 'use_stock_write_endpoint',
          endpoint: 'integration-stock-write',
        },
        409
      );
    }

    const outcome = await engine.runInboundStockSync(ctx, {
      syncType: syncType as 'full' | 'incremental' | 'manual' | 'scheduled' | 'webhook',
      trigger: dryRun ? 'manual' : (body?.trigger as 'manual' | 'schedule' | 'webhook' | 'system') ?? 'manual',
    });

    console.log(
      JSON.stringify(
        buildSafeLog({
          event: dryRun ? 'sync.simulated' : 'sync.finished',
          connectionId: connection.id,
          provider: connection.provider_key,
          jobId: outcome.job.id,
          status: outcome.status,
          errorKind: outcome.error?.kind ?? null,
          context: {
            inbound: outcome.plan?.inbound.length ?? 0,
            conflicts: outcome.plan?.conflicts.length ?? 0,
            skipped: outcome.plan?.skipped.length ?? 0,
          },
        })
      )
    );

    return json({
      ok: outcome.status === 'success' || outcome.status === 'partial',
      dryRun,
      status: outcome.status,
      jobId: dryRun ? null : outcome.job.id,
      errorKind: outcome.error?.kind ?? null,
      message: outcome.error?.message ?? null,
      summary: {
        wouldUpdate: outcome.plan?.inbound.length ?? 0,
        conflicts: outcome.plan?.conflicts.length ?? 0,
        skipped: outcome.plan?.skipped.length ?? 0,
      },
      // Only on a dry run: the exact effect, so it can be reviewed before anything
      // is written for real. Capped so a 5.000-SKU catalogue does not return a
      // response nobody can read.
      preview: dryRun
        ? {
            stockUpdates: ledger.stockUpdates.slice(0, 100),
            stockUpdateTotal: ledger.stockUpdates.length,
            conflicts: ledger.conflicts.slice(0, 50),
            conflictTotal: ledger.conflicts.length,
            depositsObserved: ledger.stockLevels.length,
            cursorWouldAdvanceTo: ledger.cursorAdvancedTo,
          }
        : undefined,
    });
  } catch (thrown) {
    // Never echo the thrown value: it can carry request context including the token.
    const message = thrown instanceof Error ? thrown.message : 'Erro inesperado.';
    return json({ error: message }, 500);
  }
});
