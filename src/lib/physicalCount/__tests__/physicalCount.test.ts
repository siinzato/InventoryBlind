import { describe, it, expect } from 'vitest';
import { sortLocationsNaturally, listDistinctLocations, resolveProductsInLocationRange, describeLocation } from '../locationAddressing';
import {
  computeItemResult,
  computeSessionSummary,
  computeTotalFound,
  shouldRecommendRecount,
  shouldRecommendThirdCountRound,
  estimateSheetsAvoided,
  classifyScopeAvailability,
} from '../physicalCountAlgorithm';

// ── locationAddressing ───────────────────────────────────────────────────────
// These operate on REAL, already-registered location strings only — no format
// is assumed or parsed (see locationAddressing.ts for why: products.location
// is free text from each company's own spreadsheet import).

describe('sortLocationsNaturally', () => {
  it('orders numeric suffixes correctly, not lexicographically', () => {
    expect(sortLocationsNaturally(['P1-A010', 'P1-A002', 'P1-A001'])).toEqual(['P1-A001', 'P1-A002', 'P1-A010']);
  });

  it('handles arbitrary, non-standardized real-world formats', () => {
    expect(sortLocationsNaturally(['Corredor 3', 'Depósito Central', 'Corredor 1'])).toEqual([
      'Corredor 1',
      'Corredor 3',
      'Depósito Central',
    ]);
  });
});

describe('listDistinctLocations', () => {
  it('deduplicates and sorts, ignoring null/empty locations', () => {
    expect(
      listDistinctLocations([{ location: 'P1-A002' }, { location: 'P1-A001' }, { location: 'P1-A001' }, { location: null }, { location: '  ' }])
    ).toEqual(['P1-A001', 'P1-A002']);
  });

  it('works for any real-world location format, not just ZONE-STREET-POSITION', () => {
    expect(listDistinctLocations([{ location: 'Corredor 3' }, { location: 'Depósito Central' }])).toEqual([
      'Corredor 3',
      'Depósito Central',
    ]);
  });
});

describe('resolveProductsInLocationRange', () => {
  const products = [
    { id: '1', location: 'P1-A001' },
    { id: '2', location: 'P1-A002' },
    { id: '3', location: 'P1-A003' },
    { id: '4', location: 'P1-A004' },
  ];
  const sorted = ['P1-A001', 'P1-A002', 'P1-A003', 'P1-A004'];

  it('includes every product between the two real boundary values, inclusive', () => {
    expect(resolveProductsInLocationRange(products, sorted, 'P1-A002', 'P1-A004').map(p => p.id)).toEqual(['2', '3', '4']);
  });

  it('works regardless of from/to order', () => {
    expect(resolveProductsInLocationRange(products, sorted, 'P1-A004', 'P1-A002').map(p => p.id)).toEqual(['2', '3', '4']);
  });

  it('a single-location range still matches that one location', () => {
    expect(resolveProductsInLocationRange(products, sorted, 'P1-A002', 'P1-A002').map(p => p.id)).toEqual(['2']);
  });

  it('never fails to find a real product due to a format mismatch — this was the original bug', () => {
    // "Corredor 3" would never match a "ZONE-STREET-POSITION" regex, but since
    // it's a real, registered value it must still resolve correctly.
    const freeform = [{ id: 'a', location: 'Corredor 3' }, { id: 'b', location: 'Corredor 5' }];
    const freeformSorted = ['Corredor 3', 'Corredor 5'];
    expect(resolveProductsInLocationRange(freeform, freeformSorted, 'Corredor 3', 'Corredor 5').map(p => p.id)).toEqual(['a', 'b']);
  });

  it('returns nothing when a boundary is not an actual registered value', () => {
    expect(resolveProductsInLocationRange(products, sorted, 'P1-A999', 'P1-A004')).toEqual([]);
  });
});

describe('describeLocation', () => {
  it('is the raw, official value — no reinterpretation', () => {
    expect(describeLocation('P1-A001-A')).toBe('P1-A001-A');
    expect(describeLocation('Corredor 3')).toBe('Corredor 3');
  });

  it('falls back to an em dash when empty', () => {
    expect(describeLocation('')).toBe('—');
    expect(describeLocation(null)).toBe('—');
  });
});

// ── physicalCountAlgorithm ───────────────────────────────────────────────────

describe('computeItemResult', () => {
  it('is null while uncounted', () => {
    expect(computeItemResult({ erpQuantitySnapshot: 10, physicalQuantity: null })).toBeNull();
  });

  it('is ok when quantities match', () => {
    expect(computeItemResult({ erpQuantitySnapshot: 10, physicalQuantity: 10 })).toBe('ok');
  });

  it('is missing when physical is lower', () => {
    expect(computeItemResult({ erpQuantitySnapshot: 10, physicalQuantity: 7 })).toBe('missing');
  });

  it('is surplus when physical is higher', () => {
    expect(computeItemResult({ erpQuantitySnapshot: 10, physicalQuantity: 13 })).toBe('surplus');
  });
});

