// Integration Engine — the connector contract.
//
// A connector is the only thing that knows a provider exists. It talks to the
// provider's API and returns that provider's own payloads wrapped in an
// OperationResult. It does not normalise, does not touch the database, does not
// know what a tenant is, and does not retry — the Adapter above it owns all four.
//
// That split is what makes connectors testable without a live account: a
// connector is a function of (context, request) -> result, and everything
// stateful lives elsewhere.
//
// Every operation is optional. A connector implements what its provider supports
// and declares the matching capability; the Adapter refuses the rest before a
// request is made. A read-only marketplace and a fully bidirectional ERP satisfy
// this same interface without either pretending to be the other.
//
// Type-only module plus two pure helpers: safe under browser and Deno.

import type { ProviderCapabilities, SyncDirection } from './types.ts';
import type { OperationResult } from './result.ts';
import type { PageRequest, PageStrategy } from './pagination.ts';
import type { StockWrite } from './stockOperations.ts';
import type { IntegrationError } from './errors.ts';

/** Everything needed to talk to one store, assembled server-side.
 *
 *  The secret enters here and goes no further up: nothing in this contract
 *  returns it, and no type above the connector carries it. */
export interface ConnectorContext {
  connectionId: string;
  /** Opaque credential material resolved from integration_credentials. An API
   *  key, an OAuth bundle as JSON — only the connector knows how to read it. */
  secret: string;
  externalAccountId: string | null;
  /** Non-secret per-connection settings from integration_connections.configuration. */
  configuration: Record<string, unknown>;
  /** Abort signal so a hung provider cannot pin a worker. */
  signal?: AbortSignal;
}

/** A raw provider record, still in the provider's own shape. The `unknown`
 *  payload is the point: it cannot be read without going through a normalizer,
 *  which is what keeps external field names out of the Core. */
export interface RawRecord {
  /** Provider's stable identifier, the one field a connector must always surface
   *  because it is the idempotency anchor for everything downstream. */
  externalId: string;
  payload: unknown;
}

export interface ListRequest {
  page: PageRequest;
  /** Incremental boundary, when the provider can filter by change time.
   *  Connectors that cannot must ignore it and rely on the cursor. */
  updatedSince?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Authentication
// ─────────────────────────────────────────────────────────────────────────────

/** Result of a credential exchange, for providers that need one (OAuth refresh,
 *  session tokens). Providers using a static API key do not implement
 *  `authenticate` at all. */
export interface AuthResult {
  /** Replacement credential to persist, in the connector's own opaque format.
   *  The Adapter writes it back through the write-only RPC; it is never returned
   *  to the browser. */
  secret: string;
  expiresAt?: string | null;
  externalAccountId?: string | null;
}

export interface ConnectionTestResult {
  ok: boolean;
  /** Discovered during the handshake. This is how external_account_id gets
   *  populated, and how two stores under one provider stay distinguishable. */
  externalAccountId: string | null;
  /** What the provider calls this account, for the UI. */
  accountName?: string | null;
  /** Scopes/permissions the credential actually has, when the provider reports
   *  them. Lets the tester say "this key cannot write stock" before a sync
   *  discovers it mid-run. */
  grantedScopes?: string[] | null;
  message: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Write outcomes
// ─────────────────────────────────────────────────────────────────────────────

export interface WriteAck {
  productExternalId: string;
  /** Provider's id for the created document, when it creates one. */
  externalOperationId?: string | null;
  ok: boolean;
  /** Structurally complete but not actually sent — no real credential yet, or a
   *  sandbox. Distinguishing this from a failure is what stops a half-built
   *  integration from looking like a broken one. Inherited from the Fase 1
   *  ErpAdapter contract, which already made this distinction. */
  pending: boolean;
  error?: IntegrationError | null;
}

export interface WebhookRegistration {
  externalWebhookId: string;
  topics: string[];
  callbackUrl: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// The contract
// ─────────────────────────────────────────────────────────────────────────────

export interface Connector {
  readonly providerKey: string;
  readonly capabilities: ProviderCapabilities;
  /** How this provider walks lists. The Adapter uses it to build the first page
   *  request; a connector never has to fake a scheme its API does not use. */
  readonly pageStrategy: PageStrategy;

  /** Exchange/refresh credentials. Absent for static-key providers. */
  authenticate?(ctx: ConnectorContext): Promise<OperationResult<AuthResult>>;

  /** Validate credential, identify the account, report scopes. Must not throw for
   *  an expected failure — return a failure result so the caller can record it. */
  testConnection(ctx: ConnectorContext): Promise<OperationResult<ConnectionTestResult>>;

