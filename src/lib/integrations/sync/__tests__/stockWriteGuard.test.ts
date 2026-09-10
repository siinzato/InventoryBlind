import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WRITE_LIMITS,
  MOVEMENT_DIRECTION,
  buildReturnWrite,
  buildFullWithdrawalTransfer,
  buildWithdrawalWrite,
  describeRejection,
  guardBatch,
  guardStockWrite,
  isOverridable,
  projectedBalance,
  type GuardInput,
  type MovementReason,
} from '../stockWriteGuard';
import type { StockWrite } from '../../stockOperations';

const NOW = Date.parse('2026-08-14T12:00:00.000Z');
const FRESH = '2026-08-14T11:58:00.000Z';

function delta(deltaQuantity: number, locationExternalId: string | null = 'CD-SP'): StockWrite {
  return {
    kind: 'delta',
    productExternalId: 'e1',
    locationExternalId,
    deltaQuantity,
    idempotencyKey: 'k1',
  };
}

function absolute(
  targetQuantity: number,
  expectedCurrentQuantity: number | null = null,
  locationExternalId: string | null = 'CD-SP'
): StockWrite {
  return {
    kind: 'absolute',
    productExternalId: 'e1',
    locationExternalId,
    targetQuantity,
    expectedCurrentQuantity,
    idempotencyKey: 'k1',
  };
}

