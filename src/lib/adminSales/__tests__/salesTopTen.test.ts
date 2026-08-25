import { describe, expect, it } from 'vitest';
import { aggregateTopTen, computeTopTen, filterRecordsByPeriod, resolvePeriodRange, type SalesRecordInput } from '../salesTopTen';

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
