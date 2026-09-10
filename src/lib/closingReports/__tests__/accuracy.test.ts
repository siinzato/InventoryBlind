import { describe, expect, it } from 'vitest';
import { computeAccuracy } from '../../blindAIAgentAlgorithm';
import { isAccuracyStale, buildClosingResults, type ClosingResultRow } from '../closingReportService';
import type { ClosingReport } from '../closingReportTypes';

describe('computeAccuracy — fonte única de acuracidade final (dashboard + relatório)', () => {
  it('caso Nillkin: 195 SKUs contados e 110 divergências ficam em ~43.589743, exibido como 43.6% com uma casa decimal', () => {
    const result = computeAccuracy(195, 110);
    expect(result).not.toBeNull();
    expect(result as number).toBeCloseTo(43.589743, 5);
    expect((result as number).toFixed(1)).toBe('43.6');
  });

  it('zero SKUs contados retorna null, nunca NaN ou Infinity', () => {
    expect(computeAccuracy(0, 0)).toBeNull();
    expect(computeAccuracy(0, 5)).toBeNull();
  });

  it('divergências acima dos SKUs contados resultam em 0%, nunca negativo', () => {
    expect(computeAccuracy(10, 25)).toBe(0);
  });

  it('sem nenhuma divergência resulta em 100%', () => {
    expect(computeAccuracy(50, 0)).toBe(100);
  });
});

describe('isAccuracyStale — decisão pura de autocorreção do relatório', () => {
  it('relatório persistido com 0 é identificado como desatualizado diante do canônico 43.589743...', () => {
    expect(isAccuracyStale(0, 43.589743589743584)).toBe(true);
  });

  it('relatório já correto (dentro da tolerância de arredondamento) não é marcado como desatualizado', () => {
    expect(isAccuracyStale(43.589743589743584, 43.589743589743584)).toBe(false);
    expect(isAccuracyStale(43.59, 43.589743589743584)).toBe(false);
  });

  it('sem canônico calculável (null), nunca marca como desatualizado', () => {
    expect(isAccuracyStale(0, null)).toBe(false);
  });

  it('persistido nulo com canônico calculável é desatualizado', () => {
    expect(isAccuracyStale(null, 43.6)).toBe(true);
  });
});

function report(overrides: Partial<ClosingReport> = {}): ClosingReport {
  return {
    id: 'r1', companyId: 'c1', brandId: 'b1', cycleStart: null, version: 1, isCurrent: true,
    totalSku: 195, skusContados: 195, divergenciasEncontradas: 14, divergenciasRecontadas: 11,
    divergenciasReais: 110, accuracyInitial: 90, accuracyFinal: 43.6, categoryCounts: [], unclassifiedCount: 0,
    summaryText: '', sourceCountRecordIds: [], generatedAt: '2026-08-20T10:00:00.000Z', generatedBy: null,
    createdAt: '2026-08-20T10:00:00.000Z',
    ...overrides,
  };
}

describe('buildClosingResults — combinação pura de linhas concluídas + relatórios do ciclo', () => {
  const brandsData = [
    { id: 'b1', brand: 'Nillkin', total_sku: 195, done_sku: 195 },
    { id: 'b2', brand: 'Apple', total_sku: 100, done_sku: 60 }, // pendente — não deve aparecer
    { id: 'b3', brand: 'Samsung', total_sku: 50, done_sku: 50 }, // concluída, sem relatório ainda
  ];

  it('linhas ainda pendentes não aparecem como concluídas', () => {
    const rows = buildClosingResults(brandsData, []);
    expect(rows.find(r => r.brandId === 'b2')).toBeUndefined();
  });

  it('linha concluída sem relatório entra na lista com report null, sem fabricar dados', () => {
    const rows = buildClosingResults(brandsData, [report({ brandId: 'b1' })]);
    const samsung = rows.find(r => r.brandId === 'b3') as ClosingResultRow;
    expect(samsung).toBeDefined();
    expect(samsung.report).toBeNull();
  });

  it('linha concluída com relatório traz os dados do relatório correspondente', () => {
    const rows = buildClosingResults(brandsData, [report({ brandId: 'b1' })]);
    const nillkin = rows.find(r => r.brandId === 'b1') as ClosingResultRow;
    expect(nillkin.report?.accuracyFinal).toBe(43.6);
  });

  it('ordena por fechamento mais recente primeiro; sem relatório fica por último', () => {
    const older = report({ brandId: 'b1', generatedAt: '2026-08-10T10:00:00.000Z' });
    const newer = report({ brandId: 'b4', generatedAt: '2026-08-25T10:00:00.000Z' });
    const brands = [
      ...brandsData,
      { id: 'b4', brand: 'Motorola', total_sku: 30, done_sku: 30 },
    ];
    const rows = buildClosingResults(brands, [older, newer]);
    expect(rows.map(r => r.brandId)).toEqual(['b4', 'b1', 'b3']);
  });
});
