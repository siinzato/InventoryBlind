import { describe, expect, it } from 'vitest';
import {
  aggregateGroup, buildAbcDistribution, buildCurveComparison, buildPareto,
  filterSnapshots, hasActiveFilters, hasStockData, observedProfit, soldSkuCount,
  EMPTY_PRODUCT_FILTERS, type AbcRow, type ProductFilters,
} from '../abcCurveAnalytics';

const row = (overrides: Partial<AbcRow> & { sku: string }): AbcRow => ({
  product_name: `Produto ${overrides.sku}`,
  quantity: 10, revenue: 100, gross_profit: 40, gross_margin: 0.4, cost_state: 'NORMAL',
  turnover_class: 'A', revenue_class: 'A', profit_class: 'A',
  stock_available: null, coverage_days: null,
  ...overrides,
});

// Curva de faturamento: A=800, B=150, C=50 (o mesmo cenário do motor), mais um SKU só de
// estoque (sem classe em nenhuma curva) e um em prejuízo.
const SAMPLE: AbcRow[] = [
  row({ sku: 'A1', revenue: 800, quantity: 80, gross_profit: 300, revenue_class: 'A', turnover_class: 'A', profit_class: 'A' }),
  row({ sku: 'B1', revenue: 150, quantity: 15, gross_profit: 50, revenue_class: 'B', turnover_class: 'B', profit_class: 'B' }),
  row({ sku: 'C1', revenue: 50, quantity: 5, gross_profit: 10, revenue_class: 'C', turnover_class: 'C', profit_class: 'C' }),
  row({ sku: 'PARADO', revenue: 0, quantity: 0, gross_profit: null, gross_margin: null, cost_state: 'SEM_CUSTO', revenue_class: null, turnover_class: null, profit_class: null, stock_available: 40 }),
  row({ sku: 'PREJU', revenue: 30, quantity: 3, gross_profit: -20, gross_margin: -0.66, cost_state: 'PREJUIZO', revenue_class: 'C', turnover_class: 'C', profit_class: null, stock_available: 0 }),
];

describe('buildAbcDistribution', () => {
  it('conta e distribui sobre os SKUs ELEGÍVEIS, sem incluir os sem classe', () => {
    const dist = buildAbcDistribution(SAMPLE, 'revenue');
    expect(dist.eligibleCount).toBe(4); // PARADO fica fora
    expect(dist.ineligibleCount).toBe(1);

    const a = dist.classes.find(c => c.cls === 'A')!;
    expect(a.skuCount).toBe(1);
    expect(a.skuPct).toBeCloseTo(25, 5);          // 1 de 4 elegíveis
    expect(a.metricShare).toBeCloseTo(77.67, 1);  // 800 de 1030
  });

  it('não inventa distribuição para população vazia', () => {
    const dist = buildAbcDistribution([], 'revenue');
    expect(dist.eligibleCount).toBe(0);
    expect(dist.classes.every(c => c.skuCount === 0 && c.metricShare === 0)).toBe(true);
  });

  it('a curva de lucro ignora prejuízo e SKU sem custo', () => {
    const dist = buildAbcDistribution(SAMPLE, 'profit');
    expect(dist.eligibleCount).toBe(3);
    expect(dist.classes.reduce((s, c) => s + c.skuCount, 0)).toBe(3);
  });
});

describe('buildPareto', () => {
  it('ordena decrescente e fecha o acumulado em 100%', () => {
    const pareto = buildPareto(SAMPLE, 'revenue');
    expect(pareto.bins.map(b => b.sublabel)).toEqual(['A1', 'B1', 'C1', 'PREJU']);
    expect(pareto.bins[0].individualPct).toBeCloseTo(77.67, 1);
    expect(pareto.bins[pareto.bins.length - 1].cumulativePct).toBeCloseTo(100, 5);
    expect(pareto.grouped).toBe(false);
  });

  it('agrupa barras quando há mais SKUs que barras, preservando o total real', () => {
    const many: AbcRow[] = Array.from({ length: 500 }, (_, i) => row({ sku: `S${i}`, revenue: 500 - i, quantity: 1 }));
    const pareto = buildPareto(many, 'revenue', 60);
    expect(pareto.bins.length).toBe(60);
    expect(pareto.grouped).toBe(true);
    expect(pareto.eligibleCount).toBe(500);
    expect(pareto.bins.reduce((s, b) => s + b.value, 0)).toBe(pareto.total);
    expect(pareto.bins[pareto.bins.length - 1].cumulativePct).toBeCloseTo(100, 5);
    expect(pareto.bins.reduce((s, b) => s + b.skuCount, 0)).toBe(500);
  });

  it('SKU não elegível não entra no Pareto', () => {
    const pareto = buildPareto(SAMPLE, 'revenue');
    expect(pareto.bins.some(b => b.sublabel === 'PARADO')).toBe(false);
  });

  it('curva sem nenhum elegível devolve Pareto vazio em vez de barra fantasma', () => {
    const pareto = buildPareto([row({ sku: 'X', revenue: 0, quantity: 0, revenue_class: null, turnover_class: null, profit_class: null })], 'revenue');
    expect(pareto.bins).toHaveLength(0);
    expect(pareto.total).toBe(0);
  });
});

