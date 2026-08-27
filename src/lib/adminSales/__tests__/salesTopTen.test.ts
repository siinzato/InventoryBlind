import { describe, expect, it } from 'vitest';
import {
  aggregateTopTen, computeTopTen, filterRecordsByPeriod, resolvePeriodRange, resolveAutomaticTopTen,
  type SalesRecordInput, type AbcSnapshotInput,
} from '../salesTopTen';

const REF = new Date('2026-08-24T12:00:00Z');

const RECORDS: SalesRecordInput[] = [
  { saleDate: '2026-08-20', sku: 'A1', productName: 'Produto A', quantity: 10, totalValue: 100 },
  { saleDate: '2026-08-21', sku: 'A1', productName: 'Produto A', quantity: 5, totalValue: 50 },
  { saleDate: '2026-08-21', sku: 'B1', productName: 'Produto B', quantity: 30, totalValue: 60 },
  { saleDate: '2026-01-01', sku: 'C1', productName: 'Produto C', quantity: 999, totalValue: 999 }, // fora do período
  { saleDate: '2026-08-22', sku: null, productName: 'Produto Sem SKU', quantity: 3, totalValue: 9 },
];

describe('aggregateTopTen', () => {
  it('agrega por SKU e ordena por quantidade quando a métrica é quantidade', () => {
    const result = aggregateTopTen(RECORDS.filter(r => r.saleDate !== '2026-01-01'), 'quantidade');
    expect(result[0].sku).toBe('B1');
    expect(result[0].quantity).toBe(30);
    expect(result[1].sku).toBe('A1');
    expect(result[1].quantity).toBe(15); // soma das duas vendas de A1
  });

  it('ordena por faturamento quando a métrica é faturamento', () => {
    const result = aggregateTopTen(RECORDS.filter(r => r.saleDate !== '2026-01-01'), 'faturamento');
    expect(result[0].sku).toBe('A1');
    expect(result[0].totalValue).toBe(150);
  });

  it('produto sem SKU nunca é somado com outro produto sem SKU de nome diferente', () => {
    const records: SalesRecordInput[] = [
      { saleDate: '2026-08-01', sku: null, productName: 'X', quantity: 1, totalValue: 1 },
      { saleDate: '2026-08-01', sku: null, productName: 'Y', quantity: 1, totalValue: 1 },
    ];
    const result = aggregateTopTen(records, 'quantidade');
    expect(result).toHaveLength(2);
  });

  it('respeita o limite passado', () => {
    const many: SalesRecordInput[] = Array.from({ length: 15 }, (_, i) => ({
      saleDate: '2026-08-01', sku: `SKU${i}`, productName: `P${i}`, quantity: i, totalValue: i,
    }));
    expect(aggregateTopTen(many, 'quantidade', 10)).toHaveLength(10);
  });
});

describe('resolvePeriodRange', () => {
  it('7 dias inclui a data de referência e os 6 dias anteriores', () => {
    const range = resolvePeriodRange({ preset: '7d' }, REF);
    expect(range).toEqual({ from: '2026-08-18', to: '2026-08-24' });
  });

  it('mês atual começa no dia 1 do mês de referência', () => {
    const range = resolvePeriodRange({ preset: 'mes_atual' }, REF);
    expect(range).toEqual({ from: '2026-08-01', to: '2026-08-24' });
  });

  it('custom usa exatamente o from/to informado', () => {
    const range = resolvePeriodRange({ preset: 'custom', from: '2026-01-01', to: '2026-01-31' }, REF);
    expect(range).toEqual({ from: '2026-01-01', to: '2026-01-31' });
  });
});

describe('filterRecordsByPeriod / computeTopTen', () => {
  it('exclui vendas fora do período (isolamento temporal, não de empresa)', () => {
    const filtered = filterRecordsByPeriod(RECORDS, { from: '2026-08-01', to: '2026-08-31' });
    expect(filtered.some(r => r.sku === 'C1')).toBe(false);
  });

  it('computeTopTen combina período + agregação', () => {
    const result = computeTopTen(RECORDS, 'quantidade', { preset: '30d' }, REF);
    expect(result.find(r => r.sku === 'C1')).toBeUndefined();
    expect(result.some(r => r.sku === 'B1')).toBe(true);
  });
});

