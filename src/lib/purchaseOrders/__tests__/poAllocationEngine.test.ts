import { describe, expect, it } from 'vitest';
import {
  proposeAutoAllocations, sumAllocatedForNfeItem, sumAllocatedForPoItem, wouldExceedNfeItemQuantity,
} from '../poAllocationEngine';
import type { PoMatchResult } from '../poProductMatcher';

function match(overrides: Partial<PoMatchResult> = {}): PoMatchResult {
  return { poItemId: 'po-1', candidates: [], ambiguous: false, nameSuggestion: null, ...overrides };
}

describe('proposeAutoAllocations', () => {
  it('aloca até a quantidade não atendida da OC, respeitando a capacidade da NF-e', () => {
    const matches = [match({ poItemId: 'po-1', candidates: [{ nfeItemId: 'nfe-1', method: 'code' }] })];
    const proposals = proposeAutoAllocations(matches, new Map([['po-1', 10]]), new Map([['nfe-1', 6]]));
    expect(proposals).toEqual([{ poItemId: 'po-1', nfeItemId: 'nfe-1', quantity: 6, matchMethod: 'code' }]);
  });

  it('um item de OC pode receber quantidades de várias NF-es', () => {
    const matches = [match({
      poItemId: 'po-1',
      candidates: [{ nfeItemId: 'nfe-1', method: 'code' }, { nfeItemId: 'nfe-2', method: 'code' }],
    })];
    const proposals = proposeAutoAllocations(matches, new Map([['po-1', 10]]), new Map([['nfe-1', 4], ['nfe-2', 20]]));
    expect(proposals.find(p => p.nfeItemId === 'nfe-1')?.quantity).toBe(4);
    expect(proposals.find(p => p.nfeItemId === 'nfe-2')?.quantity).toBe(6);
  });

  it('um item de NF-e pode ser repartido entre itens de OC diferentes', () => {
    const matches = [
      match({ poItemId: 'po-1', candidates: [{ nfeItemId: 'nfe-1', method: 'code' }] }),
      match({ poItemId: 'po-2', candidates: [{ nfeItemId: 'nfe-1', method: 'code' }] }),
    ];
    const proposals = proposeAutoAllocations(
      matches,
      new Map([['po-1', 5], ['po-2', 8]]),
      new Map([['nfe-1', 10]])
    );
    expect(proposals.find(p => p.poItemId === 'po-1')?.quantity).toBe(5);
    expect(proposals.find(p => p.poItemId === 'po-2')?.quantity).toBe(5); // só resta 5 depois de atender po-1
  });

  it('não aloca item ambíguo — exige escolha manual', () => {
    const matches = [match({ poItemId: 'po-1', ambiguous: true, candidates: [{ nfeItemId: 'nfe-1', method: 'code' }] })];
    const proposals = proposeAutoAllocations(matches, new Map([['po-1', 10]]), new Map([['nfe-1', 10]]));
    expect(proposals).toEqual([]);
  });

  it('não aloca quando não há candidatos', () => {
    const matches = [match({ poItemId: 'po-1', candidates: [] })];
    const proposals = proposeAutoAllocations(matches, new Map([['po-1', 10]]), new Map());
    expect(proposals).toEqual([]);
  });

  it('nunca muta os Maps recebidos (quantidade original preservada para o chamador)', () => {
    const demand = new Map([['po-1', 10]]);
    const capacity = new Map([['nfe-1', 5]]);
    proposeAutoAllocations([match({ poItemId: 'po-1', candidates: [{ nfeItemId: 'nfe-1', method: 'code' }] })], demand, capacity);
    expect(demand.get('po-1')).toBe(10);
    expect(capacity.get('nfe-1')).toBe(5);
  });
});

describe('sumAllocatedForNfeItem / sumAllocatedForPoItem', () => {
  const allocations = [
    { nfeItemId: 'nfe-1', poItemId: 'po-1', allocatedQuantity: 3 },
    { nfeItemId: 'nfe-1', poItemId: 'po-2', allocatedQuantity: 4 },
  ];

  it('soma por item de NF-e', () => {
    expect(sumAllocatedForNfeItem(allocations, 'nfe-1')).toBe(7);
  });

  it('soma por item de OC', () => {
    expect(sumAllocatedForPoItem(allocations, 'po-1')).toBe(3);
  });
});

describe('wouldExceedNfeItemQuantity', () => {
  it('avisa quando a soma excederia a quantidade do item de NF-e', () => {
    const existing = [{ nfeItemId: 'nfe-1', allocatedQuantity: 8 }];
    expect(wouldExceedNfeItemQuantity(existing, 'nfe-1', 10, 3)).toBe(true);
    expect(wouldExceedNfeItemQuantity(existing, 'nfe-1', 10, 2)).toBe(false);
  });
});
