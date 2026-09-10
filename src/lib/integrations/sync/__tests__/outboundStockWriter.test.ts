import { describe, expect, it } from 'vitest';
import {
  decideOutboundWrite,
  groupWritesByOperation,
  partitionDecisions,
  prepareWrite,
  readMovementReason,
  selectOneAdjustmentPerProduct,
  summarizeProviderStock,
  type ApprovedAdjustment,
  type VerifiedBalance,
} from '../outboundStockWriter';
import type { StockWrite } from '../../stockOperations';

const NOW = Date.parse('2026-08-14T12:00:00.000Z');
/** Two minutes old — comfortably inside the 15-minute staleness window, so these
 *  tests exercise the rule under test and not the clock. */
const OBSERVED = '2026-08-14T11:58:00.000Z';

function adjustment(overrides: Partial<ApprovedAdjustment> = {}): ApprovedAdjustment {
  return {
    id: 'adj-1',
    external_product_id: '1001',
    sku: 'SKU-1',
    external_warehouse_id: 'GERAL',
    target_warehouse_id: null,
    previous_quantity: 100,
    counted_quantity: 100,
    delta_quantity: 0,
    write_kind: 'delta',
    movement_reason: 'count_adjustment',
    reason: null,
    idempotency_key: 'idem-1',
    approved_at: OBSERVED,
    observed_at: OBSERVED,
    ...overrides,
  };
}

function verified(overrides: Partial<VerifiedBalance> = {}): VerifiedBalance {
  return { total: 100, warehouseCount: 1, sourceWarehouseBalance: null, ...overrides };
}

describe('readMovementReason', () => {
  it('reads null as count_adjustment', () => {
    // Every row written before the column existed is a physical-count adjustment.
    expect(readMovementReason(null)).toBe('count_adjustment');
    expect(readMovementReason('')).toBe('count_adjustment');
  });

  it('accepts each known reason', () => {
    for (const reason of [
      'count_adjustment',
      'return',
      'full_withdrawal',
      'withdrawal',
      'loss',
      'found',
      'reconciliation',
    ]) {
      expect(readMovementReason(reason)).toBe(reason);
    }
  });

  it('refuses an unknown reason instead of defaulting it', () => {
    // Defaulting would apply count_adjustment's permissive 'either' direction to a
    // movement whose real direction nobody knows.
    expect(readMovementReason('devolucao')).toBeNull();
    expect(readMovementReason('COUNT_ADJUSTMENT')).toBeNull();
  });
});