describe('computeTotalFound / computeItemResult with found-elsewhere quantity', () => {
  it('is null while nothing was counted at all (neither local nor excedente)', () => {
    expect(computeTotalFound({ erpQuantitySnapshot: 10, physicalQuantity: null })).toBeNull();
    expect(computeItemResult({ erpQuantitySnapshot: 10, physicalQuantity: null })).toBeNull();
  });

  it('counts as touched once an excedente was logged, even with local still null', () => {
    expect(computeTotalFound({ erpQuantitySnapshot: 10, physicalQuantity: null, foundElsewhereQuantity: 4 })).toBe(4);
  });

  it('reconciles against the ERP snapshot using local + excedente combined', () => {
    // 8 no local esperado + 2 em outro local = 10, bate com o ERP — mesmo que
    // separadamente 8 pareça "faltando 2", o produto inteiro foi explicado.
    const item = { erpQuantitySnapshot: 10, physicalQuantity: 8, foundElsewhereQuantity: 2 };
    expect(computeTotalFound(item)).toBe(10);
    expect(computeItemResult(item)).toBe('ok');
  });

  it('still reports a real shortfall when local + excedente together do not cover the ERP snapshot', () => {
    const item = { erpQuantitySnapshot: 10, physicalQuantity: 6, foundElsewhereQuantity: 1 };
    expect(computeItemResult(item)).toBe('missing');
  });

  it('defaults foundElsewhereQuantity to 0 when omitted — same result as before this field existed', () => {
    expect(computeItemResult({ erpQuantitySnapshot: 10, physicalQuantity: 10 })).toBe('ok');
  });
});

describe('computeSessionSummary', () => {
  it('matches the ticket example (428 counted, 397 ok, 31 divergent, -74/+21, net -53)', () => {
    const items = [
      ...Array.from({ length: 397 }, () => ({ erpQuantitySnapshot: 10, physicalQuantity: 10 })),
      ...Array.from({ length: 20 }, () => ({ erpQuantitySnapshot: 10, physicalQuantity: 10 - 74 / 20 })),
      ...Array.from({ length: 11 }, () => ({ erpQuantitySnapshot: 10, physicalQuantity: 10 + 21 / 11 })),
    ];
    const summary = computeSessionSummary(items);
    expect(summary.countedItems).toBe(428);
    expect(summary.okItems).toBe(397);
    expect(summary.divergentItems).toBe(31);
    expect(Math.round(summary.missingUnits)).toBe(-74);
    expect(Math.round(summary.surplusUnits)).toBe(21);
    expect(Math.round(summary.netAdjustment)).toBe(-53);
  });

  it('excludes uncounted items from accuracy but keeps them in totalItems', () => {
    const summary = computeSessionSummary([
      { erpQuantitySnapshot: 5, physicalQuantity: 5 },
      { erpQuantitySnapshot: 5, physicalQuantity: null },
    ]);
    expect(summary.totalItems).toBe(2);
    expect(summary.countedItems).toBe(1);
    expect(summary.accuracyPct).toBe(100);
  });

  it('returns 0 accuracy for an all-uncounted session', () => {
    const summary = computeSessionSummary([{ erpQuantitySnapshot: 5, physicalQuantity: null }]);
    expect(summary.accuracyPct).toBe(0);
  });
});

describe('shouldRecommendRecount', () => {
  it('recommends a recount whenever there is at least one divergence', () => {
    const summary = computeSessionSummary([{ erpQuantitySnapshot: 5, physicalQuantity: 4 }]);
    expect(shouldRecommendRecount(summary)).toBe(true);
  });

  it('does not recommend a recount when everything matched', () => {
    const summary = computeSessionSummary([{ erpQuantitySnapshot: 5, physicalQuantity: 5 }]);
    expect(shouldRecommendRecount(summary)).toBe(false);
  });
});

describe('shouldRecommendThirdCountRound', () => {
  it('reuses the existing >10 threshold from countManagementUtils', () => {
    expect(shouldRecommendThirdCountRound(10)).toBe(false);
    expect(shouldRecommendThirdCountRound(11)).toBe(true);
  });
});

describe('estimateSheetsAvoided', () => {
  it('rounds up to the next full sheet', () => {
    expect(estimateSheetsAvoided(40, 40)).toBe(1);
    expect(estimateSheetsAvoided(41, 40)).toBe(2);
    expect(estimateSheetsAvoided(0)).toBe(0);
  });
});

describe('classifyScopeAvailability', () => {
  // Regressão do bug real: a tela mostrava "nenhuma localização cadastrada"
  // sem distinguir "empresa sem nenhum produto" (provável empresa errada no
  // seletor de workspace) de "produtos existem, location não preenchido".
  it('is no_products when the company has zero products at all', () => {
    expect(classifyScopeAvailability({ totalProducts: 0, locatedProducts: 0 })).toBe('no_products');
  });

  it('is no_locations when products exist but none have a location', () => {
    expect(classifyScopeAvailability({ totalProducts: 50, locatedProducts: 0 })).toBe('no_locations');
  });

  it('is ok when at least one product has a location', () => {
    expect(classifyScopeAvailability({ totalProducts: 50, locatedProducts: 1 })).toBe('ok');
  });
});