describe('buildCurveComparison', () => {
  it('devolve as três curvas com contagens próprias de cada uma', () => {
    const rows = buildCurveComparison(SAMPLE);
    expect(rows.map(r => r.metric)).toEqual(['turnover', 'revenue', 'profit']);
    expect(rows.find(r => r.metric === 'revenue')!.eligible).toBe(4);
    expect(rows.find(r => r.metric === 'profit')!.eligible).toBe(3);
    expect(rows.find(r => r.metric === 'profit')!.a).toBe(1);
  });
});

describe('observedProfit', () => {
  it('soma só lucro não-nulo e informa sobre quantos SKUs a conta foi feita', () => {
    const profit = observedProfit(SAMPLE);
    expect(profit.total).toBe(300 + 50 + 10 - 20);
    expect(profit.coveredSkus).toBe(4);
    expect(profit.totalSkus).toBe(5);
    expect(profit.coveragePct).toBeCloseTo(80, 5);
  });

  it('não inventa lucro quando nenhum SKU tem custo', () => {
    const profit = observedProfit([row({ sku: 'X', gross_profit: null, cost_state: 'SEM_CUSTO' })]);
    expect(profit.total).toBe(0);
    expect(profit.coveredSkus).toBe(0);
    expect(profit.coveragePct).toBe(0);
  });
});

describe('soldSkuCount / hasStockData', () => {
  it('separa quem teve movimento comercial de quem só existe no estoque', () => {
    expect(soldSkuCount(SAMPLE)).toBe(4);
    expect(hasStockData(SAMPLE)).toBe(true);
    expect(hasStockData([row({ sku: 'X', stock_available: null })])).toBe(false);
  });
});

