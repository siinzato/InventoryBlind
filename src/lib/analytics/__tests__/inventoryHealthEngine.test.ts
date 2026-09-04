import { describe, expect, it } from 'vitest';
import {
  computeHealthIndicators, computeHealthSummary, sortByPriority,
  computeMovementEvidence, buildMovementDrillRows, computeSegmentDiagnosis,
} from '../inventoryHealthEngine';
import { isAvailable, type HealthIndicator } from '../analyticsContracts';
import type {
  AnalyticsRawData, InventoryHealthExtraData, MovementProductRow, CatalogProductRow,
} from '../analyticsDataService';
import type { CrossCheckSummary } from '../../auditCrossCheckAlgorithm';
import type { RiskCompanySummaryRow } from '../../riskService';
import type { RcaRecord, AbcXyzCombo } from '../../domainTypes';
import type { InventoryCountRecord, RcaSettings } from '../../supabase';

const EMPTY_CROSS_CHECK: CrossCheckSummary = {
  totalChains: 0, chainsWithRecount: 0, pctRecontagens: 0,
  chainsIndependentAmongRecounted: 0, pctAuditoriasIndependentes: 0,
  chainsApproved: 0, pctAprovadas: 0, reliabilityIndex: 0,
};

const RCA_SETTINGS: RcaSettings = {
  company_id: 'c1', recurrence_threshold_count: 3, recurrence_window_days: 60,
  financial_impact_threshold: null, updated_at: '2026-01-01T00:00:00Z',
};

function raw(overrides: Partial<AnalyticsRawData> = {}): AnalyticsRawData {
  return {
    countRecords: [],
    crossCheckSummary: EMPTY_CROSS_CHECK,
    crossCheckChainCount: 0,
    crossCheckChains: [],
    rcaRecords: [],
    rcaSettings: RCA_SETTINGS,
    abcXyzMatrix: {} as Record<AbcXyzCombo, { count: number; value: number }>,
    cbcSummary: null,
    cbcLastRecalculatedAt: null,
    riskSummary: null,
    catalogTotal: 0,
    pillarFactorRows: [],
    overdueWithSufficientData: 0,
    ...overrides,
  };
}

/** Só os campos que os cálculos de acurácia/divergência realmente leem. */
function countRecord(accuracy: number, counted: number, divergent: number, createdAt = '2026-01-01T00:00:00Z'): InventoryCountRecord {
  return {
    created_at: createdAt, accuracy_final: accuracy, accuracy_initial: accuracy,
    skus_contados: counted, divergencias_reais: divergent,
  } as unknown as InventoryCountRecord;
}

function rcaRecord(sku: string, location: string | null, daysAgo = 1): RcaRecord {
  return {
    sku, location,
    occurred_at: new Date(Date.now() - daysAgo * 86400000).toISOString(),
  } as unknown as RcaRecord;
}

function riskSummary(overrides: Partial<RiskCompanySummaryRow> = {}): RiskCompanySummaryRow {
  return {
    company_id: 'c1', avg_risk: 40, total_scored: 100,
    critico_count: 0, alto_count: 0, medio_count: 0, baixo_count: 100, insufficient_count: 0,
    ...overrides,
  };
}

const byKey = (indicators: HealthIndicator[], key: string) => indicators.find(i => i.key === key)!;

/** Valor lido pelo mesmo caminho da UI: só existe quando a métrica está disponível. */
const valueOf = (indicator: HealthIndicator) => (isAvailable(indicator.metric) ? indicator.metric.value : null);

