import { describe, expect, it } from 'vitest';
import { classifyPoItem, priceTolerance, summarizeReconciliation, type PoItemReconciliationInput } from '../poReconciliation';

function input(overrides: Partial<PoItemReconciliationInput> = {}): PoItemReconciliationInput {
  return {
    poItemId: 'po-1', orderedQuantity: 10, unitPriceOrdered: 5, unit: 'UN',
    hasNoCandidates: false, hasUnresolvedCandidates: false, allocatedQuantity: 10,
    weightedUnitPriceInvoiced: 5, invoicedUnit: 'UN',
    ...overrides,
  };
}

describe('classifyPoItem', () => {
  it('confere quando quantidade e preço batem', () => {
    expect(classifyPoItem(input()).status).toBe('ok');
  });

  it('quantidade menor que a OC', () => {
    expect(classifyPoItem(input({ allocatedQuantity: 6 })).status).toBe('quantity_less');
  });

  it('quantidade maior que a OC', () => {
    expect(classifyPoItem(input({ allocatedQuantity: 14 })).status).toBe('quantity_greater');
  });

  it('preço unitário divergente além da tolerância', () => {
    expect(classifyPoItem(input({ weightedUnitPriceInvoiced: 6 })).status).toBe('price_divergent');
  });

  it('pequena diferença de preço dentro da tolerância confere', () => {
    expect(classifyPoItem(input({ unitPriceOrdered: 100, weightedUnitPriceInvoiced: 100.3 })).status).toBe('ok');
  });

  it('unidade divergente', () => {
    expect(classifyPoItem(input({ unit: 'UN', invoicedUnit: 'CX' })).status).toBe('unit_divergent');
  });

  it('item da OC não encontrado em nenhuma NF-e', () => {
    expect(classifyPoItem(input({ allocatedQuantity: 0, hasNoCandidates: true, hasUnresolvedCandidates: false })).status).toBe('po_item_not_found');
  });

  it('produto aguardando vínculo manual quando há candidato não resolvido', () => {
    expect(classifyPoItem(input({ allocatedQuantity: 0, hasNoCandidates: false, hasUnresolvedCandidates: true })).status).toBe('awaiting_manual_link');
  });
});

describe('priceTolerance', () => {
  it('nunca é menor que R$0,01', () => {
    expect(priceTolerance(0.5)).toBeCloseTo(0.01, 5);
  });

  it('escala com 0,5% para valores maiores', () => {
    expect(priceTolerance(1000)).toBeCloseTo(5, 5);
  });
});

describe('summarizeReconciliation', () => {
  it('resume quantidade de itens por categoria', () => {
    const comparisons = [
      classifyPoItem(input({ poItemId: 'a' })),
      classifyPoItem(input({ poItemId: 'b', allocatedQuantity: 6 })),
      classifyPoItem(input({ poItemId: 'c', allocatedQuantity: 0, hasNoCandidates: true })),
    ];
    const summary = summarizeReconciliation(comparisons, 2);
    expect(summary.total).toBe(3);
    expect(summary.ok).toBe(1);
    expect(summary.divergent).toBe(1);
    expect(summary.notFound).toBe(1);
    expect(summary.notPredictedInPos).toBe(2);
  });
});