describe('filterSnapshots', () => {
  const recs = new Map([['A1', { code: 'COMPRA_URGENTE' }], ['PARADO', { code: 'ESTOQUE_PARADO' }]]);
  const withFilters = (overrides: Partial<ProductFilters>) => ({ ...EMPTY_PRODUCT_FILTERS, ...overrides });

  it('sem filtro devolve tudo, na mesma ordem, sem mutar a lista original', () => {
    const original = [...SAMPLE];
    const out = filterSnapshots(SAMPLE, EMPTY_PRODUCT_FILTERS, recs);
    expect(out).toHaveLength(SAMPLE.length);
    expect(out.map(r => r.sku)).toEqual(SAMPLE.map(r => r.sku));
    expect(SAMPLE).toEqual(original);
  });

  it('busca respeita SKU e nome do produto, sem diferenciar maiúsculas', () => {
    expect(filterSnapshots(SAMPLE, withFilters({ search: 'parado' }), recs).map(r => r.sku)).toEqual(['PARADO']);
    expect(filterSnapshots(SAMPLE, withFilters({ search: 'Produto B1' }), recs).map(r => r.sku)).toEqual(['B1']);
    expect(filterSnapshots(SAMPLE, withFilters({ search: 'inexistente' }), recs)).toHaveLength(0);
  });

  it('filtro de classe funciona nas três curvas, e "Sem classe" é um recorte próprio', () => {
    expect(filterSnapshots(SAMPLE, withFilters({ revenue: 'A' }), recs).map(r => r.sku)).toEqual(['A1']);
    expect(filterSnapshots(SAMPLE, withFilters({ revenue: 'C' }), recs).map(r => r.sku)).toEqual(['C1', 'PREJU']);
    expect(filterSnapshots(SAMPLE, withFilters({ profit: 'none' }), recs).map(r => r.sku)).toEqual(['PARADO', 'PREJU']);
  });

  it('filtro de status de custo e de recomendação', () => {
    expect(filterSnapshots(SAMPLE, withFilters({ cost: 'PREJUIZO' }), recs).map(r => r.sku)).toEqual(['PREJU']);
    expect(filterSnapshots(SAMPLE, withFilters({ cost: 'SEM_CUSTO' }), recs).map(r => r.sku)).toEqual(['PARADO']);
    expect(filterSnapshots(SAMPLE, withFilters({ recommendation: 'ESTOQUE_PARADO' }), recs).map(r => r.sku)).toEqual(['PARADO']);
  });

  it('filtros de estoque nunca tratam saldo desconhecido como zero', () => {
    expect(filterSnapshots(SAMPLE, withFilters({ stock: 'with' }), recs).map(r => r.sku)).toEqual(['PARADO']);
    expect(filterSnapshots(SAMPLE, withFilters({ stock: 'without' }), recs).map(r => r.sku)).toEqual(['PREJU']);
    expect(filterSnapshots(SAMPLE, withFilters({ stock: 'idle' }), recs).map(r => r.sku)).toEqual(['PARADO']);
    // A1/B1/C1 têm stock_available null — ficam fora de todos os recortes de estoque.
    expect(filterSnapshots(SAMPLE, withFilters({ stock: 'with' }), recs).some(r => r.sku === 'A1')).toBe(false);
  });

  it('filtros combinam (E lógico)', () => {
    expect(filterSnapshots(SAMPLE, withFilters({ revenue: 'C', cost: 'PREJUIZO' }), recs).map(r => r.sku)).toEqual(['PREJU']);
    expect(filterSnapshots(SAMPLE, withFilters({ revenue: 'A', cost: 'PREJUIZO' }), recs)).toHaveLength(0);
  });

  it('a paginação ocorre DEPOIS do filtro (fatia o conjunto filtrado, não o total)', () => {
    const many: AbcRow[] = Array.from({ length: 120 }, (_, i) =>
      row({ sku: `S${i}`, revenue: 120 - i, revenue_class: i < 40 ? 'A' : 'C' }));
    const filtered = filterSnapshots(many, withFilters({ revenue: 'A' }), new Map());
    const PAGE_SIZE = 50;
    expect(filtered).toHaveLength(40);
    expect(Math.ceil(filtered.length / PAGE_SIZE)).toBe(1);
    expect(filtered.slice(0, PAGE_SIZE)).toHaveLength(40);
  });

  it('hasActiveFilters reconhece qualquer recorte aplicado', () => {
    expect(hasActiveFilters(EMPTY_PRODUCT_FILTERS)).toBe(false);
    expect(hasActiveFilters(withFilters({ search: '  ' }))).toBe(false);
    expect(hasActiveFilters(withFilters({ search: 'x' }))).toBe(true);
    expect(hasActiveFilters(withFilters({ stock: 'idle' }))).toBe(true);
  });
});

describe('aggregateGroup', () => {
  it('agrega somente os SKUs daquele grupo, sem projetar impacto', () => {
    const group = [SAMPLE[0], SAMPLE[1]]; // A1 + B1
    const totals = aggregateGroup(group);
    expect(totals.skuCount).toBe(2);
    expect(totals.revenue).toBe(950);
    expect(totals.profit).toBe(350);
    expect(totals.profitCoveredSkus).toBe(2);
    expect(totals.stock).toBeNull(); // nenhum dos dois tem snapshot de estoque
  });

  it('estoque somado só quando existe snapshot; lucro só sobre SKU com custo', () => {
    const totals = aggregateGroup([SAMPLE[3], SAMPLE[4]]); // PARADO (sem custo) + PREJU
    expect(totals.stock).toBe(40);
    expect(totals.profitCoveredSkus).toBe(1);
    expect(totals.profit).toBe(-20);
  });

  it('grupo vazio não fabrica número', () => {
    const totals = aggregateGroup([]);
    expect(totals).toEqual({ skuCount: 0, revenue: 0, profit: 0, profitCoveredSkus: 0, stock: null });
  });
});
