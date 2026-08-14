// Integration Engine — the Adapter.
//
//   Provider API -> Connector -> Adapter -> Normalizer -> InventoryBlind
//
// The Adapter is the only layer that knows about all three of: what the provider
// can do, what this connection is allowed to do, and what to do when a call
// fails. Connectors stay dumb and pure; the Core stays ignorant of providers.
//
// It owns exactly four responsibilities:
//   1. gate an operation on capability + direction before any I/O happens;
//   2. retry temporary failures, never permanent ones, with a ceiling;
//   3. respect the provider's own rate-limit signals instead of walking into a 429;
//   4. hand back normalised data plus honest counters.
//
// No database access: the Adapter returns results, the caller persists them. That
// keeps it testable with a fake connector and no Supabase.

import { checkOperation, type OperationName } from './capabilities.ts';
import { implementsOperation, type Connector, type ConnectorContext, type ListRequest, type RawRecord } from './connector.ts';
import { IntegrationError, toIntegrationError } from './errors.ts';
import { firstPage, isRunawayWalk, nextPageRequest, type PageRequest } from './pagination.ts';
import { fail, ok, shouldThrottle, throttleDelayMs, type OperationResult, type RateLimitInfo } from './result.ts';
import { decideRetry, policyFor, type RetryPolicy } from './retry.ts';
import type { SyncDirection } from './types.ts';

export interface AdapterOptions {
  connector: Connector;
  direction: SyncDirection;
  /** Injected so tests run instantly and a worker can cancel a wait. Production
   *  passes a real timer. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
  retryPolicy?: RetryPolicy;
  /** Called after every attempt, successful or not. This is where a caller wires
   *  logging without the Adapter needing to know what a log is. */
  onAttempt?: (event: AttemptEvent) => void;
}

