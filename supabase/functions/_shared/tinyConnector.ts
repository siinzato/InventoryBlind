// Tiny ERP (Olist) connector — the HTTP half.
//
// Server-side only. This is the one place that holds a real token, which is why it
// lives under supabase/functions and never in the browser bundle.
//
// It does exactly three things: build the request, send it, and hand the raw
// envelope to the protocol layer. It does not normalise, does not retry, does not
// know what a tenant is — the Adapter above it owns all of that. Keeping it this
// thin is what makes the protocol testable without a token.
//
// Everything provider-specific that can be decided without a network call lives in
// tinyProtocol.ts and is unit-tested there.

import {
  TINY_API_BASE,
  TINY_CAPABILITIES,
  TINY_ENDPOINTS,
  buildTinyStockPayload,
  buildTinyTransferLegs,
  extractTinyStockRows,
  parseTinyResponse,
  prepareTinyProduct,
  tinyPageInfo,
  unwrapTinyList,
  type TinyStockPayload,
} from '../../../src/lib/integrations/providers/tiny/tinyProtocol.ts';
import { IntegrationError, toIntegrationError } from '../../../src/lib/integrations/errors.ts';
// The real contract, not a structural copy. Declaring `implements Connector` means a
// signature drift is a compile error here instead of a cast that silently hides it —
// which is what the previous re-declared shapes did. Possible now that the engine's
// import chain resolves under Deno.
import type {
  Connector,
  ConnectorContext,
  ConnectionTestResult,
  ListRequest,
  RawRecord,
  WriteAck,
} from '../../../src/lib/integrations/connector.ts';
import type { OperationResult } from '../../../src/lib/integrations/result.ts';
import type { StockWrite, TransferStockWrite } from '../../../src/lib/integrations/stockOperations.ts';

const PROVIDER = 'tiny';

/** Tiny v2 documents a per-token request ceiling. Requests are spaced rather than
 *  fired in a burst, because the API answers a breach with an error envelope and
 *  no Retry-After — so the engine would back off blind. Pacing here is cheaper
 *  than recovering there. */
const MIN_REQUEST_INTERVAL_MS = 1100;

/** Requests carry a timeout: Tiny occasionally accepts a connection and never
 *  answers, and an un-timed fetch would pin the worker until the platform kills
 *  the whole invocation, losing the run record with it. */
const REQUEST_TIMEOUT_MS = 30_000;

function ok<T>(operation: string, data: T, extra: Record<string, unknown> = {}): OperationResult<T> {
  return { success: true, data, provider: PROVIDER, operation, ...extra };
}

function failed<T>(operation: string, error: IntegrationError, extra: Record<string, unknown> = {}): OperationResult<T> {
  return { success: false, error, provider: PROVIDER, operation, ...extra };
}

export class TinyConnector implements Connector {
  readonly providerKey = PROVIDER;
  readonly capabilities = TINY_CAPABILITIES;
  readonly pageStrategy = 'page' as const;

  private lastRequestAt = 0;

