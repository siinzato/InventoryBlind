import { describe, expect, it, vi } from 'vitest';
import {
  Capability,
  checkOperation,
  declaredCapabilities,
  hasCapability,
  isWriteOperation,
} from '../capabilities';
import {
  IntegrationError,
  errorFromHttp,
  kindFromHttpStatus,
  parseRetryAfter,
  toIntegrationError,
} from '../errors';
import {
  clampLimit,
  firstPage,
  isRunawayWalk,
  nextPageRequest,
  type PageInfo,
  type PageRequest,
} from '../pagination';
import { isOk, ok, fail, shouldThrottle, throttleDelayMs, unwrap } from '../result';
import { DEFAULT_RETRY_POLICY, decideRetry, policyFor, worstCaseTotalDelayMs } from '../retry';
import {
  buildCountAdjustment,
  isNoOpWrite,
  netEffect,
  preferredWriteKind,
  type StockWrite,
} from '../stockOperations';
import {
  normalizeBatch,
  normalizeOrder,
  normalizeProduct,
  normalizeStockLevel,
  normalizeWarehouse,
  readBoolean,
  readNumber,
  readNumberAs,
  readString,
} from '../normalizers';
import { buildReverseIndex, countAmbiguousReverse } from '../mappingEngine';
import { requiredCapabilitiesFor } from '../connectionTester';
import type { EntityLink, ProviderCapabilities } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Capabilities
// ─────────────────────────────────────────────────────────────────────────────