export interface AttemptEvent {
  operation: OperationName;
  attempt: number;
  success: boolean;
  errorKind?: string;
  delayedMs?: number;
  rateLimit?: RateLimitInfo | null;
}

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export class ProviderAdapter {
  /** Public so the Sync Engine can invoke an operation by name without the
   *  Adapter having to re-declare all seventeen of them. Callers must still go
   *  through `execute`/`collect` to get gating and retry — reaching in and calling
   *  the connector directly bypasses both, which is the one misuse to watch for
   *  in review. */
  readonly connector: Connector;
  private readonly direction: SyncDirection;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly retryPolicy?: RetryPolicy;
  private readonly onAttempt?: (event: AttemptEvent) => void;

  constructor(options: AdapterOptions) {
    this.connector = options.connector;
    this.direction = options.direction;
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.retryPolicy = options.retryPolicy;
    this.onAttempt = options.onAttempt;
  }

  get providerKey(): string {
    return this.connector.providerKey;
  }

  /** Can this adapter perform the operation at all?
   *
   *  Three gates: the provider declares it, the connection's direction permits
   *  it, and the connector actually implements it. The third is separate because
   *  a declared-but-unimplemented operation should read as "not supported yet",
   *  not as a runtime "x is not a function". */
  can(operation: OperationName): boolean {
    const gate = checkOperation(operation, this.connector.capabilities, this.direction);
    if (!gate.allowed) return false;
    if (operation === 'testConnection' || operation === 'authenticate') {
      return implementsOperation(this.connector, operation);
    }
    return implementsOperation(this.connector, operation);
  }

  /** Why an operation is unavailable, as an error worth showing a user. */
  private gateError(operation: OperationName): IntegrationError | null {
    const gate = checkOperation(operation, this.connector.capabilities, this.direction);

    if (!gate.allowed && gate.reason === 'capability') {
      return new IntegrationError({
        kind: 'UNSUPPORTED_OPERATION',
        message: `O provedor ${this.connector.providerKey} não suporta esta operação.`,
        details: { operation, missingCapability: gate.missing },
      });
    }

    if (!gate.allowed && gate.reason === 'direction') {
      return new IntegrationError({
        kind: 'CONFIGURATION',
        message: 'Esta conexão está configurada apenas para leitura. Habilite a escrita para enviar dados ao provedor.',
        details: { operation, direction: gate.direction },
      });
    }

    if (!implementsOperation(this.connector, operation)) {
      return new IntegrationError({
        kind: 'UNSUPPORTED_OPERATION',
        message: `A operação ainda não foi implementada para ${this.connector.providerKey}.`,
        details: { operation },
      });
    }

    return null;
  }

  /** Run one connector operation with gating, retry and throttling.
   *
   *  The whole point of funnelling everything through here is that a connector
   *  author cannot forget the retry rules or the capability check — they are not
   *  the connector's job. */
  async execute<T>(
    operation: OperationName,
    call: () => Promise<OperationResult<T>>
  ): Promise<OperationResult<T>> {
    const gateError = this.gateError(operation);
    if (gateError) {
      return fail(gateError, { provider: this.connector.providerKey, operation });
    }

    let attempt = 0;
    let lastRateLimit: RateLimitInfo | null = null;

    for (;;) {
      attempt++;

      // Pause before a call the provider has already warned us about, rather than
      // spending an attempt on a predictable 429.
      if (shouldThrottle(lastRateLimit)) {
        const wait = throttleDelayMs(lastRateLimit, this.now());
        if (wait > 0) {
          this.onAttempt?.({ operation, attempt, success: false, errorKind: 'PRE_THROTTLE', delayedMs: wait, rateLimit: lastRateLimit });
          await this.sleep(wait);
        }
      }

      let result: OperationResult<T>;
      try {
        result = await call();
      } catch (thrown) {
        // A connector that throws instead of returning a failure is a bug, but it
        // must not take the run down with it.
        result = fail(toIntegrationError(thrown), {
          provider: this.connector.providerKey,
          operation,
        });
      }

      lastRateLimit = result.rateLimit ?? null;

      if (result.success) {
        this.onAttempt?.({ operation, attempt, success: true, rateLimit: lastRateLimit });
        return result;
      }

      const error = result.error;
      const decision = decideRetry(error, attempt, this.retryPolicy ?? policyFor(error), this.random);

      this.onAttempt?.({
        operation,
        attempt,
        success: false,
        errorKind: error.kind,
        delayedMs: decision.retry ? decision.delayMs : undefined,
        rateLimit: lastRateLimit,
      });

      if (!decision.retry) return result;
      await this.sleep(decision.delayMs);
    }
  }

  // ── Convenience wrappers ─────────────────────────────────────────────────

  async testConnection(ctx: ConnectorContext) {
    return this.execute('testConnection', () => this.connector.testConnection(ctx));
  }

  async authenticate(ctx: ConnectorContext) {
    return this.execute('authenticate', () => this.connector.authenticate!(ctx));
  }

  /** Walk every page of a list operation.
   *
   *  Stops on the first hard failure rather than continuing with a hole in the
   *  data: a partial catalogue silently treated as complete would let the mapping
   *  layer conclude that missing SKUs were deleted. Pages already fetched are
   *  still returned, flagged by `complete: false`, so the caller can record a
   *  partial run honestly.
   *
   *  `MAX_PAGES_PER_RUN` bounds a provider that always answers `hasNext: true`. */
  async collect(
    operation: OperationName,
    ctx: ConnectorContext,
    call: (ctx: ConnectorContext, request: ListRequest) => Promise<OperationResult<RawRecord[]>>,
    options: { limit?: number; updatedSince?: string | null } = {}
  ): Promise<{
    // RawRecord, not unknown: callers must reach `.payload` to normalise, which is
    // what stops the wrapper being handed to a normalizer that expects the
    // provider's own object. Typing this as unknown[] hid exactly that mistake.
    records: RawRecord[];
    complete: boolean;
    error: IntegrationError | null;
    pagesFetched: number;
  }> {
    const gateError = this.gateError(operation);
    if (gateError) return { records: [], complete: false, error: gateError, pagesFetched: 0 };

    const records: RawRecord[] = [];
    let request: PageRequest | null = firstPage(this.connector.pageStrategy, options.limit);
    let pagesFetched = 0;

    while (request !== null) {
      // Both annotations are explicit because `request` is reassigned from a
      // function of itself at the end of the loop, which TypeScript reads as a
      // circular inference without them.
      const currentRequest: PageRequest = request;
      const result: OperationResult<RawRecord[]> = await this.execute<RawRecord[]>(operation, () =>
        call(ctx, { page: currentRequest, updatedSince: options.updatedSince ?? null })
      );

      if (!result.success) {
        return { records, complete: false, error: result.error, pagesFetched };
      }

      records.push(...result.data);
      pagesFetched++;

      if (isRunawayWalk(pagesFetched)) {
        return {
          records,
          complete: false,
          error: new IntegrationError({
            kind: 'PROVIDER_UNAVAILABLE',
            message: 'O provedor não sinalizou o fim da paginação. Sincronização interrompida por segurança.',
            details: { pagesFetched, operation },
          }),
          pagesFetched,
        };
      }

      request = result.pagination ? nextPageRequest(currentRequest, result.pagination) : null;
    }

    return { records, complete: true, error: null, pagesFetched };
  }
}

/** Small helper for connectors: build a success result without repeating the
 *  provider/operation boilerplate on every return. */
export function connectorOk<T>(
  provider: string,
  operation: string,
  data: T,
  extra: Partial<Omit<OperationResult<T>, 'success' | 'data'>> = {}
): OperationResult<T> {
  return ok(data, { provider, operation, ...extra });
}

export function connectorFail<T = never>(
  provider: string,
  operation: string,
  error: IntegrationError,
  extra: Partial<Omit<OperationResult<T>, 'success' | 'error'>> = {}
): OperationResult<T> {
  return fail(error, { provider, operation, ...extra });
}