describe('computeHealthIndicators — semântica dos estados', () => {
  it('1. sem nenhuma recontagem, a qualidade da validação é "não avaliada", nunca crítica', () => {
    const indicators = computeHealthIndicators(raw({
      crossCheckSummary: { ...EMPTY_CROSS_CHECK, totalChains: 9, chainsWithRecount: 0, pctAprovadas: 89, chainsApproved: 8 },
    }));
    const validation = byKey(indicators, 'reliability');

    expect(validation.status).toBe('nao_avaliado');
    expect(validation.status).not.toBe('critico');
    expect(isAvailable(validation.metric)).toBe(false);
    expect(validation.detail).toContain('reconferi');
  });

  it('2. com amostra de recontagem, a qualidade usa o índice real do cross-check', () => {
    const indicators = computeHealthIndicators(raw({
      crossCheckSummary: {
        totalChains: 10, chainsWithRecount: 8, pctRecontagens: 80,
        chainsIndependentAmongRecounted: 6, pctAuditoriasIndependentes: 75,
        chainsApproved: 9, pctAprovadas: 90, reliabilityIndex: 78,
      },
    }));
    const validation = byKey(indicators, 'reliability');

    expect(validation.status).toBe('saudavel');
    expect(valueOf(validation)).toBe(78);
    expect(validation.detail).toContain('8 de 10');
  });

  it('3. sem Risk Score calculado, o risco fica indisponível — nunca 0 saudável', () => {
    const semRisco = byKey(computeHealthIndicators(raw()), 'risk');
    expect(semRisco.status).toBe('indisponivel');
    expect(isAvailable(semRisco.metric)).toBe(false);

    const scoredZero = byKey(computeHealthIndicators(raw({ riskSummary: riskSummary({ total_scored: 0 }) })), 'risk');
    expect(scoredZero.status).toBe('indisponivel');
    expect(isAvailable(scoredZero.metric)).toBe(false);
  });

  it('3b. com Risk Score real, o status vem da concentração de críticos já persistida', () => {
    const indicators = computeHealthIndicators(raw({
      riskSummary: riskSummary({ critico_count: 27, alto_count: 84, total_scored: 100, avg_risk: 61.4 }),
    }));
    const risk = byKey(indicators, 'risk');

    expect(risk.status).toBe('atencao');
    expect(valueOf(risk)).toBe(27);
    expect(risk.detail).toContain('84 alto');
    expect(risk.navigateTo).toBe('risk');
  });

  it('4. ABC/XYZ é exposição/priorização, nunca um julgamento de saúde', () => {
    const indicators = computeHealthIndicators(raw({
      abcXyzMatrix: { AX: { count: 124, value: 0 }, CZ: { count: 76, value: 0 } } as Record<AbcXyzCombo, { count: number; value: number }>,
    }));
    const abcXyz = byKey(indicators, 'abcxyz_risk');

    expect(abcXyz.status).toBe('informacao');
    expect(['saudavel', 'atencao', 'critico']).not.toContain(abcXyz.status);
    expect(abcXyz.domain).toBe('exposure');
    expect(abcXyz.drill).toEqual({ kind: 'abcxyz_risk', combos: ['AX'] });
  });

  it('5. sem nenhuma evidência, nada é reportado como saudável', () => {
    const indicators = computeHealthIndicators(raw());
    const summary = computeHealthSummary(indicators);

    expect(summary.saudavel).toBe(0);
    expect(summary.critico).toBe(0);
    expect(summary.atencao).toBe(0);
    expect(summary.availableCount).toBe(0);
    expect(byKey(indicators, 'accuracy').status).toBe('indisponivel');
    expect(byKey(indicators, 'divergence_rate').status).toBe('indisponivel');
  });

  it('6. localização com amostra abaixo do mínimo não fabrica concentração', () => {
    const indicators = computeHealthIndicators(raw({
      rcaRecords: [rcaRecord('SKU-1', 'Rua C'), rcaRecord('SKU-2', 'Rua C')],
    }));
    const location = byKey(indicators, 'location_health');

    expect(location.status).toBe('indisponivel');
    expect(isAvailable(location.metric)).toBe(false);
    expect(location.drill).toBeUndefined();
  });

  it('7. localização com amostra suficiente mantém a concentração real e o drill-down', () => {
    const rcaRecords = [
      rcaRecord('SKU-1', 'Rua C'), rcaRecord('SKU-2', 'Rua C'), rcaRecord('SKU-3', 'Rua C'),
      rcaRecord('SKU-4', 'Rua A'), rcaRecord('SKU-5', 'Rua A'), rcaRecord('SKU-6', 'Rua B'),
    ];
    const location = byKey(computeHealthIndicators(raw({ rcaRecords })), 'location_health');

    expect(isAvailable(location.metric)).toBe(true);
    expect(valueOf(location)).toBe(50);
    expect(location.status).toBe('critico');
    expect(location.drill).toEqual({ kind: 'location', location: 'Rua C' });
  });

  it('8. prioridade: crítico vem antes de atenção, e atenção antes de saudável', () => {
    const indicators = computeHealthIndicators(raw({
      // acurácia 54% → crítico; divergência 8% → atenção
      countRecords: [countRecord(54, 235, 19)],
      riskSummary: riskSummary({ critico_count: 0, alto_count: 0, total_scored: 50, baixo_count: 50 }),
    }));

    const ordered = sortByPriority(indicators).map(i => i.status);
    const firstAtencao = ordered.indexOf('atencao');
    const firstSaudavel = ordered.indexOf('saudavel');

    expect(ordered[0]).toBe('critico');
    expect(ordered.indexOf('critico')).toBeLessThan(firstAtencao);
    expect(firstAtencao).toBeLessThan(firstSaudavel);

    const summary = computeHealthSummary(indicators);
    expect(summary.priority?.status).toBe('critico');
    expect(summary.priority?.key).toBe('accuracy');
  });

  it('9. o resumo executivo é derivado dos indicadores, nunca de valores fixos', () => {
    const indicators = computeHealthIndicators(raw({
      countRecords: [countRecord(98, 100, 1)],
      crossCheckSummary: {
        totalChains: 4, chainsWithRecount: 4, pctRecontagens: 100,
        chainsIndependentAmongRecounted: 4, pctAuditoriasIndependentes: 100,
        chainsApproved: 4, pctAprovadas: 100, reliabilityIndex: 95,
      },
    }));
    const summary = computeHealthSummary(indicators);

    expect(summary.totalCount).toBe(indicators.length);
    expect(summary.availableCount).toBe(indicators.filter(i => isAvailable(i.metric)).length);
    expect(summary.critico + summary.atencao + summary.saudavel + summary.naoAvaliado)
      .toBeLessThanOrEqual(indicators.length);
    expect(summary.priority).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// Fase 2 — movimento, disponibilidade e concentração por marca/linha.

function movementRow(productId: string, quantityMoved: number, overrides: Partial<MovementProductRow> = {}): MovementProductRow {
  return {
    productId,
    quantityMoved,
    weeksWithData: 12,
    weeksWithoutSale: quantityMoved > 0 ? 0 : 12,
    unclassifiedReason: quantityMoved > 0 ? null : 'sem_movimento',
    period: '90d',
    classificationDate: '2026-09-01',
    ...overrides,
  };
}

function product(id: string, stockQuantity: number, overrides: Partial<CatalogProductRow> = {}): CatalogProductRow {
  return {
    id, sku: `SKU-${id}`, name: `Produto ${id}`, location: 'Rua A', stockQuantity, price: 10,
    ...overrides,
  };
}

function extra(overrides: Partial<InventoryHealthExtraData> = {}): InventoryHealthExtraData {
  return {
    movementSourceExists: true,
    movementRows: [],
    movementRowsTotal: 0,
    catalogProducts: [],
    catalogProductsTotal: 0,
    riskLevelByProduct: [],
    brandAssociations: [],
    brands: [],
    lines: [],
    ...overrides,
  };
}

describe('Fase 2 — movimento e disponibilidade', () => {
  it('1. estoque zerado com demanda real na janela → ruptura crítica', () => {
    const data = extra({
      catalogProducts: [product('p1', 0), product('p2', 5)],
      catalogProductsTotal: 2,
      movementRows: [movementRow('p1', 30), movementRow('p2', 12)],
      movementRowsTotal: 2,
    });
    const stockout = byKey(computeHealthIndicators(raw(), data), 'stockout');

    expect(stockout.status).toBe('critico');
    expect(valueOf(stockout)).toBe(1);
    expect(stockout.domain).toBe('movement');
    expect(stockout.drill).toEqual({ kind: 'movement', view: 'stockout' });
  });

  it('2. estoque zerado SEM demanda não entra em ruptura com demanda', () => {
    const data = extra({
      catalogProducts: [product('p1', 0)],
      catalogProductsTotal: 1,
      movementRows: [movementRow('p1', 0)],
      movementRowsTotal: 1,
    });
    const stockout = byKey(computeHealthIndicators(raw(), data), 'stockout');

    expect(valueOf(stockout)).toBe(0);
    expect(stockout.status).toBe('saudavel');
    expect(buildMovementDrillRows(data, 'stockout')).toHaveLength(0);
  });

  it('3./9. estoque positivo sem movimento na janela → atenção, nunca crítico', () => {
    const data = extra({
      catalogProducts: [product('p1', 40), product('p2', 3)],
      catalogProductsTotal: 2,
      movementRows: [movementRow('p1', 0), movementRow('p2', 9)],
      movementRowsTotal: 2,
    });
    const idle = byKey(computeHealthIndicators(raw(), data), 'no_movement');

    expect(idle.status).toBe('atencao');
    expect(idle.status).not.toBe('critico');
    expect(valueOf(idle)).toBe(1);
    // Estimativa de capital parado só existe porque o preço é real, e é anunciada como tal.
    expect(idle.detail).toContain('estimativa');
  });

  it('4. estoque positivo com movimento não entra em sem movimentação', () => {
    const data = extra({
      catalogProducts: [product('p1', 40)],
      catalogProductsTotal: 1,
      movementRows: [movementRow('p1', 25)],
      movementRowsTotal: 1,
    });
    const idle = byKey(computeHealthIndicators(raw(), data), 'no_movement');

    expect(valueOf(idle)).toBe(0);
    expect(idle.status).toBe('saudavel');
    expect(buildMovementDrillRows(data, 'idle')).toHaveLength(0);
  });

  it('5. sem nenhuma fonte de movimentação → indisponível, nunca 0 saudável', () => {
    const data = extra({
      movementSourceExists: false,
      catalogProducts: [product('p1', 10)],
      catalogProductsTotal: 1,
    });
    const indicators = computeHealthIndicators(raw(), data);

    expect(computeMovementEvidence(data).state).toBe('missing');
    for (const key of ['stockout', 'no_movement']) {
      const indicator = byKey(indicators, key);
      expect(indicator.status).toBe('indisponivel');
      expect(isAvailable(indicator.metric)).toBe(false);
    }
  });

  it('6. fonte existe mas nenhum produto tem movimentação mensurável → não avaliado', () => {
    const data = extra({
      movementSourceExists: true,
      catalogProducts: [product('p1', 10)],
      catalogProductsTotal: 1,
      movementRows: [movementRow('p1', 0, { unclassifiedReason: 'fonte_desconectada' })],
      movementRowsTotal: 1,
    });
    const indicators = computeHealthIndicators(raw(), data);

    expect(computeMovementEvidence(data).state).toBe('insufficient');
    expect(byKey(indicators, 'stockout').status).toBe('nao_avaliado');
    expect(byKey(indicators, 'no_movement').status).toBe('nao_avaliado');
  });

  it('7./8. os novos diagnósticos entram no resumo executivo e nas prioridades', () => {
    const data = extra({
      catalogProducts: [product('p1', 0), product('p2', 40)],
      catalogProductsTotal: 2,
      movementRows: [movementRow('p1', 30), movementRow('p2', 0)],
      movementRowsTotal: 2,
    });
    const indicators = computeHealthIndicators(raw(), data);
    const summary = computeHealthSummary(indicators);

    expect(summary.critico).toBeGreaterThanOrEqual(1);
    expect(summary.atencao).toBeGreaterThanOrEqual(1);
    expect(summary.totalCount).toBe(indicators.length);
    expect(summary.availableCount).toBe(indicators.filter(i => isAvailable(i.metric)).length);

    const ordered = sortByPriority(indicators);
    expect(ordered[0].key).toBe('stockout');
    expect(summary.priority?.key).toBe('stockout');
  });

  it('6b. sem `extra`, os diagnósticos de movimento não são criados (Fase 1 intacta)', () => {
    const indicators = computeHealthIndicators(raw());
    expect(indicators.find(i => i.key === 'stockout')).toBeUndefined();
    expect(indicators.find(i => i.domain === 'movement')).toBeUndefined();
  });

  it('drill de ruptura ordena por risco e não inventa data de última movimentação', () => {
    const data = extra({
      catalogProducts: [product('p1', 0), product('p2', 0)],
      catalogProductsTotal: 2,
      movementRows: [movementRow('p1', 5), movementRow('p2', 80)],
      movementRowsTotal: 2,
      riskLevelByProduct: [['p1', 'critico']],
    });
    const rows = buildMovementDrillRows(data, 'stockout');

    expect(rows.map(r => r.productId)).toEqual(['p1', 'p2']);
    expect(rows[0].riskLevel).toBe('critico');
    expect(rows[1].riskLevel).toBeNull();
    expect(rows.every(r => !('lastMovementAt' in r))).toBe(true);
  });
});

describe('Fase 2 — concentração por marca e linha', () => {
  const catalog = [product('p1', 0), product('p2', 30), product('p3', 10), product('p4', 10)];

  it('10. agrega somente produtos realmente associados', () => {
    const data = extra({
      catalogProducts: catalog,
      catalogProductsTotal: 4,
      movementRows: [movementRow('p1', 20), movementRow('p2', 0), movementRow('p3', 4), movementRow('p4', 4)],
      movementRowsTotal: 4,
      brands: [{ id: 'b1', name: 'Marca A' }, { id: 'b2', name: 'Marca B' }],
      lines: [{ id: 'l1', name: 'Linha 1', brandId: 'b1' }],
      brandAssociations: [
        { productId: 'p1', brandId: 'b1', lineId: 'l1' },
        { productId: 'p2', brandId: 'b1', lineId: null },
        { productId: 'p3', brandId: null, lineId: null },
      ],
    });
    const result = computeSegmentDiagnosis(raw(), data);

    const marcaA = result.brands.find(b => b.name === 'Marca A')!;
    expect(marcaA.products).toBe(2);
    expect(result.brands.find(b => b.name === 'Marca B')).toBeUndefined();
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].products).toBe(1);
    expect(result.lines[0].parentName).toBe('Marca A');
  });

  it('11. principal sinal é um sinal existente, nunca um score composto', () => {
    const data = extra({
      catalogProducts: catalog,
      catalogProductsTotal: 4,
      movementRows: [movementRow('p1', 20), movementRow('p2', 0), movementRow('p3', 4), movementRow('p4', 4)],
      movementRowsTotal: 4,
      brands: [{ id: 'b1', name: 'Marca A' }],
      brandAssociations: [
        { productId: 'p1', brandId: 'b1', lineId: null },
        { productId: 'p2', brandId: 'b1', lineId: null },
      ],
    });
    const marcaA = computeSegmentDiagnosis(raw(), data).brands[0];

    // p1 está zerado com demanda → o sinal mais grave é ruptura, com a contagem crua.
    expect(marcaA.mainSignal).toEqual({ key: 'stockout', label: 'rupturas com demanda', count: 1 });
    expect(marcaA.stockoutWithDemand).toBe(1);
    expect(marcaA.noMovement).toBe(1);
    // Nada de nota agregada: o objeto não tem score algum.
    expect(Object.keys(marcaA)).not.toContain('score');
    expect(Object.keys(marcaA)).not.toContain('healthScore');
    // Sinais não avaliáveis ficam null, não zero.
    expect(marcaA.riskCritical).toBeNull();
    expect(marcaA.divergentProducts).toBeNull();
  });

  it('12. associação parcial fica explícita na cobertura', () => {
    const data = extra({
      catalogProducts: catalog,
      catalogProductsTotal: 4,
      brands: [{ id: 'b1', name: 'Marca A' }],
      brandAssociations: [
        { productId: 'p1', brandId: 'b1', lineId: null },
        { productId: 'p2', brandId: 'b1', lineId: null },
        { productId: 'p3', brandId: null, lineId: null },
      ],
    });
    const result = computeSegmentDiagnosis(raw(), data);

    expect(result.associatedProducts).toBe(2);
    expect(result.totalCatalog).toBe(4);
    expect(result.coveragePct).toBe(50);
  });

  it('13. excesso de estoque permanece indisponível — não existe política mín/máx real', () => {
    const excess = byKey(computeHealthIndicators(raw(), extra()), 'excess_stock');

    expect(excess.status).toBe('indisponivel');
    expect(excess.domain).toBe('pending');
    expect(isAvailable(excess.metric)).toBe(false);
    expect(excess.detail).toContain('mínimo/máximo');
  });
});
