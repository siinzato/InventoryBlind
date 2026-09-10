import { describe, expect, it } from 'vitest';
import { supportsFlow, summariseErrors } from '../connector';
import {
  buildStockWriteKey,
  hasMeaningfulChange,
  normalizeEan,
  normalizeSku,
  resolveMatch,
} from '../matching';
import { buildCredentialHint } from '../integrationService';
import type { ProviderCapabilities } from '../types';

describe('normalizeSku', () => {
  it('uppercases and trims so case/padding differences between providers match', () => {
    expect(normalizeSku('  abc-123 ')).toBe('ABC-123');
    expect(normalizeSku('ABC-123')).toBe('ABC-123');
  });

  it('treats blank as absent rather than as an empty-string key', () => {
    expect(normalizeSku('   ')).toBeNull();
    expect(normalizeSku('')).toBeNull();
    expect(normalizeSku(null)).toBeNull();
    expect(normalizeSku(undefined)).toBeNull();
  });
});

describe('normalizeEan', () => {
  it('strips separators providers add', () => {
    expect(normalizeEan('7-891234-567895')).toBe('7891234567895');
    expect(normalizeEan(' 7891234567895 ')).toBe('7891234567895');
  });

  it('accepts every real GTIN length', () => {
    expect(normalizeEan('12345670')).toBe('12345670');
    expect(normalizeEan('123456789012')).toBe('123456789012');
    expect(normalizeEan('1234567890123')).toBe('1234567890123');
    expect(normalizeEan('12345678901234')).toBe('12345678901234');
  });

  it('rejects a wrong-length value instead of trusting a truncated code', () => {
    // A truncated EAN is worse than a missing one: it can collide with a
    // different product and silently merge two catalogue rows.
    expect(normalizeEan('789123')).toBeNull();
    expect(normalizeEan('789123456789')).toBe('789123456789'); // 12 is valid (UPC-A)
    expect(normalizeEan('78912345678901234')).toBeNull();
    expect(normalizeEan('abc')).toBeNull();
  });
});

describe('resolveMatch', () => {
  const candidates = [
    { internalId: 'p1', sku: 'ABC-1', ean: '7891234567895' },
    { internalId: 'p2', sku: 'ABC-2', ean: '7891234567901' },
  ];

  it('prefers an existing external-id link over any other signal', () => {
    // This is what makes a re-run idempotent: even when SKU changed on the
    // provider side, the established link still wins.
    const outcome = resolveMatch(
      { externalId: 'ext-9', sku: 'ABC-2' },
      [{ externalId: 'ext-9', internalId: 'p1' }],
      candidates
    );
    expect(outcome).toEqual({ internalId: 'p1', source: 'external_id', ambiguous: false });
  });

  it('ignores a link row that exists but is not resolved yet', () => {
    const outcome = resolveMatch(
      { externalId: 'ext-9', sku: 'ABC-2' },
      [{ externalId: 'ext-9', internalId: null }],
      candidates
    );
    expect(outcome).toEqual({ internalId: 'p2', source: 'sku', ambiguous: false });
  });

  it('falls back to SKU, case-insensitively', () => {
    const outcome = resolveMatch({ externalId: 'ext-1', sku: 'abc-1' }, [], candidates);
    expect(outcome).toEqual({ internalId: 'p1', source: 'sku', ambiguous: false });
  });

  it('falls back to EAN only when SKU gives nothing', () => {
    const outcome = resolveMatch(
      { externalId: 'ext-1', sku: 'NOT-PRESENT', ean: '789-123456-7901' },
      [],
      candidates
    );
    expect(outcome).toEqual({ internalId: 'p2', source: 'ean', ambiguous: false });
  });

  it('refuses to guess when two rows share a SKU', () => {
    const dupes = [
      { internalId: 'p1', sku: 'SAME' },
      { internalId: 'p2', sku: 'SAME' },
    ];
    const outcome = resolveMatch({ externalId: 'ext-1', sku: 'SAME' }, [], dupes);
    expect(outcome).toEqual({ internalId: null, source: 'sku', ambiguous: true });
  });

  it('refuses to guess when two rows share an EAN', () => {
    // Legitimate case: the same manufactured product held as two internal rows.
    const dupes = [
      { internalId: 'p1', ean: '7891234567895' },
      { internalId: 'p2', ean: '7891234567895' },
    ];
    const outcome = resolveMatch({ externalId: 'ext-1', ean: '7891234567895' }, [], dupes);
    expect(outcome).toEqual({ internalId: null, source: 'ean', ambiguous: true });
  });

  it('returns unmatched rather than inventing a link', () => {
    const outcome = resolveMatch({ externalId: 'ext-x', sku: 'NOPE', ean: null }, [], candidates);
    expect(outcome).toEqual({ internalId: null, source: null, ambiguous: false });
  });

  it('never matches on name', () => {
    const outcome = resolveMatch(
      { externalId: 'ext-1', name: 'Produto Um' },
      [],
      [{ internalId: 'p1', sku: 'ABC-1' }]
    );
    expect(outcome.internalId).toBeNull();
  });
});