describe('prepareWrite — refusals', () => {
  it('refuses an unapproved adjustment', () => {
    const result = prepareWrite(adjustment({ approved_at: null, delta_quantity: 5 }));
    expect(result).toMatchObject({ ok: false, rejection: { code: 'not_approved' } });
  });

  it('refuses a product with no ERP link', () => {
    const result = prepareWrite(adjustment({ external_product_id: null, delta_quantity: 5 }));
    expect(result).toMatchObject({ ok: false, rejection: { code: 'missing_external_product' } });
  });

  it('names the SKU when refusing an unlinked product', () => {
    const result = prepareWrite(adjustment({ external_product_id: null, sku: 'CAPA-XYZ', delta_quantity: 1 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.message).toContain('CAPA-XYZ');
  });

  it('refuses an unknown movement reason', () => {
    const result = prepareWrite(adjustment({ movement_reason: 'retirada', delta_quantity: 5 }));
    expect(result).toMatchObject({ ok: false, rejection: { code: 'unknown_movement_reason' } });
  });

  it('refuses a zero-quantity delta', () => {
    expect(prepareWrite(adjustment({ delta_quantity: 0 }))).toMatchObject({
      ok: false,
      rejection: { code: 'zero_quantity' },
    });
  });

  it('refuses a Full withdrawal recorded as a delta', () => {
    // The shape lock, independent of the direction rule: a Full withdrawal must
    // move units between deposits, and a delta leaves them where they are.
    const result = prepareWrite(
      adjustment({ movement_reason: 'full_withdrawal', write_kind: 'delta', delta_quantity: -5 })
    );
    expect(result).toMatchObject({ ok: false, rejection: { code: 'reason_kind_mismatch' } });
  });

  it('refuses a return recorded as absolute', () => {
    // A return is a known change of known size; expressing it as "the balance is
    // now X" discards that and overwrites whatever else moved in between.
    const result = prepareWrite(
      adjustment({ movement_reason: 'return', write_kind: 'absolute', counted_quantity: 106 })
    );
    expect(result).toMatchObject({ ok: false, rejection: { code: 'reason_kind_mismatch' } });
  });

  it('refuses a transfer with no destination', () => {
    const result = prepareWrite(
      adjustment({
        movement_reason: 'full_withdrawal',
        write_kind: 'transfer',
        delta_quantity: 5,
        target_warehouse_id: null,
      })
    );
    expect(result).toMatchObject({ ok: false, rejection: { code: 'missing_transfer_target' } });
  });

  it('refuses a transfer with no origin', () => {
    const result = prepareWrite(
      adjustment({
        movement_reason: 'full_withdrawal',
        write_kind: 'transfer',
        delta_quantity: 5,
        external_warehouse_id: null,
        target_warehouse_id: 'GERAL',
      })
    );
    expect(result).toMatchObject({ ok: false, rejection: { code: 'missing_transfer_target' } });
  });

  it('refuses a zero-unit transfer', () => {
    const result = prepareWrite(
      adjustment({
        movement_reason: 'full_withdrawal',
        write_kind: 'transfer',
        delta_quantity: 0,
        external_warehouse_id: 'AZ ML FULLFILMENT',
        target_warehouse_id: 'GERAL',
      })
    );
    expect(result).toMatchObject({ ok: false, rejection: { code: 'zero_quantity' } });
  });
});

describe('prepareWrite — sign discipline', () => {
  it('makes a return add stock even when stored negative', () => {
    // The bug this prevents: a devolução arriving as −6 removing six units the
    // customer just gave back.
    const result = prepareWrite(adjustment({ movement_reason: 'return', delta_quantity: -6 }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.write).toMatchObject({ kind: 'delta', deltaQuantity: 6 });
  });

  it('makes a withdrawal remove stock even when stored positive', () => {
    const result = prepareWrite(adjustment({ movement_reason: 'withdrawal', delta_quantity: 4 }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.write).toMatchObject({ kind: 'delta', deltaQuantity: -4 });
  });

  it('makes a loss remove stock', () => {
    const result = prepareWrite(adjustment({ movement_reason: 'loss', delta_quantity: 3 }));
    if (result.ok) expect(result.write).toMatchObject({ deltaQuantity: -3 });
  });

  it('makes a found quantity add stock', () => {
    const result = prepareWrite(adjustment({ movement_reason: 'found', delta_quantity: -3 }));
    if (result.ok) expect(result.write).toMatchObject({ deltaQuantity: 3 });
  });

  it('passes a count adjustment through with its stored sign', () => {
    // count_adjustment and reconciliation genuinely go both ways, so the sign is
    // the intent and must not be normalised.
    const down = prepareWrite(adjustment({ movement_reason: 'count_adjustment', delta_quantity: -7 }));
    const up = prepareWrite(adjustment({ movement_reason: 'count_adjustment', delta_quantity: 7 }));
    if (down.ok) expect(down.write).toMatchObject({ deltaQuantity: -7 });
    if (up.ok) expect(up.write).toMatchObject({ deltaQuantity: 7 });
  });

  it('always makes a transfer quantity positive', () => {
    const result = prepareWrite(
      adjustment({
        movement_reason: 'full_withdrawal',
        write_kind: 'transfer',
        delta_quantity: -8,
        external_warehouse_id: 'AZ ML FULLFILMENT',
        target_warehouse_id: 'GERAL',
      })
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.write).toMatchObject({
        kind: 'transfer',
        quantity: 8,
        fromLocationExternalId: 'AZ ML FULLFILMENT',
        toLocationExternalId: 'GERAL',
      });
    }
  });
});

describe('prepareWrite — absolute writes', () => {
  it('uses counted_quantity, not previous + delta', () => {
    // If the two ever disagree, the counted value is what a human observed.
    // Recomputing would silently send a different target.
    const result = prepareWrite(
      adjustment({
        write_kind: 'absolute',
        previous_quantity: 100,
        counted_quantity: 93,
        delta_quantity: -5, // deliberately inconsistent with the count
      })
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.write).toMatchObject({ kind: 'absolute', targetQuantity: 93 });
  });

  it('allows an absolute write of zero', () => {
    // "Counted zero" is a real result and must not be mistaken for "no change".
    const result = prepareWrite(
      adjustment({ write_kind: 'absolute', previous_quantity: 4, counted_quantity: 0, delta_quantity: -4 })
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.write).toMatchObject({ targetQuantity: 0 });
  });

  it('carries the idempotency key onto the write', () => {
    const result = prepareWrite(adjustment({ delta_quantity: 5, idempotency_key: 'chave-unica' }));
    if (result.ok) expect(result.write.idempotencyKey).toBe('chave-unica');
  });

  it('uses the stored note when present and a default label otherwise', () => {
    const custom = prepareWrite(adjustment({ delta_quantity: 5, reason: 'Recontagem do turno' }));
    const fallback = prepareWrite(adjustment({ movement_reason: 'return', delta_quantity: 5, reason: null }));
    if (custom.ok) expect(custom.write.reason).toBe('Recontagem do turno');
    if (fallback.ok) expect(fallback.write.reason).toBe('Devolução');
  });
});

describe('decideOutboundWrite — the balance protection', () => {
  it('sends a plausible adjustment', () => {
    const decision = decideOutboundWrite({
      adjustment: adjustment({ delta_quantity: -4, previous_quantity: 100 }),
      verified: verified({ total: 100 }),
      nowMs: NOW,
    });
    expect(decision.status).toBe('send');
  });

  it('refuses when the provider balance drifted since planning', () => {
    // A delta computed against the old number would be wrong by exactly the drift.
    const decision = decideOutboundWrite({
      adjustment: adjustment({ delta_quantity: -4, previous_quantity: 100 }),
      verified: verified({ total: 87 }),
      nowMs: NOW,
    });
    expect(decision).toMatchObject({ status: 'refused', code: 'stale_balance', overridable: false });
  });

  it('refuses an absolute write on a multi-deposit product, unconditionally', () => {
    // The most destructive case: the provider would apply the total to one deposit
    // and the others would be wrong. Not overridable, and an override list naming
    // the code must not help.
    const decision = decideOutboundWrite({
      adjustment: adjustment({ write_kind: 'absolute', counted_quantity: 90, external_warehouse_id: null }),
      verified: verified({ total: 100, warehouseCount: 4 }),
      nowMs: NOW,
      overriddenCodes: ['absolute_multi_warehouse'],
    });
    expect(decision).toMatchObject({
      status: 'refused',
      code: 'absolute_multi_warehouse',
      overridable: false,
    });
  });

  it('assumes one deposit rather than zero when the count is unknown', () => {
    // Claiming zero deposits would slip an absolute write past the multi-deposit
    // refusal — the one refusal that cannot be overridden.
    const decision = decideOutboundWrite({
      adjustment: adjustment({ write_kind: 'absolute', counted_quantity: 98 }),
      verified: null,
      nowMs: NOW,
    });
    // Refused for a different reason (no verified balance), never sent.
    expect(decision.status).toBe('refused');
  });

  it('refuses an increase far beyond the limit', () => {
    // The scenario the user named: sending more balance than exists gets orders
    // cancelled downstream.
    const decision = decideOutboundWrite({
      adjustment: adjustment({ delta_quantity: 5000, previous_quantity: 10 }),
      verified: verified({ total: 10 }),
      nowMs: NOW,
    });
    expect(decision).toMatchObject({ status: 'refused', code: 'increase_too_large' });
  });

  it('lets an operator override a magnitude refusal for that adjustment', () => {
    const decision = decideOutboundWrite({
      adjustment: adjustment({ delta_quantity: 5000, previous_quantity: 10 }),
      verified: verified({ total: 10 }),
      nowMs: NOW,
      overriddenCodes: ['increase_too_large'],
    });
    expect(decision.status).toBe('send');
  });

  it('ignores an override naming a different code', () => {
    const decision = decideOutboundWrite({
      adjustment: adjustment({ delta_quantity: 5000, previous_quantity: 10 }),
      verified: verified({ total: 10 }),
      nowMs: NOW,
      overriddenCodes: ['decrease_too_large', 'stale_balance'],
    });
    expect(decision.status).toBe('refused');
  });

  it('refuses a write that would drive the balance negative', () => {
    const decision = decideOutboundWrite({
      adjustment: adjustment({ delta_quantity: -150, previous_quantity: 100 }),
      verified: verified({ total: 100 }),
      nowMs: NOW,
      overriddenCodes: ['negative_result', 'decrease_too_large'],
    });
    expect(decision).toMatchObject({ status: 'refused', overridable: false });
  });

  it('refuses an observation older than the staleness window', () => {
    const decision = decideOutboundWrite({
      adjustment: adjustment({
        delta_quantity: -4,
        approved_at: '2026-08-14T09:00:00.000Z',
        observed_at: '2026-08-14T09:00:00.000Z',
      }),
      verified: verified({ total: 100 }),
      nowMs: NOW,
      overriddenCodes: ['observation_too_old'],
    });
    expect(decision).toMatchObject({ status: 'refused', code: 'observation_too_old', overridable: false });
  });

  it('falls back to approved_at when observed_at is absent', () => {
    const decision = decideOutboundWrite({
      adjustment: adjustment({ delta_quantity: -4, observed_at: null, approved_at: OBSERVED }),
      verified: verified({ total: 100 }),
      nowMs: NOW,
    });
    expect(decision.status).toBe('send');
  });

  it('never overrides a preparation failure', () => {
    // Forcing an unlinked product through would send a write nobody specified.
    const decision = decideOutboundWrite({
      adjustment: adjustment({ external_product_id: null, delta_quantity: 5 }),
      verified: verified(),
      nowMs: NOW,
      overriddenCodes: ['missing_external_product', 'increase_too_large', 'stale_balance'],
    });
    expect(decision).toMatchObject({ status: 'refused', overridable: false });
  });
});

describe('decideOutboundWrite — Full withdrawal transfers', () => {
  function fullWithdrawal(overrides: Partial<ApprovedAdjustment> = {}) {
    return adjustment({
      movement_reason: 'full_withdrawal',
      write_kind: 'transfer',
      delta_quantity: 10,
      external_warehouse_id: 'AZ ML FULLFILMENT',
      target_warehouse_id: 'GERAL',
      ...overrides,
    });
  }

  it('sends a transfer within the source balance', () => {
    const decision = decideOutboundWrite({
      adjustment: fullWithdrawal(),
      verified: verified({ total: 100, warehouseCount: 2, sourceWarehouseBalance: 30 }),
      nowMs: NOW,
    });
    expect(decision.status).toBe('send');
  });

  it('refuses a transfer when the source balance could not be read', () => {
    // Moving an unknown quantity out of an unknown balance is how a deposit goes
    // negative — refused before the guard, and never overridable.
    const decision = decideOutboundWrite({
      adjustment: fullWithdrawal(),
      verified: verified({ total: 100, warehouseCount: 2, sourceWarehouseBalance: null }),
      nowMs: NOW,
      overriddenCodes: ['source_balance_unknown'],
    });
    expect(decision).toMatchObject({
      status: 'refused',
      code: 'source_balance_unknown',
      overridable: false,
    });
  });

  it('refuses a transfer when there is no verified balance at all', () => {
    const decision = decideOutboundWrite({
      adjustment: fullWithdrawal(),
      verified: null,
      nowMs: NOW,
    });
    expect(decision).toMatchObject({ status: 'refused', code: 'source_balance_unknown' });
  });

  it('refuses moving more than the Full deposit holds', () => {
    // The likely shape of a mapping mistake, so it is a data problem to fix rather
    // than a judgement to confirm.
    const decision = decideOutboundWrite({
      adjustment: fullWithdrawal({ delta_quantity: 50 }),
      verified: verified({ total: 100, warehouseCount: 2, sourceWarehouseBalance: 12 }),
      nowMs: NOW,
      overriddenCodes: ['insufficient_source_balance'],
    });
    expect(decision).toMatchObject({
      status: 'refused',
      code: 'insufficient_source_balance',
      overridable: false,
    });
  });

  it('refuses a transfer between the same deposit', () => {
    const decision = decideOutboundWrite({
      adjustment: fullWithdrawal({ target_warehouse_id: 'AZ ML FULLFILMENT' }),
      verified: verified({ total: 100, warehouseCount: 2, sourceWarehouseBalance: 30 }),
      nowMs: NOW,
    });
    expect(decision).toMatchObject({ status: 'refused', code: 'same_warehouse_transfer' });
  });

  it('does not treat a transfer as a decrease of the total', () => {
    // A Full withdrawal is neutral on the company total. If it were modelled as a
    // decrease, the general deposit would never be credited and the units would be
    // invisible to picking while sitting on the shelf.
    const decision = decideOutboundWrite({
      adjustment: fullWithdrawal({ delta_quantity: 10 }),
      verified: verified({ total: 10, warehouseCount: 2, sourceWarehouseBalance: 10 }),
      nowMs: NOW,
    });
    // Moving the entire balance out of Full into GERAL is legitimate; a
    // decrease-based model would have refused it as driving the total to zero.
    expect(decision.status).toBe('send');
  });
});

describe('partitionDecisions', () => {
  it('never loses a decision', () => {
    // sent + refused must equal the input count; a decision in neither bucket is
    // how a lançamento disappears without anyone noticing.
    const decisions = [
      decideOutboundWrite({
        adjustment: adjustment({ id: 'a', delta_quantity: -4 }),
        verified: verified(),
        nowMs: NOW,
      }),
      decideOutboundWrite({
        adjustment: adjustment({ id: 'b', delta_quantity: 9000, previous_quantity: 5 }),
        verified: verified({ total: 5 }),
        nowMs: NOW,
      }),
      decideOutboundWrite({
        adjustment: adjustment({ id: 'c', external_product_id: null, delta_quantity: 2 }),
        verified: verified(),
        nowMs: NOW,
      }),
    ];

    const { toSend, refused } = partitionDecisions(decisions);
    expect(toSend.length + refused.length).toBe(3);
    expect(toSend.map(d => d.adjustmentId)).toEqual(['a']);
    expect(refused.map(d => d.adjustmentId).sort()).toEqual(['b', 'c']);
  });

  it('handles an empty batch', () => {
    expect(partitionDecisions([])).toEqual({ toSend: [], refused: [] });
  });

  it('lets one refusal through without blocking the rest', () => {
    // 12 safe adjustments must reach the ERP even when the 13th looks wrong.
    const decisions = Array.from({ length: 13 }, (_, i) =>
      decideOutboundWrite({
        adjustment:
          i === 12
            ? adjustment({ id: 'bad', delta_quantity: 9999, previous_quantity: 1 })
            : adjustment({ id: `ok-${i}`, delta_quantity: -1 }),
        verified: i === 12 ? verified({ total: 1 }) : verified(),
        nowMs: NOW,
      })
    );
    const { toSend, refused } = partitionDecisions(decisions);
    expect(toSend).toHaveLength(12);
    expect(refused).toHaveLength(1);
  });
});

describe('groupWritesByOperation', () => {
  const balance: StockWrite = {
    kind: 'delta',
    productExternalId: '1',
    locationExternalId: null,
    deltaQuantity: -2,
    idempotencyKey: 'k1',
    reason: 'x',
  };
  const transfer: StockWrite = {
    kind: 'transfer',
    productExternalId: '2',
    fromLocationExternalId: 'FULL',
    toLocationExternalId: 'GERAL',
    quantity: 5,
    idempotencyKey: 'k2',
    reason: 'y',
  };

  it('separates transfers from balance writes', () => {
    // Tiny has no atomic transfer, so a transfer becomes two movements and needs
    // its own call sequence. Mixing them would send a transfer as a balance change.
    const grouped = groupWritesByOperation([balance, transfer, balance]);
    expect(grouped.balanceWrites).toHaveLength(2);
    expect(grouped.transfers).toHaveLength(1);
  });

  it('keeps every write', () => {
    const writes = [balance, transfer, balance, transfer];
    const { balanceWrites, transfers } = groupWritesByOperation(writes);
    expect(balanceWrites.length + transfers.length).toBe(writes.length);
  });

  it('handles an empty list', () => {
    expect(groupWritesByOperation([])).toEqual({ balanceWrites: [], transfers: [] });
  });
});

describe('summarizeProviderStock', () => {
  it('sums every deposit rather than reading the first', () => {
    // Comparing one deposit's balance against a company-wide expectation is how a
    // false conflict gets manufactured.
    const summary = summarizeProviderStock(
      [
        { warehouseExternalId: 'GERAL', quantity: 40 },
        { warehouseExternalId: 'AZ ML FULLFILMENT', quantity: 25 },
        { warehouseExternalId: 'AZ FBA CLASSIC', quantity: 10 },
      ],
      null
    );
    expect(summary.total).toBe(75);
    expect(summary.warehouseCount).toBe(3);
    expect(summary.sourceWarehouseBalance).toBeNull();
  });

  it('finds the source deposit balance', () => {
    const summary = summarizeProviderStock(
      [
        { warehouseExternalId: 'GERAL', quantity: 40 },
        { warehouseExternalId: 'AZ ML FULLFILMENT', quantity: 25 },
      ],
      'AZ ML FULLFILMENT'
    );
    expect(summary.sourceWarehouseBalance).toBe(25);
  });

  it('matches the deposit name despite case and spacing', () => {
    // Tiny v2 has no deposit id — the name IS the identifier, so a stored
    // 'AZ ML FULLFILMENT' must match a row that comes back differently cased.
    const summary = summarizeProviderStock(
      [{ warehouseExternalId: '  Az   Ml  Fullfilment ', quantity: 12 }],
      'AZ ML FULLFILMENT'
    );
    expect(summary.sourceWarehouseBalance).toBe(12);
  });

  it('leaves the source balance null when the deposit is absent', () => {
    // Null is what makes the transfer path refuse, which is the safe outcome for a
    // deposit the provider does not report.
    const summary = summarizeProviderStock(
      [{ warehouseExternalId: 'GERAL', quantity: 40 }],
      'AZ SHOPEE FULLFILMENT'
    );
    expect(summary.sourceWarehouseBalance).toBeNull();
  });

  it('distinguishes a zero source balance from an unknown one', () => {
    // A Full deposit at zero is a real reading and must refuse the transfer for
    // insufficient balance, not for an unreadable one.
    const summary = summarizeProviderStock(
      [{ warehouseExternalId: 'AZ ML FULLFILMENT', quantity: 0 }],
      'AZ ML FULLFILMENT'
    );
    expect(summary.sourceWarehouseBalance).toBe(0);
  });

  it('accumulates a deposit split across rows', () => {
    const summary = summarizeProviderStock(
      [
        { warehouseExternalId: 'GERAL', quantity: 10 },
        { warehouseExternalId: 'geral', quantity: 5 },
      ],
      'GERAL'
    );
    expect(summary.sourceWarehouseBalance).toBe(15);
    // Same deposit, one name.
    expect(summary.warehouseCount).toBe(1);
  });

  it('counts a single unnamed row as one deposit', () => {
    // Tiny emits one unnamed row for a product with no per-deposit breakdown.
    const summary = summarizeProviderStock([{ warehouseExternalId: null, quantity: 30 }], null);
    expect(summary).toMatchObject({ total: 30, warehouseCount: 1 });
  });

  it('reports zero deposits for an empty reading', () => {
    expect(summarizeProviderStock([], null)).toMatchObject({ total: 0, warehouseCount: 0 });
  });

  it('handles negative provider balances without hiding them', () => {
    // An ERP can hold a negative balance. Clamping it here would make the drift
    // check compare against a number the provider does not have.
    const summary = summarizeProviderStock(
      [
        { warehouseExternalId: 'GERAL', quantity: -3 },
        { warehouseExternalId: 'FULL', quantity: 10 },
      ],
      'GERAL'
    );
    expect(summary.total).toBe(7);
    expect(summary.sourceWarehouseBalance).toBe(-3);
  });
});

describe('selectOneAdjustmentPerProduct', () => {
  it('sends one per product and defers the rest', () => {
    // The second adjustment's previous_quantity was observed before the first was
    // applied. Sending both in one pass compounds the changes — the failure mode
    // that overstates a balance.
    const { selected, deferred } = selectOneAdjustmentPerProduct([
      adjustment({ id: 'a', external_product_id: '1001', approved_at: '2026-08-14T10:00:00.000Z' }),
      adjustment({ id: 'b', external_product_id: '1001', approved_at: '2026-08-14T11:00:00.000Z' }),
      adjustment({ id: 'c', external_product_id: '2002', approved_at: '2026-08-14T11:00:00.000Z' }),
    ]);
    expect(selected.map(a => a.id).sort()).toEqual(['a', 'c']);
    expect(deferred.map(a => a.id)).toEqual(['b']);
  });

  it('picks the oldest approval, whatever the input order', () => {
    // Applying a later correction before an earlier one can leave the ERP briefly
    // holding a balance nobody approved.
    const { selected } = selectOneAdjustmentPerProduct([
      adjustment({ id: 'novo', external_product_id: '1', approved_at: '2026-08-14T11:00:00.000Z' }),
      adjustment({ id: 'antigo', external_product_id: '1', approved_at: '2026-08-14T09:00:00.000Z' }),
    ]);
    expect(selected.map(a => a.id)).toEqual(['antigo']);
  });

  it('keeps an unlinked row in the batch so it gets refused', () => {
    // Deferring it forever would leave the operator waiting on a lançamento that
    // can never be sent.
    const { selected, deferred } = selectOneAdjustmentPerProduct([
      adjustment({ id: 'sem-link', external_product_id: null }),
      adjustment({ id: 'ok', external_product_id: '1' }),
    ]);
    expect(selected.map(a => a.id).sort()).toEqual(['ok', 'sem-link']);
    expect(deferred).toHaveLength(0);
  });

  it('never lets a row with no approval date take the slot', () => {
    const { selected, deferred } = selectOneAdjustmentPerProduct([
      adjustment({ id: 'com-data', external_product_id: '1', approved_at: '2026-08-14T10:00:00.000Z' }),
      adjustment({ id: 'sem-data', external_product_id: '1', approved_at: null }),
    ]);
    expect(selected.map(a => a.id)).toEqual(['com-data']);
    expect(deferred.map(a => a.id)).toEqual(['sem-data']);
  });

  it('loses nothing', () => {
    const input = Array.from({ length: 9 }, (_, i) =>
      adjustment({ id: `a${i}`, external_product_id: String(i % 3) })
    );
    const { selected, deferred } = selectOneAdjustmentPerProduct(input);
    expect(selected.length + deferred.length).toBe(9);
    expect(selected).toHaveLength(3);
  });

  it('handles an empty batch', () => {
    expect(selectOneAdjustmentPerProduct([])).toEqual({ selected: [], deferred: [] });
  });
});