function input(over: Partial<GuardInput> = {}): GuardInput {
  return {
    write: delta(-6),
    reason: 'count_adjustment',
    assumedCurrent: 100,
    verifiedCurrent: 100,
    warehouseCount: 1,
    observedAt: FRESH,
    nowMs: NOW,
    ...over,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The destructive case: absolute write over multiple deposits
// ─────────────────────────────────────────────────────────────────────────────

describe('absolute writes and multiple deposits', () => {
  it('refuses an absolute write when the product spans deposits and none is named', () => {
    // Tiny would apply the summed total to its default deposit and the others
    // would be silently wrong. This is the most destructive case in the file.
    const verdict = guardStockWrite(
      input({ write: absolute(110, 100, null), warehouseCount: 2 })
    );
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) return;
    expect(verdict.rejection.code).toBe('absolute_multi_warehouse');
  });

  it('allows an absolute write when the deposit is named, even with several deposits', () => {
    const verdict = guardStockWrite(
      input({ write: absolute(110, 100, 'CD-SP'), warehouseCount: 3 })
    );
    expect(verdict.allowed).toBe(true);
  });

  it('allows an absolute write on a single-deposit product', () => {
    const verdict = guardStockWrite(input({ write: absolute(110, 100, null), warehouseCount: 1 }));
    expect(verdict.allowed).toBe(true);
  });

  it('refuses an absolute write with no belief about the current balance', () => {
    // Without it, drift cannot be detected and the result is unverifiable.
    const verdict = guardStockWrite(input({ write: absolute(110, null) }));
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) return;
    expect(verdict.rejection.code).toBe('absolute_without_expected');
  });

  it('never lets a multi-deposit absolute write be waved through by a human', () => {
    // Approving it would still destroy the other deposits.
    expect(isOverridable({ code: 'absolute_multi_warehouse', warehouses: 2 })).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Drift and staleness
// ─────────────────────────────────────────────────────────────────────────────

describe('drift detection', () => {
  it('refuses when the provider balance moved between planning and writing', () => {
    // A delta computed against 100 applied to a balance of 94 is wrong by exactly
    // the drift, and nothing downstream would notice.
    const verdict = guardStockWrite(input({ assumedCurrent: 100, verifiedCurrent: 94 }));
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) return;
    expect(verdict.rejection).toEqual({ code: 'stale_balance', assumed: 100, actual: 94 });
  });

  it('allows the write when verification confirms the assumption', () => {
    expect(guardStockWrite(input({ assumedCurrent: 100, verifiedCurrent: 100 })).allowed).toBe(true);
  });

  it('proceeds when verification was not possible, leaning on the staleness rule', () => {
    expect(guardStockWrite(input({ verifiedCurrent: null })).allowed).toBe(true);
  });

  it('refuses a decision based on a balance read too long ago', () => {
    const verdict = guardStockWrite(
      input({ verifiedCurrent: null, observedAt: '2026-08-14T11:00:00.000Z' })
    );
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) return;
    expect(verdict.rejection.code).toBe('observation_too_old');
  });

  it('accepts a read inside the freshness window', () => {
    expect(guardStockWrite(input({ verifiedCurrent: null, observedAt: FRESH })).allowed).toBe(true);
  });

  it('checks drift before magnitude, so a stale base is never judged on size', () => {
    // Both rules would fire; the drift reason is the actionable one.
    const verdict = guardStockWrite(
      input({ write: delta(100_000), assumedCurrent: 100, verifiedCurrent: 94 })
    );
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) return;
    expect(verdict.rejection.code).toBe('stale_balance');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The asymmetry: increases are held to a stricter standard
// ─────────────────────────────────────────────────────────────────────────────

describe('increase limits', () => {
  it('allows a normal restock', () => {
    // 100 -> 140 is +40%, inside the +50% default.
    expect(guardStockWrite(input({ write: delta(40) })).allowed).toBe(true);
  });

  it('refuses an implausible increase, because overstating causes cancellations', () => {
    const verdict = guardStockWrite(input({ write: delta(500) }));
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) return;
    expect(verdict.rejection.code).toBe('increase_too_large');
  });

  it('catches a decimal-place mistake, the error that actually happens', () => {
    // 100 units typed as 10.000 — a 100x slip that would oversell for days.
    const verdict = guardStockWrite(input({ write: delta(9_900) }));
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) return;
    expect(verdict.rejection.code).toBe('increase_too_large');
  });

  it('applies the absolute cap where a ratio is meaningless', () => {
    // 2 -> 20.000: the ratio test alone would not save a product this small from
    // a unit-of-measure mistake.
    const verdict = guardStockWrite(input({ write: delta(19_998), assumedCurrent: 2, verifiedCurrent: 2 }));
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) return;
    expect(verdict.rejection.code).toBe('increase_too_large');
  });

  it('allows a first stock entry from zero within the absolute cap', () => {
    // A ratio is undefined at zero, so only the absolute cap applies.
    expect(
      guardStockWrite(input({ write: delta(800), assumedCurrent: 0, verifiedCurrent: 0 })).allowed
    ).toBe(true);
  });

  it('refuses a first entry above the absolute cap', () => {
    const verdict = guardStockWrite(input({ write: delta(5_000), assumedCurrent: 0, verifiedCurrent: 0 }));
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) return;
    expect(verdict.rejection.code).toBe('increase_too_large');
  });

  it('is stricter on increases than on decreases of the same size', () => {
    // The whole asymmetry, in one assertion.
    const up = guardStockWrite(input({ write: delta(80) }));
    const down = guardStockWrite(input({ write: delta(-80) }));
    expect(up.allowed).toBe(false);
    expect(down.allowed).toBe(true);
  });
});

describe('decrease limits', () => {
  it('allows zeroing a product, which is a legitimate count result', () => {
    expect(guardStockWrite(input({ write: delta(-100) })).allowed).toBe(true);
  });

  it('refuses a decrease that would go below zero', () => {
    const verdict = guardStockWrite(input({ write: delta(-150) }));
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) return;
    expect(verdict.rejection).toEqual({ code: 'negative_result', result: -50 });
  });

  it('refuses an absolute write to a negative balance', () => {
    const verdict = guardStockWrite(input({ write: absolute(-1, 100) }));
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) return;
    expect(verdict.rejection.code).toBe('negative_result');
  });

  it('refuses a decrease beyond the absolute cap', () => {
    const verdict = guardStockWrite(
      input({ write: delta(-6_000), assumedCurrent: 20_000, verifiedCurrent: 20_000 })
    );
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) return;
    expect(verdict.rejection.code).toBe('decrease_too_large');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Reason and sign must agree
// ─────────────────────────────────────────────────────────────────────────────

describe('movement direction', () => {
  it('declares which reasons may only go one way', () => {
    expect(MOVEMENT_DIRECTION.return).toBe('increase');
    expect(MOVEMENT_DIRECTION.withdrawal).toBe('decrease');
    expect(MOVEMENT_DIRECTION.full_withdrawal).toBe('neutral');
    expect(MOVEMENT_DIRECTION.count_adjustment).toBe('either');
  });

  it('refuses a return that would remove stock', () => {
    // A devolução arriving as -6 would remove stock the customer just got back,
    // and nothing downstream would question it.
    const verdict = guardStockWrite(input({ write: delta(-6), reason: 'return' }));
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) return;
    expect(verdict.rejection).toMatchObject({ code: 'wrong_direction', reason: 'return' });
  });

  it('refuses a withdrawal that would add stock', () => {
    const verdict = guardStockWrite(input({ write: delta(6), reason: 'withdrawal' }));
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) return;
    expect(verdict.rejection).toMatchObject({ code: 'wrong_direction', reason: 'withdrawal' });
  });

  it('accepts each reason in its correct direction', () => {
    const cases: [MovementReason, number][] = [
      ['return', 6], ['withdrawal', -6], ['loss', -6], ['found', 6],
      ['count_adjustment', 6], ['count_adjustment', -6], ['reconciliation', -6],
    ];
    for (const [reason, quantity] of cases) {
      expect(guardStockWrite(input({ write: delta(quantity), reason })).allowed, `${reason} ${quantity}`).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// No-ops and projection
// ─────────────────────────────────────────────────────────────────────────────

describe('no-op and projection', () => {
  it('refuses a write that changes nothing', () => {
    expect(guardStockWrite(input({ write: delta(0) })).allowed).toBe(false);
    expect(guardStockWrite(input({ write: absolute(100, 100) })).allowed).toBe(false);
  });

  it('projects the resulting balance per write shape', () => {
    expect(projectedBalance(delta(-6), 100)).toBe(94);
    expect(projectedBalance(absolute(94, 100), 100)).toBe(94);
    expect(
      projectedBalance(
        { kind: 'movement', productExternalId: 'e', locationExternalId: null, movementType: 'in', quantity: 5, idempotencyKey: 'k' },
        100
      )
    ).toBe(105);
    expect(
      projectedBalance(
        { kind: 'movement', productExternalId: 'e', locationExternalId: null, movementType: 'out', quantity: 5, idempotencyKey: 'k' },
        100
      )
    ).toBe(95);
  });

  it('cannot project a typed adjustment movement, and says so instead of guessing', () => {
    expect(
      projectedBalance(
        { kind: 'movement', productExternalId: 'e', locationExternalId: null, movementType: 'adjustment', quantity: 5, idempotencyKey: 'k' },
        100
      )
    ).toBeNull();
  });

  it('treats a transfer as balance-neutral', () => {
    expect(
      projectedBalance(
        { kind: 'transfer', productExternalId: 'e', fromLocationExternalId: 'a', toLocationExternalId: 'b', quantity: 10, idempotencyKey: 'k' },
        100
      )
    ).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Batch behaviour
// ─────────────────────────────────────────────────────────────────────────────

describe('guardBatch', () => {
  it('lets the safe writes through and holds back only the suspect one', () => {
    // Twelve good adjustments must still reach the ERP when the thirteenth is wrong.
    const result = guardBatch([
      input({ write: delta(-6) }),
      input({ write: delta(-10) }),
      input({ write: delta(99_999) }),
    ]);
    expect(result.allowed).toHaveLength(2);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].rejection.code).toBe('increase_too_large');
  });

  it('returns nothing to send when every write is refused', () => {
    const result = guardBatch([input({ write: delta(0) })]);
    expect(result.allowed).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Returns and withdrawals
// ─────────────────────────────────────────────────────────────────────────────

describe('buildReturnWrite / buildWithdrawalWrite', () => {
  it('a return always raises stock, even if the caller passes a negative', () => {
    // Not depending on the guard to catch a caller's sign mistake is better than
    // depending on it.
    const write = buildReturnWrite({
      productExternalId: 'e1', locationExternalId: 'CD-SP', quantity: -5, idempotencyKey: 'k',
    });
    expect(write).toMatchObject({ kind: 'delta', deltaQuantity: 5 });
  });

  it('a withdrawal always lowers stock, even if the caller passes a positive', () => {
    const write = buildWithdrawalWrite({
      productExternalId: 'e1', locationExternalId: 'CD-SP', quantity: 5, idempotencyKey: 'k',
    });
    expect(write).toMatchObject({ kind: 'delta', deltaQuantity: -5 });
  });

  it('expresses both as deltas, never as absolutes', () => {
    // A return is a known change of a known size; "the balance is now X" would
    // discard that and overwrite whatever else moved in between.
    expect(buildReturnWrite({ productExternalId: 'e', locationExternalId: null, quantity: 1, idempotencyKey: 'k' }).kind).toBe('delta');
    expect(buildWithdrawalWrite({ productExternalId: 'e', locationExternalId: null, quantity: 1, idempotencyKey: 'k' }).kind).toBe('delta');
  });

  it('carries a default note so the ERP movement is identifiable', () => {
    const write = buildReturnWrite({ productExternalId: 'e', locationExternalId: null, quantity: 1, idempotencyKey: 'k' });
    expect(write.reason).toBe('Devolução');
  });

  it('passes the guard end to end in its own direction', () => {
    const returnWrite = buildReturnWrite({ productExternalId: 'e1', locationExternalId: 'CD-SP', quantity: 5, idempotencyKey: 'k' });
    expect(guardStockWrite(input({ write: returnWrite, reason: 'return' })).allowed).toBe(true);

    const withdrawal = buildWithdrawalWrite({ productExternalId: 'e1', locationExternalId: 'CD-SP', quantity: 5, idempotencyKey: 'k' });
    expect(guardStockWrite(input({ write: withdrawal, reason: 'withdrawal' })).allowed).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Operator-facing messages
// ─────────────────────────────────────────────────────────────────────────────

describe('describeRejection', () => {
  it('explains every rejection in Portuguese, with the numbers', () => {
    expect(describeRejection({ code: 'stale_balance', assumed: 100, actual: 94 })).toContain('100');
    expect(describeRejection({ code: 'stale_balance', assumed: 100, actual: 94 })).toContain('94');
    expect(describeRejection({ code: 'absolute_multi_warehouse', warehouses: 3 })).toContain('3 depósitos');
    expect(describeRejection({ code: 'increase_too_large', from: 100, to: 9000, limit: 50 }))
      .toContain('não podem ser atendidos');
    expect(describeRejection({ code: 'negative_result', result: -5 })).toContain('-5');
    expect(describeRejection({ code: 'wrong_direction', reason: 'return', expected: 'increase' }))
      .toContain('aumentar');
  });

  it('never returns an empty message', () => {
    const codes = [
      { code: 'no_op' as const },
      { code: 'absolute_without_expected' as const },
      { code: 'observation_too_old' as const, ageMs: 3_600_000 },
      { code: 'decrease_too_large' as const, from: 100, to: -5000, limit: 100 },
    ];
    for (const rejection of codes) {
      expect(describeRejection(rejection).length).toBeGreaterThan(10);
    }
  });
});

describe('limits', () => {
  it('defaults stop the 10x/100x/1000x mistakes that actually happen', () => {
    expect(DEFAULT_WRITE_LIMITS.maxIncreaseRatio).toBeLessThanOrEqual(0.5);
    // Increases must be at least as constrained as decreases.
    expect(DEFAULT_WRITE_LIMITS.maxIncreaseAbsolute).toBeLessThan(DEFAULT_WRITE_LIMITS.maxDecreaseAbsolute);
  });

  it('honours caller-supplied limits', () => {
    const strict = { ...DEFAULT_WRITE_LIMITS, maxIncreaseAbsolute: 5 };
    expect(guardStockWrite(input({ write: delta(10), limits: strict })).allowed).toBe(false);
    expect(guardStockWrite(input({ write: delta(4), limits: strict })).allowed).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Retirada de Full — a transfer, not a decrease
// ─────────────────────────────────────────────────────────────────────────────

describe('Full withdrawal', () => {
  const transfer = (quantity: number, from = 'FULL-ML', to = 'GERAL') =>
    buildFullWithdrawalTransfer({
      productExternalId: 'e1',
      fromFullWarehouseId: from,
      toGeneralWarehouseId: to,
      quantity,
      idempotencyKey: 'k1',
    });

  it('is built as a transfer, so the company total never moves', () => {
    // Modelling it as a decrease would subtract stock the company still owns and
    // leave the general deposit uncredited — units physically on the shelf but
    // invisible to picking.
    const write = transfer(10);
    expect(write.kind).toBe('transfer');
    expect(write).toMatchObject({ fromLocationExternalId: 'FULL-ML', toLocationExternalId: 'GERAL', quantity: 10 });
    expect(projectedBalance(write, 100)).toBe(100);
  });

  it('forces a positive quantity regardless of the caller', () => {
    expect(transfer(-10)).toMatchObject({ quantity: 10 });
  });

  it('passes the guard when the Full deposit holds enough', () => {
    const verdict = guardStockWrite(
      input({ write: transfer(10), reason: 'full_withdrawal', sourceWarehouseBalance: 25 })
    );
    expect(verdict.allowed).toBe(true);
  });

  it('refuses moving more than the Full deposit holds', () => {
    // Likely a mismapped deposit, and it would drive the source negative.
    const verdict = guardStockWrite(
      input({ write: transfer(40), reason: 'full_withdrawal', sourceWarehouseBalance: 25 })
    );
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) return;
    expect(verdict.rejection).toEqual({ code: 'insufficient_source_balance', available: 25, requested: 40 });
  });

  it('refuses when the source balance could not be read', () => {
    // Moving an unknown quantity out of an unknown balance is how a deposit goes
    // negative; refusing is safer than moving blind.
    const verdict = guardStockWrite(
      input({ write: transfer(10), reason: 'full_withdrawal', sourceWarehouseBalance: null })
    );
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) return;
    expect(verdict.rejection.code).toBe('insufficient_source_balance');
  });

  it('refuses a transfer to the same deposit', () => {
    const verdict = guardStockWrite(
      input({ write: transfer(10, 'GERAL', 'GERAL'), reason: 'full_withdrawal', sourceWarehouseBalance: 99 })
    );
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) return;
    expect(verdict.rejection).toMatchObject({ code: 'same_warehouse_transfer', warehouse: 'GERAL' });
  });

  it('refuses a Full withdrawal built as a plain decrease', () => {
    // The exact bug this correction fixes: a delta would subtract stock the
    // company still owns.
    const verdict = guardStockWrite(input({ write: delta(-10), reason: 'full_withdrawal' }));
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) return;
    expect(verdict.rejection).toMatchObject({ code: 'wrong_direction', expected: 'neutral' });
  });

  it('is never overridable, because the cause is a mapping problem', () => {
    expect(isOverridable({ code: 'insufficient_source_balance', available: 1, requested: 5 })).toBe(false);
    expect(isOverridable({ code: 'same_warehouse_transfer', warehouse: 'X' })).toBe(false);
  });

  it('explains the refusal in operator language', () => {
    expect(describeRejection({ code: 'insufficient_source_balance', available: 25, requested: 40 }))
      .toContain('depósito de Full');
    expect(describeRejection({ code: 'wrong_direction', reason: 'full_withdrawal', expected: 'neutral' }))
      .toContain('transfere');
  });

  it('a genuine write-off still reduces stock, unlike a Full withdrawal', () => {
    const writeOff = buildWithdrawalWrite({
      productExternalId: 'e1', locationExternalId: 'GERAL', quantity: 10, idempotencyKey: 'k',
    });
    expect(writeOff).toMatchObject({ kind: 'delta', deltaQuantity: -10 });
    expect(guardStockWrite(input({ write: writeOff, reason: 'withdrawal' })).allowed).toBe(true);
  });
});

describe('Tiny transfer legs', () => {
  it('sends the saída before the entrada, so a half-failure understates rather than overstates', async () => {
    // Understating costs a lost sale. Overstating makes the marketplace accept
    // orders that cannot be fulfilled, which is the failure the customer must not
    // have.
    const { buildTinyTransferLegs } = await import('../../providers/tiny/tinyProtocol');
    const { legs, transferKey } = buildTinyTransferLegs({
      productExternalId: '772034512',
      fromLocationExternalId: 'FULL-ML',
      toLocationExternalId: 'GERAL',
      quantity: 10,
      idempotencyKey: 'transfer-1',
    });

    expect(legs).toHaveLength(2);
    expect(legs[0]).toMatchObject({ sequencia: 1, tipo: 'S', deposito: 'FULL-ML', quantidade: 10 });
    expect(legs[1]).toMatchObject({ sequencia: 2, tipo: 'E', deposito: 'GERAL', quantidade: 10 });
    // Both legs share the key, so an incomplete pair is detectable.
    expect(transferKey).toBe('transfer-1');
  });

  it('keeps both legs positive, with direction carried by tipo', async () => {
    const { buildTinyTransferLegs } = await import('../../providers/tiny/tinyProtocol');
    const { legs } = buildTinyTransferLegs({
      productExternalId: '1', fromLocationExternalId: 'A', toLocationExternalId: 'B',
      quantity: -7, idempotencyKey: 'k',
    });
    expect(legs.every(leg => leg.quantidade === 7)).toBe(true);
  });

  it('labels each leg so the ERP movement history is readable', async () => {
    const { buildTinyTransferLegs } = await import('../../providers/tiny/tinyProtocol');
    const { legs } = buildTinyTransferLegs({
      productExternalId: '1', fromLocationExternalId: 'FULL-ML', toLocationExternalId: 'GERAL',
      quantity: 5, idempotencyKey: 'k', reason: 'Retirada de Full',
    });
    expect(legs[0].observacoes).toContain('saída FULL-ML');
    expect(legs[1].observacoes).toContain('entrada GERAL');
  });
});