describe('buildStockWriteKey', () => {
  const base = {
    connectionId: 'conn-1',
    productExternalId: 'ext-1',
    warehouseExternalId: 'wh-1',
    scope: 'session-9',
  };

  it('is deterministic, so a retry collapses onto the same key', () => {
    expect(buildStockWriteKey(base)).toBe(buildStockWriteKey({ ...base }));
  });

  it('separates two different count sessions for the same SKU', () => {
    // Legitimately repeated work, not a retry — must not be deduplicated.
    expect(buildStockWriteKey(base)).not.toBe(buildStockWriteKey({ ...base, scope: 'session-10' }));
  });

  it('separates warehouses, and gives a missing warehouse a stable placeholder', () => {
    expect(buildStockWriteKey(base)).not.toBe(
      buildStockWriteKey({ ...base, warehouseExternalId: 'wh-2' })
    );
    expect(buildStockWriteKey({ ...base, warehouseExternalId: null })).toBe(
      'conn-1:ext-1:_:session-9'
    );
  });

  it('separates connections, so two stores never share a key', () => {
    expect(buildStockWriteKey(base)).not.toBe(
      buildStockWriteKey({ ...base, connectionId: 'conn-2' })
    );
  });
});

describe('hasMeaningfulChange', () => {
  it('treats a never-seen record as changed', () => {
    expect(hasMeaningfulChange(null, { externalId: 'e1', sku: 'A' })).toBe(true);
  });

  it('ignores formatting-only differences', () => {
    const previous = { externalSku: 'abc-1', externalEan: '789-1234567895', externalName: 'Um' };
    expect(hasMeaningfulChange(previous, { externalId: 'e1', sku: 'ABC-1', ean: '7891234567895', name: 'Um' }))
      .toBe(false);
  });

  it('detects a real SKU change', () => {
    const previous = { externalSku: 'ABC-1', externalEan: null, externalName: 'Um' };
    expect(hasMeaningfulChange(previous, { externalId: 'e1', sku: 'ABC-2', name: 'Um' })).toBe(true);
  });

  it('detects a name change', () => {
    const previous = { externalSku: 'ABC-1', externalEan: null, externalName: 'Um' };
    expect(hasMeaningfulChange(previous, { externalId: 'e1', sku: 'ABC-1', name: 'Dois' })).toBe(true);
  });
});

describe('supportsFlow', () => {
  const bidirectional: ProviderCapabilities = {
    read_products: true,
    read_stock: true,
    write_stock: true,
    write_adjustment: true,
  };
  const readOnly: ProviderCapabilities = { read_products: true, read_stock: true };

  it('allows both flows for a bidirectional provider set to bidirectional', () => {
    expect(supportsFlow(bidirectional, 'bidirectional', 'inbound')).toBe(true);
    expect(supportsFlow(bidirectional, 'bidirectional', 'outbound')).toBe(true);
  });

  it('lets the connection configuration veto a capable provider', () => {
    // The customer's setting wins over the provider's capability, never the
    // other way round: an ERP set to inbound must not be written to.
    expect(supportsFlow(bidirectional, 'inbound', 'outbound')).toBe(false);
    expect(supportsFlow(bidirectional, 'outbound', 'inbound')).toBe(false);
  });

  it('refuses a flow the provider cannot perform even when configured for it', () => {
    expect(supportsFlow(readOnly, 'bidirectional', 'outbound')).toBe(false);
    expect(supportsFlow(readOnly, 'outbound', 'outbound')).toBe(false);
  });

  it('refuses everything for a provider with no declared capabilities', () => {
    expect(supportsFlow({}, 'bidirectional', 'inbound')).toBe(false);
    expect(supportsFlow({}, 'bidirectional', 'outbound')).toBe(false);
  });
});

describe('summariseErrors', () => {
  it('reports success when nothing failed', () => {
    expect(summariseErrors(10, [])).toEqual({ failed: 0, status: 'success' });
  });

  it('reports partial when some records failed', () => {
    // A pass that imported 9 of 10 is neither a success nor a failure, and
    // flattening it to either one loses the fact worth acting on.
    const errors = [{ externalId: 'e1', message: 'boom', retryable: true }];
    expect(summariseErrors(10, errors)).toEqual({ failed: 1, status: 'partial' });
  });

  it('reports failed when every record failed', () => {
    const errors = [
      { externalId: 'e1', message: 'boom', retryable: true },
      { externalId: 'e2', message: 'boom', retryable: true },
    ];
    expect(summariseErrors(2, errors)).toEqual({ failed: 2, status: 'failed' });
  });

  it('reports partial when errors arrive with nothing processed', () => {
    // Guards the 0-processed edge case away from a divide-by-zero style verdict.
    const errors = [{ externalId: null, message: 'auth', retryable: false }];
    expect(summariseErrors(0, errors)).toEqual({ failed: 1, status: 'partial' });
  });
});

describe('buildCredentialHint', () => {
  it('reveals only the last four characters', () => {
    expect(buildCredentialHint('abcdef123456')).toBe('••••3456');
  });

  it('fully masks a short value instead of revealing most of it', () => {
    expect(buildCredentialHint('abcd')).toBe('••••');
    expect(buildCredentialHint('')).toBe('••••');
  });

  it('never returns the secret itself', () => {
    const secret = 'super-secret-token-value';
    expect(buildCredentialHint(secret)).not.toContain('super');
    expect(buildCredentialHint(secret).length).toBeLessThan(secret.length);
  });
});