  /** Space requests to respect the documented ceiling. */
  private async pace(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestAt;
    if (this.lastRequestAt > 0 && elapsed < MIN_REQUEST_INTERVAL_MS) {
      await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL_MS - elapsed));
    }
    this.lastRequestAt = Date.now();
  }

  /** One Tiny call.
   *
   *  The token goes in the form body, never in the URL: a query-string token ends
   *  up in access logs and error traces. Nothing in this method logs the body.
   *
   *  The response is handed to parseTinyResponse regardless of HTTP status,
   *  because Tiny answers 200 with `status: "Erro"` — trusting response.ok is the
   *  bug this whole design exists to avoid. */
  private async call(
    ctx: ConnectorContext,
    endpoint: string,
    params: Record<string, string>,
    operation: string
  ): Promise<{ ok: true; retorno: Record<string, unknown>; durationMs: number } | { ok: false; error: IntegrationError; durationMs: number }> {
    await this.pace();

    const body = new URLSearchParams({
      token: ctx.secret,
      formato: 'json',
      ...params,
    });

    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), REQUEST_TIMEOUT_MS);

    // Caller cancellation and our own timeout both have to abort the request.
    const onExternalAbort = () => timeout.abort();
    ctx.signal?.addEventListener('abort', onExternalAbort);

    const startedAt = Date.now();

    try {
      const response = await fetch(`${TINY_API_BASE}/${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: timeout.signal,
      });

      const text = await response.text();
      let parsedBody: unknown = null;
      try {
        parsedBody = JSON.parse(text);
      } catch {
        // Left null on purpose: parseTinyResponse turns an unparseable body into
        // the right kind of error using the HTTP status, and the raw text is not
        // logged because it can echo request content.
        parsedBody = null;
      }

      const parsed = parseTinyResponse(parsedBody, response.status);
      const durationMs = Date.now() - startedAt;

      if (!parsed.ok) return { ok: false, error: parsed.error!, durationMs };
      return { ok: true, retorno: parsed.retorno as Record<string, unknown>, durationMs };
    } catch (thrown) {
      return { ok: false, error: toIntegrationError(thrown), durationMs: Date.now() - startedAt };
    } finally {
      clearTimeout(timer);
      ctx.signal?.removeEventListener('abort', onExternalAbort);
    }
  }

  /** Verify the token and identify the account.
   *
   *  Uses a one-row product search rather than a dedicated account endpoint: it is
   *  the cheapest call that proves the token works AND that the products module is
   *  reachable, which is what a stock sync actually needs. A token valid for a
   *  plan without API access fails here, which is the point.
   *
   *  Tiny v2 returns no account identifier, so `externalAccountId` stays null and
   *  the connection keeps whatever it had. That is why TINY_CAPABILITIES declares
   *  multi_store: false — without an account id there is no safe way to tell two
   *  Tiny accounts apart, so one connection per token is the only honest model. */
  async testConnection(ctx: ConnectorContext): Promise<OperationResult<ConnectionTestResult>> {
    const result = await this.call(ctx, TINY_ENDPOINTS.listProducts, { pagina: '1' }, 'testConnection');

    if (!result.ok) {
      return failed('testConnection', result.error, { durationMs: result.durationMs });
    }

    return ok(
      'testConnection',
      {
        ok: true,
        externalAccountId: null,
        accountName: null,
        // Null rather than an empty list: v2 does not report scopes, and an empty
        // list would read as "no permissions" and fail the scope check.
        grantedScopes: null,
        message: 'Token validado e módulo de produtos acessível.',
      },
      { durationMs: result.durationMs }
    );
  }

  async getProducts(
    ctx: ConnectorContext,
    request: ListRequest
  ): Promise<OperationResult<RawRecord[]>> {
    const pagina = request.page.strategy === 'page' ? request.page.page : 1;
    const params: Record<string, string> = { pagina: String(pagina) };

    // Incremental pull. VERIFY the parameter name against current docs; when it is
    // absent the walk simply becomes a full one, which is correct-but-slower rather
    // than wrong.
    if (request.updatedSince) {
      params.dataAlteracao = request.updatedSince.slice(0, 10).split('-').reverse().join('/');
    }

    const result = await this.call(ctx, TINY_ENDPOINTS.listProducts, params, 'getProducts');
    if (!result.ok) return failed('getProducts', result.error, { durationMs: result.durationMs });

    const rows = unwrapTinyList(result.retorno, 'produtos', 'produto');
    const records: RawRecord[] = [];

    for (const row of rows) {
      const prepared = prepareTinyProduct(row) as Record<string, unknown>;
      const externalId = prepared?.id != null ? String(prepared.id) : null;
      // A product with no id cannot be linked or re-synced, so it is dropped here
      // rather than passed on to fail normalisation later with less context.
      if (externalId == null) continue;
      records.push({ externalId, payload: prepared });
    }

    return ok('getProducts', records, {
      pagination: tinyPageInfo(result.retorno, pagina, request.page.limit, rows.length),
      durationMs: result.durationMs,
    });
  }

  /** Per-deposit balances.
   *
   *  Tiny v2 has no bulk stock endpoint: the breakdown comes one product at a time.
   *  So this walks the product list page by page and fetches stock per product,
   *  which is why MIN_REQUEST_INTERVAL_MS matters — a 2.000-SKU catalogue is 2.000
   *  calls and will take time. The engine's page walk keeps that bounded and
   *  resumable rather than one enormous request.
   *
   *  VERIFY whether a bulk endpoint now exists; if so this collapses dramatically. */
  async getStockByLocation(
    ctx: ConnectorContext,
    request: ListRequest
  ): Promise<OperationResult<RawRecord[]>> {
    const productsPage = await this.getProducts(ctx, request);
    if (!productsPage.success) {
      return failed('getStockByLocation', productsPage.error, { durationMs: productsPage.durationMs });
    }

    const records: RawRecord[] = [];
    let firstError: IntegrationError | null = null;

    for (const product of productsPage.data) {
      const result = await this.call(
        ctx,
        TINY_ENDPOINTS.getProductStock,
        { id: product.externalId },
        'getStockByLocation'
      );

      if (!result.ok) {
        // A permanent per-product failure (deleted mid-walk) must not abort the
        // page; a credential or rate-limit failure must, because every remaining
        // call would fail the same way and burn the quota.
        if (result.error.retryable || result.error.kind === 'AUTH_INVALID' || result.error.kind === 'PERMISSION_DENIED') {
          return failed('getStockByLocation', result.error, { durationMs: result.durationMs });
        }
        firstError ??= result.error;
        continue;
      }

      for (const row of extractTinyStockRows(result.retorno, product.externalId)) {
        records.push({ externalId: product.externalId, payload: row });
      }
    }

    // Pagination comes from the product walk: stock rows are per product, and the
    // page boundary is the product list's.
    return ok('getStockByLocation', records, {
      pagination: productsPage.pagination,
      durationMs: productsPage.durationMs,
    });
  }

  /** Per-deposit balance for one product.
   *
   *  One call, unpaged — this is the read that happens immediately before a write
   *  so the guard can compare what the plan assumed against what Tiny holds now.
   *  Reusing the catalogue walk for this would be wrong as well as slow: by the
   *  time the walk reached the product in question its early pages would already
   *  be stale, which is the drift the guard is meant to catch. */
  async getProductStock(
    ctx: ConnectorContext,
    externalId: string
  ): Promise<OperationResult<RawRecord[]>> {
    const result = await this.call(
      ctx,
      TINY_ENDPOINTS.getProductStock,
      { id: externalId },
      'getProductStock'
    );

    if (!result.ok) {
      return failed('getProductStock', result.error, { durationMs: result.durationMs });
    }

    const records = extractTinyStockRows(result.retorno, externalId).map(row => ({
      externalId,
      payload: row,
    }));

    return ok('getProductStock', records, { durationMs: result.durationMs });
  }

  async updateStock(ctx: ConnectorContext, writes: StockWrite[]): Promise<OperationResult<WriteAck[]>> {
    return this.applyStockWrites(ctx, writes, 'updateStock');
  }

  async createStockAdjustment(ctx: ConnectorContext, writes: StockWrite[]): Promise<OperationResult<WriteAck[]>> {
    return this.applyStockWrites(ctx, writes, 'createStockAdjustment');
  }

  async createStockTransfer(ctx: ConnectorContext, writes: StockWrite[]): Promise<OperationResult<WriteAck[]>> {
    return this.applyStockWrites(ctx, writes, 'createStockTransfer');
  }

  /** Send stock writes, one product at a time.
   *
   *  Deliberately not batched into a single call even though the payload supports a
   *  `sequencia`: Tiny reports one envelope for the whole batch, so a partial
   *  failure cannot be attributed to a specific SKU. Per-product calls cost more
   *  requests and buy an exact answer for every line, which is the trade this
   *  system needs — an unattributable stock failure is one nobody can fix.
   *
   *  A transfer becomes two ordered legs (saída then entrada, see
   *  buildTinyTransferLegs). If the second leg fails the transfer is reported as
   *  failed and the first leg is NOT reversed automatically: an automatic
   *  compensation that itself failed would leave a worse state than the one the
   *  operator can see and fix. The ack says exactly what applied. */
  private async applyStockWrites(
    ctx: ConnectorContext,
    writes: StockWrite[],
    operation: string
  ): Promise<OperationResult<WriteAck[]>> {
    const acks: WriteAck[] = [];

    for (const write of writes) {
      if (write.kind === 'transfer') {
        acks.push(await this.applyTransfer(ctx, write, operation));
        continue;
      }

      const isReturn = (write.reason ?? '').toLowerCase().includes('devolu');
      const payload = buildTinyStockPayload(write, 1, isReturn);
      const ack = await this.sendStockPayload(ctx, write, payload, operation);
      acks.push(ack);
    }

    return ok(operation, acks);
  }

  /** Narrowed to TransferStockWrite rather than the union.
   *
   *  Origin, destination and quantity are required fields on that member, so the
   *  type guarantees they exist and the runtime null check they needed is gone.
   *  Taking the whole union here is what forced reading fields that may not be
   *  present — switching from a structural copy to the real interface is what
   *  surfaced it. */
  private async applyTransfer(
    ctx: ConnectorContext,
    write: TransferStockWrite,
    operation: string
  ): Promise<WriteAck> {
    const { legs } = buildTinyTransferLegs({
      productExternalId: write.productExternalId,
      fromLocationExternalId: write.fromLocationExternalId,
      toLocationExternalId: write.toLocationExternalId,
      quantity: write.quantity,
      idempotencyKey: write.idempotencyKey,
      reason: write.reason,
    });

    const outbound = await this.sendStockPayload(ctx, write, legs[0], operation);
    if (!outbound.ok) return outbound;

    const inbound = await this.sendStockPayload(ctx, write, legs[1], operation);
    if (!inbound.ok) {
      return {
        productExternalId: write.productExternalId,
        ok: false,
        pending: false,
        error: new IntegrationError({
          kind: inbound.error?.kind ?? 'UNKNOWN',
          // The operator has to know the exact half-applied state, because the
          // total is now understated by this quantity until it is fixed.
          message:
            `Transferência parcial: a saída de ${write.fromLocationExternalId} foi aplicada, ` +
            `mas a entrada em ${write.toLocationExternalId} falhou (${inbound.error?.message ?? 'motivo desconhecido'}). ` +
            `O saldo total está reduzido em ${write.quantity} unidades até que a entrada seja lançada.`,
          providerCode: inbound.error?.providerCode ?? null,
        }),
      };
    }

    return { productExternalId: write.productExternalId, ok: true, pending: false };
  }

  private async sendStockPayload(
    ctx: ConnectorContext,
    write: StockWrite,
    payload: TinyStockPayload,
    operation: string
  ): Promise<WriteAck> {
    // VERIFY the wrapper name and whether the current endpoint expects JSON or
    // XML in this parameter. Everything else in the payload is settled.
    const result = await this.call(
      ctx,
      TINY_ENDPOINTS.updateStock,
      { estoque: JSON.stringify({ estoque: payload }) },
      operation
    );

    if (!result.ok) {
      return {
        productExternalId: write.productExternalId,
        ok: false,
        pending: false,
        error: result.error,
      };
    }

    return { productExternalId: write.productExternalId, ok: true, pending: false };
  }
}