describe('resolveAutomaticTopTen — Top 10 automático pela Curva ABC', () => {
  const snapshot = (over: Partial<AbcSnapshotInput>): AbcSnapshotInput => ({
    sku: 'SKU', productId: 'p-sku', productName: 'Produto', revenue: 0, quantity: 0, grossProfit: 0, ...over,
  });

  it('ordena por faturamento decrescente quando o critério é revenue', () => {
    const snapshots = [
      snapshot({ sku: 'A', productId: 'p-a', revenue: 100 }),
      snapshot({ sku: 'B', productId: 'p-b', revenue: 300 }),
      snapshot({ sku: 'C', productId: 'p-c', revenue: 200 }),
    ];
    const result = resolveAutomaticTopTen(snapshots, 'revenue', new Map());
    expect(result.entries.map(e => e.sku)).toEqual(['B', 'C', 'A']);
    expect(result.entries.map(e => e.position)).toEqual([1, 2, 3]);
  });

  it('ordena por quantidade decrescente quando o critério é quantity', () => {
    const snapshots = [
      snapshot({ sku: 'A', productId: 'p-a', quantity: 5 }),
      snapshot({ sku: 'B', productId: 'p-b', quantity: 40 }),
      snapshot({ sku: 'C', productId: 'p-c', quantity: 12 }),
    ];
    const result = resolveAutomaticTopTen(snapshots, 'quantity', new Map());
    expect(result.entries.map(e => e.sku)).toEqual(['B', 'C', 'A']);
  });

  it('ordena por lucro bruto decrescente e ignora registros sem lucro bruto disponível, sem quebrar o ranking', () => {
    const snapshots = [
      snapshot({ sku: 'A', productId: 'p-a', grossProfit: 50 }),
      snapshot({ sku: 'B', productId: 'p-b', grossProfit: null }),
      snapshot({ sku: 'C', productId: 'p-c', grossProfit: 120 }),
    ];
    const result = resolveAutomaticTopTen(snapshots, 'gross_profit', new Map());
    expect(result.entries.map(e => e.sku)).toEqual(['C', 'A']);
    expect(result.ignoredForMissingMetric).toBe(1);
  });

  it('desempate determinístico: métrica igual cai para faturamento, depois SKU alfabético', () => {
    const snapshots = [
      snapshot({ sku: 'Z', productId: 'p-z', quantity: 10, revenue: 100 }),
      snapshot({ sku: 'B', productId: 'p-b', quantity: 10, revenue: 100 }),
      snapshot({ sku: 'A', productId: 'p-a', quantity: 10, revenue: 200 }),
    ];
    const result = resolveAutomaticTopTen(snapshots, 'quantity', new Map());
    // A vence por faturamento maior; entre B e Z (mesma métrica e mesmo faturamento), B vem primeiro por SKU.
    expect(result.entries.map(e => e.sku)).toEqual(['A', 'B', 'Z']);
  });

  it('ignora produto sem correspondência no catálogo e continua o ranking até 10 elegíveis', () => {
    const snapshots = [
      snapshot({ sku: 'A', productId: null, revenue: 500 }), // sem productId e sem fallback -> ignorado
      snapshot({ sku: 'B', productId: 'p-b', revenue: 300 }),
      snapshot({ sku: 'C', productId: 'p-c', revenue: 200 }),
    ];
    const result = resolveAutomaticTopTen(snapshots, 'revenue', new Map());
    expect(result.entries.map(e => e.sku)).toEqual(['B', 'C']);
    expect(result.ignoredForNoCatalogMatch).toBe(1);
  });

  it('usa o SKU normalizado como fallback só quando não há productId já vinculado', () => {
    const snapshots = [
      snapshot({ sku: ' sku-x ', productId: null, revenue: 50 }),
      snapshot({ sku: 'sku-y', productId: 'p-direct', revenue: 10 }),
    ];
    const fallback = new Map([['SKU-X', 'p-fallback']]);
    const result = resolveAutomaticTopTen(snapshots, 'revenue', fallback);
    expect(result.entries.map(e => e.productId)).toEqual(['p-fallback', 'p-direct']);
  });

  it('retorna no máximo 10 produtos mesmo com mais elegíveis', () => {
    const snapshots = Array.from({ length: 15 }, (_, i) =>
      snapshot({ sku: `S${i}`, productId: `p-${i}`, revenue: i })
    );
    const result = resolveAutomaticTopTen(snapshots, 'revenue', new Map());
    expect(result.entries).toHaveLength(10);
  });
});
