import { describe, expect, it } from 'vitest';
import {
  TINY_CAPABILITIES,
  TINY_PRODUCT_FIELD_MAP,
  TINY_STOCK_FIELD_MAP,
  buildTinyStockPayload,
  extractTinyErrorMessage,
  extractTinyStockRows,
  parseTinyResponse,
  prepareTinyProduct,
  tinyMovementType,
  tinyPageInfo,
  unwrapTinyList,
} from '../tinyProtocol';
import { normalizeProduct, normalizeStockLevel } from '../../../normalizers';
import { aggregateStockByProduct } from '../../../sync/stockAggregation';

// ─────────────────────────────────────────────────────────────────────────────
// The envelope — the single most important behaviour in this provider
// ─────────────────────────────────────────────────────────────────────────────

describe('parseTinyResponse', () => {
  it('accepts a genuine success', () => {
    const parsed = parseTinyResponse({ retorno: { status: 'OK', produtos: [] } }, 200);
    expect(parsed.ok).toBe(true);
    expect(parsed.error).toBeNull();
  });

  it('treats HTTP 200 with status Erro as a failure', () => {
    // This is the bug that mattered: the previous stub checked response.ok and
    // would have reported a rejected stock adjustment as confirmed.
    const parsed = parseTinyResponse(
      { retorno: { status: 'Erro', codigo_erro: '4', erros: ['Quantidade inválida'] } },
      200
    );
    expect(parsed.ok).toBe(false);
    expect(parsed.error?.kind).toBe('VALIDATION');
    expect(parsed.error?.message).toBe('Quantidade inválida');
  });

  it('never retries an invalid token', () => {
    const parsed = parseTinyResponse({ retorno: { status: 'Erro', codigo_erro: '1' } }, 200);
    expect(parsed.error?.kind).toBe('AUTH_INVALID');
    expect(parsed.error?.retryable).toBe(false);
  });

  it('retries a rate limit', () => {
    const parsed = parseTinyResponse({ retorno: { status: 'Erro', codigo_erro: '20' } }, 200);
    expect(parsed.error?.kind).toBe('RATE_LIMITED');
    expect(parsed.error?.retryable).toBe(true);
  });

  it('separates a blocked account from a bad credential', () => {
    const parsed = parseTinyResponse({ retorno: { status: 'Erro', codigo_erro: '30' } }, 200);
    expect(parsed.error?.kind).toBe('PERMISSION_DENIED');
  });

  it('treats an absent status as failure rather than assuming success', () => {
    const parsed = parseTinyResponse({ retorno: { produtos: [] } }, 200);
    expect(parsed.ok).toBe(false);
  });

  it('classifies a 5xx with no envelope as a provider outage, so it is retried', () => {
    const parsed = parseTinyResponse('<html>502 Bad Gateway</html>', 502);
    expect(parsed.ok).toBe(false);
    expect(parsed.error?.kind).toBe('PROVIDER_UNAVAILABLE');
    expect(parsed.error?.retryable).toBe(true);
  });

  it('classifies a malformed 200 body as unknown, so it is NOT retried', () => {
    const parsed = parseTinyResponse('not json at all', 200);
    expect(parsed.error?.kind).toBe('UNKNOWN');
    expect(parsed.error?.retryable).toBe(false);
  });

  it('maps an unknown error code to validation rather than to unknown', () => {
    // An unrecognised Tiny code is still an application-level rejection, and
    // retrying it would repeat the same rejection.
    const parsed = parseTinyResponse({ retorno: { status: 'Erro', codigo_erro: '999' } }, 200);
    expect(parsed.error?.kind).toBe('VALIDATION');
    expect(parsed.error?.retryable).toBe(false);
  });
});