describe('capabilities', () => {
  const erp: ProviderCapabilities = {
    read_products: true,
    read_stock: true,
    write_adjustment: true,
  };

  it('treats an undeclared capability as unsupported rather than assumed', () => {
    expect(hasCapability(erp, Capability.READ_PRODUCTS)).toBe(true);
    expect(hasCapability(erp, Capability.WEBHOOKS)).toBe(false);
    expect(hasCapability({}, Capability.READ_STOCK)).toBe(false);
  });

  it('lists only what is declared', () => {
    expect(declaredCapabilities(erp)).toEqual([
      Capability.READ_PRODUCTS,
      Capability.READ_STOCK,
      Capability.STOCK_ADJUSTMENT,
    ]);
  });

  it('knows which operations mutate the provider', () => {
    expect(isWriteOperation('getProducts')).toBe(false);
    expect(isWriteOperation('createStockAdjustment')).toBe(true);
    expect(isWriteOperation('removeWebhook')).toBe(true);
  });

  it('blocks an operation the provider cannot perform', () => {
    const gate = checkOperation('getOrders', erp, 'bidirectional');
    expect(gate).toEqual({ allowed: false, reason: 'capability', missing: Capability.ORDERS });
  });

  it('blocks a write when the connection is configured inbound-only', () => {
    // The customer's setting wins over the provider's capability.
    const gate = checkOperation('createStockAdjustment', erp, 'inbound');
    expect(gate).toEqual({ allowed: false, reason: 'direction', direction: 'inbound' });
  });

  it('still allows reads on an outbound connection', () => {
    // Pulling a catalogue is a prerequisite for pushing anything, so an
    // outbound-only connection must still be able to look.
    expect(checkOperation('getProducts', erp, 'outbound')).toEqual({ allowed: true });
  });

  it('reports capability before direction so the reason is the precise one', () => {
    const gate = checkOperation('createWebhook', erp, 'inbound');
    expect(gate).toEqual({ allowed: false, reason: 'capability', missing: Capability.WEBHOOKS });
  });

  it('never gates testConnection on a capability', () => {
    expect(checkOperation('testConnection', {}, 'inbound')).toEqual({ allowed: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

describe('errors', () => {
  it('separates a wrong credential from an unpermitted one', () => {
    // Telling a customer to re-enter a working token wastes their time.
    expect(kindFromHttpStatus(401)).toBe('AUTH_INVALID');
    expect(kindFromHttpStatus(403)).toBe('PERMISSION_DENIED');
  });

  it('maps the temporary statuses to retryable kinds', () => {
    expect(new IntegrationError({ kind: kindFromHttpStatus(429), message: '' }).retryable).toBe(true);
    expect(new IntegrationError({ kind: kindFromHttpStatus(503), message: '' }).retryable).toBe(true);
    expect(new IntegrationError({ kind: kindFromHttpStatus(500), message: '' }).retryable).toBe(true);
    expect(new IntegrationError({ kind: kindFromHttpStatus(408), message: '' }).retryable).toBe(true);
  });

  it('maps the permanent statuses to non-retryable kinds', () => {
    for (const status of [400, 401, 403, 404, 409, 422, 501]) {
      const error = new IntegrationError({ kind: kindFromHttpStatus(status), message: '' });
      expect(error.retryable, `HTTP ${status}`).toBe(false);
    }
  });

  it('defaults an unrecognised failure to permanent', () => {
    // Retrying what we do not understand is how one bad request becomes a
    // thousand and an account gets suspended.
    const error = toIntegrationError(new Error('something odd'));
    expect(error.kind).toBe('UNKNOWN');
    expect(error.retryable).toBe(false);
  });

  it('classifies network and timeout failures as temporary', () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    expect(toIntegrationError(abort).kind).toBe('TIMEOUT');
    expect(toIntegrationError(new Error('ECONNRESET')).kind).toBe('NETWORK');
    expect(toIntegrationError(new Error('request timed out')).kind).toBe('TIMEOUT');
  });

  it('keeps an expired token out of the plain retry path', () => {
    // A plain retry would fail identically; the caller must refresh first.
    const error = new IntegrationError({ kind: 'AUTH_EXPIRED', message: '' });
    expect(error.retryable).toBe(false);
    expect(error.needsCredentialRefresh).toBe(true);
  });

  it('parses Retry-After in seconds and as a date', () => {
    expect(parseRetryAfter('30', 0)).toBe(30_000);
    const future = new Date(60_000).toUTCString();
    expect(parseRetryAfter(future, 0)).toBeGreaterThan(0);
  });

  it('never returns a negative wait for a past Retry-After date', () => {
    const past = new Date(1_000).toUTCString();
    expect(parseRetryAfter(past, 10_000_000)).toBe(0);
  });

  it('falls back to null for a malformed Retry-After', () => {
    expect(parseRetryAfter('soon', 0)).toBeNull();
    expect(parseRetryAfter('', 0)).toBeNull();
    expect(parseRetryAfter(null, 0)).toBeNull();
  });

  it('keeps request context out of the safe log', () => {
    const error = new IntegrationError({
      kind: 'VALIDATION',
      message: 'rejeitado',
      providerCode: '422',
      externalRequestId: 'req-1',
      details: { authorization: 'Bearer leaked' },
    });
    const log = error.toSafeLog();
    expect(log).toEqual({
      kind: 'VALIDATION',
      message: 'rejeitado',
      providerCode: '422',
      externalRequestId: 'req-1',
    });
    expect(JSON.stringify(log)).not.toContain('leaked');
  });

  it('carries Retry-After through errorFromHttp', () => {
    const error = errorFromHttp({ status: 429, retryAfterHeader: '12', nowMs: 0 });
    expect(error.kind).toBe('RATE_LIMITED');
    expect(error.retryAfterMs).toBe(12_000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Result object
// ─────────────────────────────────────────────────────────────────────────────

describe('result object', () => {
  const meta = { provider: 'tiny', operation: 'getProducts' };

  it('discriminates success from failure', () => {
    expect(isOk(ok([1], meta))).toBe(true);
    expect(isOk(fail(new IntegrationError({ kind: 'UNKNOWN', message: 'x' }), meta))).toBe(false);
  });

  it('unwrap throws the integration error, not a generic one', () => {
    const error = new IntegrationError({ kind: 'NOT_FOUND', message: 'sumiu' });
    expect(() => unwrap(fail(error, meta))).toThrow(error);
    expect(unwrap(ok('value', meta))).toBe('value');
  });

  it('throttles before walking into a predictable 429', () => {
    expect(shouldThrottle({ remaining: 2 })).toBe(true);
    expect(shouldThrottle({ remaining: 50 })).toBe(false);
  });

  it('treats an unknown remaining count as unknown, not as unlimited', () => {
    expect(shouldThrottle({})).toBe(false);
    expect(shouldThrottle(null)).toBe(false);
    expect(shouldThrottle({ remaining: null })).toBe(false);
  });

  it('prefers Retry-After over the reset window when computing the pause', () => {
    expect(throttleDelayMs({ retryAfterMs: 5_000, resetAt: 60_000 }, 0)).toBe(5_000);
    expect(throttleDelayMs({ resetAt: 60_000 }, 10_000)).toBe(50_000);
    expect(throttleDelayMs({}, 0)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Pagination
// ─────────────────────────────────────────────────────────────────────────────

describe('pagination', () => {
  it('builds the first request per strategy', () => {
    expect(firstPage('cursor', 50)).toEqual({ strategy: 'cursor', cursor: null, limit: 50 });
    expect(firstPage('page', 50)).toEqual({ strategy: 'page', page: 1, limit: 50 });
    expect(firstPage('offset', 50)).toEqual({ strategy: 'offset', offset: 0, limit: 50 });
  });

  it('clamps an absurd or missing limit', () => {
    expect(clampLimit(undefined)).toBe(100);
    expect(clampLimit(0)).toBe(100);
    expect(clampLimit(-5)).toBe(100);
    expect(clampLimit(10_000)).toBe(500);
    expect(clampLimit(37)).toBe(37);
  });

  it('advances each strategy', () => {
    const cursorInfo: PageInfo = { strategy: 'cursor', hasNext: true, nextCursor: 'c2', limit: 10 };
    expect(nextPageRequest({ strategy: 'cursor', cursor: 'c1', limit: 10 }, cursorInfo))
      .toEqual({ strategy: 'cursor', cursor: 'c2', limit: 10 });

    const pageInfo: PageInfo = { strategy: 'page', hasNext: true, limit: 10 };
    expect(nextPageRequest({ strategy: 'page', page: 1, limit: 10 }, pageInfo))
      .toEqual({ strategy: 'page', page: 2, limit: 10 });

    const offsetInfo: PageInfo = { strategy: 'offset', hasNext: true, limit: 10 };
    expect(nextPageRequest({ strategy: 'offset', offset: 0, limit: 10 }, offsetInfo))
      .toEqual({ strategy: 'offset', offset: 10, limit: 10 });
  });

  it('stops when hasNext is false even if a cursor came back', () => {
    // Several providers return a cursor on the final page; following it yields
    // the same page forever.
    const info: PageInfo = { strategy: 'cursor', hasNext: false, nextCursor: 'c2', limit: 10 };
    expect(nextPageRequest({ strategy: 'cursor', cursor: 'c1', limit: 10 }, info)).toBeNull();
  });

  it('stops when the provider repeats the same cursor', () => {
    const info: PageInfo = { strategy: 'cursor', hasNext: true, nextCursor: 'c1', limit: 10 };
    expect(nextPageRequest({ strategy: 'cursor', cursor: 'c1', limit: 10 }, info)).toBeNull();
  });

  it('stops when hasNext is true but nothing advances', () => {
    const noCursor: PageInfo = { strategy: 'cursor', hasNext: true, nextCursor: null, limit: 10 };
    expect(nextPageRequest({ strategy: 'cursor', cursor: 'c1', limit: 10 }, noCursor)).toBeNull();

    const backwards: PageInfo = { strategy: 'page', hasNext: true, nextPage: 1, limit: 10 };
    expect(nextPageRequest({ strategy: 'page', page: 3, limit: 10 }, backwards)).toBeNull();

    const stuck: PageInfo = { strategy: 'offset', hasNext: true, nextOffset: 10, limit: 10 };
    expect(nextPageRequest({ strategy: 'offset', offset: 10, limit: 10 } as PageRequest, stuck)).toBeNull();
  });

  it('bounds a provider that always claims another page', () => {
    expect(isRunawayWalk(999)).toBe(false);
    expect(isRunawayWalk(1000)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Retry
// ─────────────────────────────────────────────────────────────────────────────

describe('retry', () => {
  const noJitter = () => 0;

  it('never retries a permanent failure', () => {
    const error = new IntegrationError({ kind: 'VALIDATION', message: 'bad' });
    expect(decideRetry(error, 1, DEFAULT_RETRY_POLICY, noJitter))
      .toEqual({ retry: false, delayMs: 0, reason: 'permanent' });
  });

  it('retries a temporary failure with exponential backoff', () => {
    const error = new IntegrationError({ kind: 'PROVIDER_UNAVAILABLE', message: 'down' });
    expect(decideRetry(error, 1, DEFAULT_RETRY_POLICY, noJitter).delayMs).toBe(1000);
    expect(decideRetry(error, 2, DEFAULT_RETRY_POLICY, noJitter).delayMs).toBe(2000);
  });

  it('stops at the attempt ceiling', () => {
    const error = new IntegrationError({ kind: 'NETWORK', message: 'down' });
    expect(decideRetry(error, 3, DEFAULT_RETRY_POLICY, noJitter))
      .toEqual({ retry: false, delayMs: 0, reason: 'exhausted' });
  });

  it('honours Retry-After over computed backoff', () => {
    const error = new IntegrationError({ kind: 'RATE_LIMITED', message: '429', retryAfterMs: 7_500 });
    expect(decideRetry(error, 1, DEFAULT_RETRY_POLICY, noJitter).delayMs).toBe(7_500);
  });

  it('clamps a Retry-After that would park a worker invisibly', () => {
    const error = new IntegrationError({ kind: 'RATE_LIMITED', message: '429', retryAfterMs: 3_600_000 });
    expect(decideRetry(error, 1, DEFAULT_RETRY_POLICY, noJitter).delayMs).toBe(DEFAULT_RETRY_POLICY.maxDelayMs);
  });

  it('refuses to spin on an expired credential', () => {
    const error = new IntegrationError({ kind: 'AUTH_EXPIRED', message: 'expired' });
    expect(decideRetry(error, 1, DEFAULT_RETRY_POLICY, noJitter))
      .toEqual({ retry: false, delayMs: 0, reason: 'needs_refresh' });
  });

  it('adds jitter within the configured ratio', () => {
    const error = new IntegrationError({ kind: 'NETWORK', message: 'x' });
    const full = decideRetry(error, 1, DEFAULT_RETRY_POLICY, () => 1);
    expect(full.delayMs).toBe(1200); // 1000 + 1000 * 0.2
  });

  it('gives rate limits a longer leash than outages', () => {
    const rateLimited = new IntegrationError({ kind: 'RATE_LIMITED', message: '' });
    const outage = new IntegrationError({ kind: 'PROVIDER_UNAVAILABLE', message: '' });
    expect(policyFor(rateLimited).maxAttempts).toBeGreaterThan(policyFor(outage).maxAttempts);
  });

  it('has a bounded worst case', () => {
    expect(worstCaseTotalDelayMs(DEFAULT_RETRY_POLICY)).toBe(3000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Stock operations — the absolute/delta distinction
// ─────────────────────────────────────────────────────────────────────────────

describe('stock operations', () => {
  it('reports a delta effect directly', () => {
    const write: StockWrite = {
      kind: 'delta', productExternalId: 'e1', locationExternalId: null,
      deltaQuantity: -7, idempotencyKey: 'k',
    };
    expect(netEffect(write)).toBe(-7);
  });

  it('refuses to report an absolute effect it cannot know', () => {
    // Returning 0 would read as "no change" — the most misleading answer.
    const write: StockWrite = {
      kind: 'absolute', productExternalId: 'e1', locationExternalId: null,
      targetQuantity: 40, idempotencyKey: 'k',
    };
    expect(netEffect(write)).toBeNull();
  });

  it('computes an absolute effect when the prior balance is known', () => {
    const write: StockWrite = {
      kind: 'absolute', productExternalId: 'e1', locationExternalId: null,
      targetQuantity: 40, expectedCurrentQuantity: 55, idempotencyKey: 'k',
    };
    expect(netEffect(write)).toBe(-15);
  });

  it('treats a transfer as net zero across the company', () => {
    const write: StockWrite = {
      kind: 'transfer', productExternalId: 'e1', fromLocationExternalId: 'a',
      toLocationExternalId: 'b', quantity: 10, idempotencyKey: 'k',
    };
    expect(netEffect(write)).toBe(0);
  });

  it('signs movement effects by type', () => {
    const base = { productExternalId: 'e1', locationExternalId: null, quantity: 5, idempotencyKey: 'k' } as const;
    expect(netEffect({ ...base, kind: 'movement', movementType: 'in' })).toBe(5);
    expect(netEffect({ ...base, kind: 'movement', movementType: 'found' })).toBe(5);
    expect(netEffect({ ...base, kind: 'movement', movementType: 'out' })).toBe(-5);
    expect(netEffect({ ...base, kind: 'movement', movementType: 'loss' })).toBe(-5);
    expect(netEffect({ ...base, kind: 'movement', movementType: 'adjustment' })).toBeNull();
  });

  it('prefers the least destructive write the provider accepts', () => {
    expect(preferredWriteKind({ write_movement: true, write_adjustment: true, write_stock: true })).toBe('movement');
    expect(preferredWriteKind({ write_adjustment: true, write_stock: true })).toBe('delta');
    expect(preferredWriteKind({ write_stock: true })).toBe('absolute');
    expect(preferredWriteKind({})).toBeNull();
  });

  it('builds a count adjustment as a delta, preserving the sign', () => {
    const write = buildCountAdjustment({
      productExternalId: 'e1', locationExternalId: 'wh1',
      systemQuantity: 100, countedQuantity: 88,
      idempotencyKey: 'k', kind: 'delta',
    });
    expect(write).toMatchObject({ kind: 'delta', deltaQuantity: -12 });
  });

  it('builds a count adjustment as an absolute that records what it assumed', () => {
    const write = buildCountAdjustment({
      productExternalId: 'e1', locationExternalId: 'wh1',
      systemQuantity: 100, countedQuantity: 88,
      idempotencyKey: 'k', kind: 'absolute',
    });
    expect(write).toMatchObject({
      kind: 'absolute', targetQuantity: 88, expectedCurrentQuantity: 100,
    });
  });

  it('builds a count as an adjustment movement regardless of sign', () => {
    const negative = buildCountAdjustment({
      productExternalId: 'e1', locationExternalId: null,
      systemQuantity: 100, countedQuantity: 88, idempotencyKey: 'k', kind: 'movement',
    });
    expect(negative).toMatchObject({ kind: 'movement', movementType: 'adjustment', quantity: 12 });
  });

  it('refuses to express a count as a transfer', () => {
    // Nothing moved between locations; the number was simply wrong.
    expect(buildCountAdjustment({
      productExternalId: 'e1', locationExternalId: null,
      systemQuantity: 100, countedQuantity: 88, idempotencyKey: 'k', kind: 'transfer',
    })).toBeNull();
  });

  it('detects no-op writes so a 1.000-item count is not 1.000 calls', () => {
    expect(isNoOpWrite({ kind: 'delta', productExternalId: 'e', locationExternalId: null, deltaQuantity: 0, idempotencyKey: 'k' })).toBe(true);
    expect(isNoOpWrite({ kind: 'delta', productExternalId: 'e', locationExternalId: null, deltaQuantity: 1, idempotencyKey: 'k' })).toBe(false);
    expect(isNoOpWrite({ kind: 'absolute', productExternalId: 'e', locationExternalId: null, targetQuantity: 5, expectedCurrentQuantity: 5, idempotencyKey: 'k' })).toBe(true);
    expect(isNoOpWrite({ kind: 'absolute', productExternalId: 'e', locationExternalId: null, targetQuantity: 5, idempotencyKey: 'k' })).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Normalizers
// ─────────────────────────────────────────────────────────────────────────────

describe('field readers', () => {
  it('accepts numeric ids, which ERPs routinely send', () => {
    expect(readString({ id: 4821 }, 'id')).toBe('4821');
    expect(readString({ id: '  A-1 ' }, 'id')).toBe('A-1');
    expect(readString({ id: '   ' }, 'id')).toBeNull();
  });

  it('tries keys in order so one map covers provider variants', () => {
    expect(readString({ codigo: 'C1' }, 'sku', 'codigo')).toBe('C1');
  });

  it('parses pt-BR and en-US decimals', () => {
    expect(readNumber({ q: '1.234,56' }, 'q')).toBe(1234.56);
    expect(readNumber({ q: '1,234.56' }, 'q')).toBe(1234.56);
    expect(readNumber({ q: '40' }, 'q')).toBe(40);
    expect(readNumber({ q: 40 }, 'q')).toBe(40);
  });

  it('resolves a lone separator by group size, not by a blanket rule', () => {
    // Neither blanket rule is safe: every-dot-is-decimal turns the pt-BR "1.234"
    // into 1.234, and every-dot-is-thousands turns "1.5" into 15. Both are silent
    // 10x/1000x errors in a customer's stock.
    expect(readNumber({ q: '1.234' }, 'q')).toBe(1234);   // group of 3 -> thousands
    expect(readNumber({ q: '1.5' }, 'q')).toBe(1.5);      // group of 1 -> decimal
    expect(readNumber({ q: '1.23' }, 'q')).toBe(1.23);    // group of 2 -> decimal
    expect(readNumber({ q: '1.2345' }, 'q')).toBe(1.2345); // group of 4 -> decimal
    expect(readNumber({ q: '1234,5' }, 'q')).toBe(1234.5); // lone comma, same rule
    expect(readNumber({ q: '1,234' }, 'q')).toBe(1234);
  });

  it('lets a connector declare the provider convention instead of guessing', () => {
    // The only way to be exact on the genuinely ambiguous "12.345".
    expect(readNumberAs({ q: '12.345' }, 'dot-decimal', 'q')).toBe(12.345);
    expect(readNumberAs({ q: '12.345' }, 'comma-decimal', 'q')).toBe(12345);
    expect(readNumberAs({ q: '12,345' }, 'comma-decimal', 'q')).toBe(12.345);
    // auto resolves it as thousands, the commoner case in ERP exports.
    expect(readNumber({ q: '12.345' }, 'q')).toBe(12345);
  });

  it('rejects unparseable and non-finite numbers', () => {
    expect(readNumber({ q: 'abc' }, 'q')).toBeNull();
    expect(readNumber({ q: Number.NaN }, 'q')).toBeNull();
    expect(readNumber({ q: Infinity }, 'q')).toBeNull();
    expect(readNumber({}, 'q')).toBeNull();
  });

  it('reads the boolean dialects providers actually send', () => {
    expect(readBoolean({ a: 'S' }, 'a')).toBe(true);
    expect(readBoolean({ a: 'N' }, 'a')).toBe(false);
    expect(readBoolean({ a: 1 }, 'a')).toBe(true);
    expect(readBoolean({ a: 0 }, 'a')).toBe(false);
    expect(readBoolean({ a: 'ativo' }, 'a')).toBe(true);
    expect(readBoolean({ a: 'talvez' }, 'a')).toBeNull();
  });
});

describe('normalizeProduct', () => {
  const map = {
    externalId: ['id'],
    sku: ['codigo'],
    ean: ['gtin'],
    name: ['nome'],
    unitPrice: ['preco'],
    active: ['situacao'],
  };

  it('maps a provider payload to the internal shape', () => {
    const outcome = normalizeProduct(
      { id: 91, codigo: 'abc-1', gtin: '789-1234567895', nome: 'Caneca', preco: '19,90', situacao: 'A' },
      map
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value).toMatchObject({
      externalId: '91',
      sku: 'abc-1',
      ean: '7891234567895',
      name: 'Caneca',
      unitPrice: 19.9,
    });
  });

  it('rejects a record with no stable external id', () => {
    // Without one it cannot be linked, deduplicated or re-synced.
    const outcome = normalizeProduct({ codigo: 'abc-1' }, map);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.kind).toBe('NORMALIZATION_FAILED');
  });

  it('rejects a non-object payload instead of throwing', () => {
    expect(normalizeProduct(null, map).ok).toBe(false);
    expect(normalizeProduct('nope', map).ok).toBe(false);
    expect(normalizeProduct([1, 2], map).ok).toBe(false);
  });

  it('drops a malformed EAN rather than storing a colliding one', () => {
    const outcome = normalizeProduct({ id: '1', gtin: '789' }, map);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.ean).toBeNull();
  });

  it('drops a negative price, which is a provider bug not a discount', () => {
    const outcome = normalizeProduct({ id: '1', preco: '-5' }, map);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.unitPrice).toBeNull();
  });
});

describe('normalizeStockLevel', () => {
  const map = {
    productExternalId: ['produto_id'],
    warehouseExternalId: ['deposito_id'],
    quantity: ['saldo'],
    reserved: ['reservado'],
  };

  it('refuses to guess a missing quantity', () => {
    // Defaulting to 0 reads as "we have none of this" and can drive a purchase.
    const outcome = normalizeStockLevel({ produto_id: '1' }, map, '2026-01-01T00:00:00.000Z');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.externalId).toBe('1');
  });

  it('keeps reserved null when the provider does not report it', () => {
    const outcome = normalizeStockLevel({ produto_id: '1', saldo: '10' }, map, '2026-01-01T00:00:00.000Z');
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.reserved).toBeNull();
    expect(outcome.value.available).toBeNull();
  });

  it('derives available only when reserved is actually known', () => {
    const outcome = normalizeStockLevel(
      { produto_id: '1', saldo: '10', reservado: '3' }, map, '2026-01-01T00:00:00.000Z'
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.available).toBe(7);
  });

  it('falls back to the supplied observation time rather than inventing one', () => {
    const fallback = '2026-02-02T10:00:00.000Z';
    const outcome = normalizeStockLevel({ produto_id: '1', saldo: 1 }, map, fallback);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.observedAt).toBe(fallback);
  });

  it('accepts a zero balance as a real value', () => {
    const outcome = normalizeStockLevel({ produto_id: '1', saldo: 0 }, map, '2026-01-01T00:00:00.000Z');
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.quantity).toBe(0);
  });
});

describe('normalizeWarehouse and normalizeOrder', () => {
  it('normalises a warehouse', () => {
    const outcome = normalizeWarehouse({ id: 'D1', nome: 'CD São Paulo', padrao: 'S' }, {
      externalId: ['id'], name: ['nome'], isDefault: ['padrao'],
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value).toMatchObject({ externalId: 'D1', name: 'CD São Paulo', isDefault: true });
  });

  const orderMap = {
    externalId: ['id'],
    items: ['itens'],
    itemProductExternalId: ['produto_id'],
    itemQuantity: ['qtd'],
  };

  it('normalises an order and its items', () => {
    const outcome = normalizeOrder(
      { id: 'O1', itens: [{ produto_id: 'p1', qtd: 2 }, { produto_id: 'p2', qtd: '3' }] },
      orderMap
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.items).toHaveLength(2);
    expect(outcome.value.items[1].quantity).toBe(3);
  });

  it('drops unreadable items but keeps the order', () => {
    const outcome = normalizeOrder(
      { id: 'O1', itens: [{ produto_id: 'p1', qtd: 2 }, { qtd: 3 }, null] },
      orderMap
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.items).toHaveLength(1);
  });

  it('rejects an order whose every item is unreadable', () => {
    // It would count as processed while carrying no information.
    const outcome = normalizeOrder({ id: 'O1', itens: [{ qtd: 3 }] }, orderMap);
    expect(outcome.ok).toBe(false);
  });

  it('rejects an order with no item list at all', () => {
    expect(normalizeOrder({ id: 'O1' }, orderMap).ok).toBe(false);
  });
});

describe('normalizeBatch', () => {
  it('keeps good records and collects failures side by side', () => {
    // One bad record must not abort a page.
    const map = { externalId: ['id'] };
    const result = normalizeBatch(
      [{ id: '1' }, { nope: true }, { id: '3' }],
      payload => normalizeProduct(payload, map)
    );
    expect(result.values).toHaveLength(2);
    expect(result.failures).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mapping engine — pure parts
// ─────────────────────────────────────────────────────────────────────────────

describe('mapping engine indexes', () => {
  function link(externalId: string, internalId: string | null): EntityLink {
    return {
      id: `l-${externalId}`, connectionId: 'c1', entityType: 'product',
      internalId, externalId, externalSku: null, externalEan: null,
      externalName: null, matchSource: null, lastSyncedAt: null,
    };
  }

  it('builds a reverse index, skipping unlinked rows', () => {
    const index = new Map([
      ['e1', link('e1', 'p1')],
      ['e2', link('e2', null)],
    ]);
    const reverse = buildReverseIndex(index);
    expect(reverse.get('p1')).toBe('e1');
    expect(reverse.size).toBe(1);
  });

  it('counts internal rows claimed by more than one external record', () => {
    // A non-zero count means the outbound path has a decision to make.
    const index = new Map([
      ['e1', link('e1', 'p1')],
      ['e2', link('e2', 'p1')],
      ['e3', link('e3', 'p2')],
    ]);
    expect(countAmbiguousReverse(index)).toBe(1);
    expect(buildReverseIndex(index).get('p1')).toBe('e1');
  });

  it('reports no ambiguity for a clean index', () => {
    const index = new Map([['e1', link('e1', 'p1')], ['e2', link('e2', 'p2')]]);
    expect(countAmbiguousReverse(index)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Connection tester — required scopes
// ─────────────────────────────────────────────────────────────────────────────

describe('requiredCapabilitiesFor', () => {
  const full: ProviderCapabilities = {
    read_products: true, read_stock: true, write_adjustment: true, write_stock: true,
  };

  it('does not demand write scope from an inbound connection', () => {
    // Demanding it would fail a perfectly good read-only key.
    expect(requiredCapabilitiesFor('inbound', full)).toEqual([
      Capability.READ_PRODUCTS, Capability.READ_STOCK,
    ]);
  });

  it('demands a single write capability, the least destructive available', () => {
    expect(requiredCapabilitiesFor('outbound', full)).toEqual([Capability.STOCK_ADJUSTMENT]);
    expect(requiredCapabilitiesFor('outbound', { write_stock: true })).toEqual([Capability.WRITE_STOCK]);
    expect(requiredCapabilitiesFor('outbound', { write_movement: true })).toEqual([Capability.WRITE_MOVEMENT]);
  });

  it('demands both sides for a bidirectional connection', () => {
    expect(requiredCapabilitiesFor('bidirectional', full)).toEqual([
      Capability.READ_PRODUCTS, Capability.READ_STOCK, Capability.STOCK_ADJUSTMENT,
    ]);
  });

  it('demands nothing a provider cannot do', () => {
    expect(requiredCapabilitiesFor('bidirectional', {})).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Connector contract shape
// ─────────────────────────────────────────────────────────────────────────────

describe('connector contract', () => {
  it('detects an unimplemented operation separately from an undeclared one', async () => {
    const { implementsOperation } = await import('../connector');
    const partial = {
      providerKey: 'fake',
      capabilities: { read_orders: true } as ProviderCapabilities,
      pageStrategy: 'page' as const,
      testConnection: vi.fn(),
    };
    // The provider declares orders, but the connector has no getOrders yet:
    // that must read as "not supported yet", not as a runtime TypeError.
    expect(implementsOperation(partial as never, 'testConnection')).toBe(true);
    expect(implementsOperation(partial as never, 'getOrders')).toBe(false);
  });
});