  // ── Reads ────────────────────────────────────────────────────────────────
  getProducts?(ctx: ConnectorContext, request: ListRequest): Promise<OperationResult<RawRecord[]>>;
  getProduct?(ctx: ConnectorContext, externalId: string): Promise<OperationResult<RawRecord>>;
  getStock?(ctx: ConnectorContext, request: ListRequest): Promise<OperationResult<RawRecord[]>>;
  getStockByLocation?(ctx: ConnectorContext, request: ListRequest): Promise<OperationResult<RawRecord[]>>;
  /** Per-deposit balance for ONE product, read on demand.
   *
   *  Separate from getStockByLocation, which walks the whole catalogue. This is the
   *  read that happens immediately before a write, so the guard can compare the
   *  balance the plan assumed against the balance the provider holds right now. A
   *  full-catalogue walk cannot serve that: by the time it reached page 40 the
   *  page-1 balances would already be stale, which is precisely the drift the
   *  guard exists to catch.
   *
   *  Optional. A provider without it can still be written to, but then
   *  `verifiedCurrent` is null and the staleness rule carries the whole burden. */
  getProductStock?(ctx: ConnectorContext, externalId: string): Promise<OperationResult<RawRecord[]>>;
  getLocations?(ctx: ConnectorContext, request: ListRequest): Promise<OperationResult<RawRecord[]>>;
  getBrands?(ctx: ConnectorContext, request: ListRequest): Promise<OperationResult<RawRecord[]>>;
  getCategories?(ctx: ConnectorContext, request: ListRequest): Promise<OperationResult<RawRecord[]>>;
  getOrders?(ctx: ConnectorContext, request: ListRequest): Promise<OperationResult<RawRecord[]>>;
  getMovements?(ctx: ConnectorContext, request: ListRequest): Promise<OperationResult<RawRecord[]>>;

  // ── Writes ───────────────────────────────────────────────────────────────
  // Batched on purpose: providers rate-limit per request, not per record, so a
  // 1.000-SKU adjustment must not become 1.000 calls.
  updateStock?(ctx: ConnectorContext, writes: StockWrite[]): Promise<OperationResult<WriteAck[]>>;
  createStockAdjustment?(ctx: ConnectorContext, writes: StockWrite[]): Promise<OperationResult<WriteAck[]>>;
  createStockTransfer?(ctx: ConnectorContext, writes: StockWrite[]): Promise<OperationResult<WriteAck[]>>;
  createMovement?(ctx: ConnectorContext, writes: StockWrite[]): Promise<OperationResult<WriteAck[]>>;

  // ── Webhooks ─────────────────────────────────────────────────────────────
  createWebhook?(ctx: ConnectorContext, topics: string[], callbackUrl: string): Promise<OperationResult<WebhookRegistration>>;
  removeWebhook?(ctx: ConnectorContext, externalWebhookId: string): Promise<OperationResult<void>>;
  /** Signature check. Returning false must drop the event, never process it
   *  optimistically. Synchronous and pure so it can run before any I/O. */
  verifyWebhook?(secret: string, rawBody: string, headers: Record<string, string>): boolean;
}

/** Is the operation actually implemented by this connector instance?
 *
 *  Separate from the capability check: a provider may declare `read_orders` while
 *  the connector has not implemented `getOrders` yet. Both must hold, and
 *  conflating them produces a runtime "x is not a function" instead of a clear
 *  "not supported yet". */
export function implementsOperation(connector: Connector, operation: string): boolean {
  return typeof (connector as unknown as Record<string, unknown>)[operation] === 'function';
}

/** Coarse direction check kept from Fase 1 for callers that only need "can this
 *  connection read/write at all" — the per-operation gate lives in
 *  capabilities.checkOperation. */
export function supportsFlow(
  capabilities: ProviderCapabilities,
  connectionDirection: SyncDirection,
  flow: 'inbound' | 'outbound'
): boolean {
  const directionAllows = connectionDirection === 'bidirectional' || connectionDirection === flow;
  if (!directionAllows) return false;

  if (flow === 'inbound') {
    return Boolean(capabilities.read_products || capabilities.read_stock || capabilities.read_orders);
  }
  return Boolean(
    capabilities.write_stock ||
    capabilities.write_adjustment ||
    capabilities.write_transfer ||
    capabilities.write_movement
  );
}

/** Collapse per-record failures into the counters a sync run stores, without
 *  losing whether the pass as a whole failed. `partial` is a real outcome: a run
 *  that imported 900 of 1.000 records is neither a success nor a failure. */
export function summariseErrors(
  processed: number,
  errors: { message: string }[]
): { failed: number; status: 'success' | 'partial' | 'failed' } {
  const failed = errors.length;
  if (failed === 0) return { failed: 0, status: 'success' };
  if (failed >= processed && processed > 0) return { failed, status: 'failed' };
  return { failed, status: 'partial' };
}