describe('extractTinyErrorMessage', () => {
  it('reads every shape Tiny sends errors in', () => {
    expect(extractTinyErrorMessage('falhou')).toBe('falhou');
    expect(extractTinyErrorMessage(['a', 'b'])).toBe('a; b');
    expect(extractTinyErrorMessage([{ erro: 'sem saldo' }])).toBe('sem saldo');
    expect(extractTinyErrorMessage({ erro: 'token expirado' })).toBe('token expirado');
  });

  it('falls back to a readable sentence instead of [object Object]', () => {
    expect(extractTinyErrorMessage(null)).toContain('sem detalhar');
    expect(extractTinyErrorMessage([{ outro: 1 }])).toContain('sem detalhar');
    expect(extractTinyErrorMessage([])).toContain('sem detalhar');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Pagination
// ─────────────────────────────────────────────────────────────────────────────

describe('tinyPageInfo', () => {
  it('walks while pages remain', () => {
    expect(tinyPageInfo({ numero_paginas: 3 }, 1, 100, 100)).toMatchObject({ hasNext: true, nextPage: 2 });
    expect(tinyPageInfo({ numero_paginas: 3 }, 3, 100, 40)).toMatchObject({ hasNext: false, nextPage: null });
  });

  it('infers the end from an empty page when the total is missing', () => {
    // Stops one page late rather than truncating, which is the safe direction.
    expect(tinyPageInfo({}, 1, 100, 100)).toMatchObject({ hasNext: true });
    expect(tinyPageInfo({}, 2, 100, 0)).toMatchObject({ hasNext: false });
  });

  it('ignores a nonsense page total', () => {
    expect(tinyPageInfo({ numero_paginas: 'abc' }, 1, 100, 50)).toMatchObject({ hasNext: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Record extraction
// ─────────────────────────────────────────────────────────────────────────────

describe('unwrapTinyList', () => {
  it('unwraps the single-key wrapper Tiny puts around every item', () => {
    const rows = unwrapTinyList(
      { produtos: [{ produto: { id: '1' } }, { produto: { id: '2' } }] },
      'produtos',
      'produto'
    );
    expect(rows).toEqual([{ id: '1' }, { id: '2' }]);
  });

  it('tolerates an already-unwrapped list', () => {
    expect(unwrapTinyList({ produtos: [{ id: '1' }] }, 'produtos', 'produto')).toEqual([{ id: '1' }]);
  });

  it('returns empty for a missing or non-array list', () => {
    expect(unwrapTinyList({}, 'produtos', 'produto')).toEqual([]);
    expect(unwrapTinyList({ produtos: 'nope' }, 'produtos', 'produto')).toEqual([]);
  });
});

describe('extractTinyStockRows', () => {
  it('flattens the deposit list into one row per deposit', () => {
    const rows = extractTinyStockRows(
      {
        produto: {
          depositos: [
            { deposito: { nome: 'CD-SP', saldo: 80, empenho: 5, desconsiderar: 'N' } },
            { deposito: { nome: 'CD-RJ', saldo: 30, empenho: 0, desconsiderar: 'N' } },
          ],
        },
      },
      'p-1'
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ produto_id: 'p-1', deposito: 'CD-SP', saldo: 80, empenho: 5 });
  });

  it('skips a deposit flagged desconsiderar, which would overstate stock', () => {
    // Including it is the direction of error that causes overselling.
    const rows = extractTinyStockRows(
      {
        produto: {
          depositos: [
            { deposito: { nome: 'CD-SP', saldo: 80, desconsiderar: 'N' } },
            { deposito: { nome: 'Avaria', saldo: 500, desconsiderar: 'S' } },
          ],
        },
      },
      'p-1'
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].deposito).toBe('CD-SP');
  });

  it('falls back to a flat saldo as a single unnamed deposit', () => {
    const rows = extractTinyStockRows({ produto: { saldo: 12 } }, 'p-1');
    expect(rows).toEqual([{ produto_id: 'p-1', deposito: '', saldo: 12, empenho: null }]);
  });

  it('returns empty rather than throwing on an unexpected shape', () => {
    expect(extractTinyStockRows({}, 'p-1')).toEqual([]);
    expect(extractTinyStockRows({ produto: 'nope' }, 'p-1')).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// End to end through the real normalizers, with no network
// ─────────────────────────────────────────────────────────────────────────────

describe('Tiny payload through the engine normalizers', () => {
  it('normalises a real-shaped Tiny product', () => {
    const outcome = normalizeProduct(
      prepareTinyProduct({
        id: '772034512',
        codigo: 'CAN-001',
        nome: 'Caneca Branca 300ml',
        gtin: '7891234567895',
        preco: '19,90',
        situacao: 'A',
      }),
      TINY_PRODUCT_FIELD_MAP
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value).toMatchObject({
      externalId: '772034512',
      sku: 'CAN-001',
      ean: '7891234567895',
      unitPrice: 19.9,
      active: true,
    });
  });

  it('normalises deposits and sums them into one balance', () => {
    const rows = extractTinyStockRows(
      {
        produto: {
          depositos: [
            { deposito: { nome: 'CD-SP', saldo: '80', empenho: '5', desconsiderar: 'N' } },
            { deposito: { nome: 'CD-RJ', saldo: '30', empenho: '0', desconsiderar: 'N' } },
          ],
        },
      },
      '772034512'
    );

    const levels = rows.map(row => {
      const outcome = normalizeStockLevel(row, TINY_STOCK_FIELD_MAP, '2026-01-01T00:00:00.000Z');
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error('unreachable');
      return outcome.value;
    });

    const [aggregated] = aggregateStockByProduct(levels);
    expect(aggregated.total.quantity).toBe(110);
    expect(aggregated.total.reserved).toBe(5);
    // available = saldo - empenho, derived per deposit then summed.
    expect(aggregated.total.available).toBe(105);
    expect(aggregated.breakdown).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Stock write payload — absolute vs delta on the wire
// ─────────────────────────────────────────────────────────────────────────────

describe('tinyMovementType', () => {
  it('maps an absolute write to balanço', () => {
    expect(tinyMovementType({ kind: 'absolute' })).toBe('B');
  });

  it('maps a delta to entrada or saída by sign', () => {
    expect(tinyMovementType({ kind: 'delta', deltaQuantity: 6 })).toBe('E');
    expect(tinyMovementType({ kind: 'delta', deltaQuantity: -6 })).toBe('S');
    expect(tinyMovementType({ kind: 'delta', deltaQuantity: 0 })).toBe('E');
  });
});

describe('buildTinyStockPayload', () => {
  it('sends the counted balance for an absolute write', () => {
    const payload = buildTinyStockPayload({
      kind: 'absolute',
      productExternalId: '772034512',
      locationExternalId: 'CD-SP',
      targetQuantity: 94,
      reason: 'Contagem física #128',
    });
    expect(payload).toMatchObject({
      id_produto: '772034512', deposito: 'CD-SP', tipo: 'B', quantidade: 94,
      observacoes: 'Contagem física #128',
    });
  });

  it('always sends a positive quantity, with direction carried by tipo', () => {
    // A negative quantity alongside tipo 'S' would double the sign and remove
    // twice what was intended.
    const payload = buildTinyStockPayload({
      kind: 'delta', productExternalId: '1', deltaQuantity: -6,
    });
    expect(payload.tipo).toBe('S');
    expect(payload.quantidade).toBe(6);
  });

  it('sends entrada for a positive delta', () => {
    const payload = buildTinyStockPayload({ kind: 'delta', productExternalId: '1', deltaQuantity: 6 });
    expect(payload).toMatchObject({ tipo: 'E', quantidade: 6 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Capabilities
// ─────────────────────────────────────────────────────────────────────────────

describe('TINY_CAPABILITIES', () => {
  it('declares both write shapes, because the API accepts both', () => {
    expect(TINY_CAPABILITIES.write_stock).toBe(true);      // tipo B
    expect(TINY_CAPABILITIES.write_adjustment).toBe(true); // tipo E/S
  });

  it('does not declare webhooks, so incremental sync polls instead of waiting', () => {
    expect(TINY_CAPABILITIES.webhooks).toBe(false);
  });

  it('declares reserved stock, which empenho provides', () => {
    expect(TINY_CAPABILITIES.read_reserved_stock).toBe(true);
  });

  it('declares transfer, which the connector achieves with two ordered movements', () => {
    // The capability describes what InventoryBlind can accomplish through this
    // provider, not how many HTTP calls it takes.
    expect(TINY_CAPABILITIES.write_transfer).toBe(true);
  });

  it('does not declare typed movement documents, which v2 has no endpoint for', () => {
    expect(TINY_CAPABILITIES.write_movement).toBeUndefined();
  });
});

describe('prepareTinyProduct', () => {
  it('translates Tiny situacao letters into a real boolean', () => {
    expect((prepareTinyProduct({ situacao: 'A' }) as Record<string, unknown>).ativo).toBe(true);
    expect((prepareTinyProduct({ situacao: 'I' }) as Record<string, unknown>).ativo).toBe(false);
  });

  it('leaves an unrecognised situacao undefined instead of defaulting to active', () => {
    // A product wrongly marked active is one that keeps being counted and sold.
    expect((prepareTinyProduct({ situacao: 'X' }) as Record<string, unknown>).ativo).toBeUndefined();
    expect((prepareTinyProduct({}) as Record<string, unknown>).ativo).toBeUndefined();
  });

  it('passes non-objects through untouched', () => {
    expect(prepareTinyProduct(null)).toBeNull();
    expect(prepareTinyProduct('x')).toBe('x');
  });
});

describe('devolução as Tiny DV', () => {
  it('records a customer return as DV, not as a plain entrada', async () => {
    // Using 'E' would put the units back on the balance while losing the reason —
    // the exact field an accountant reconciles returns against.
    const { tinyMovementType } = await import('../tinyProtocol');
    expect(tinyMovementType({ kind: 'delta', deltaQuantity: 5 }, true)).toBe('DV');
    expect(tinyMovementType({ kind: 'delta', deltaQuantity: 5 }, false)).toBe('E');
  });

  it('never turns a decrease into a DV, whatever the caller claims', async () => {
    const { tinyMovementType } = await import('../tinyProtocol');
    expect(tinyMovementType({ kind: 'delta', deltaQuantity: -5 }, true)).toBe('S');
  });

  it('builds the DV payload with a positive quantity', async () => {
    const payload = buildTinyStockPayload(
      { kind: 'delta', productExternalId: '772034512', locationExternalId: 'GERAL', deltaQuantity: 3, reason: 'Devolução pedido 9912' },
      1,
      true
    );
    expect(payload).toMatchObject({
      tipo: 'DV', quantidade: 3, deposito: 'GERAL', observacoes: 'Devolução pedido 9912',
    });
  });

  it('leaves an absolute write as balanço even when flagged a return', async () => {
    const { tinyMovementType } = await import('../tinyProtocol');
    expect(tinyMovementType({ kind: 'absolute' }, true)).toBe('B');
  });
});
