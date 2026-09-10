import { describe, expect, it } from 'vitest';
import { computeBlindScore } from '../blindScoreEngine';
import type { AnalyticsRawData } from '../analyticsDataService';
import type { CBCCompanySummaryRow } from '../../cbcService';
import type { CountChain, CrossCheckSummary } from '../../auditCrossCheckAlgorithm';
import type { RcaRecord, AbcXyzCombo } from '../../domainTypes';
import type { RcaSettings } from '../../supabase';

const EMPTY_CROSS_CHECK: CrossCheckSummary = {
  totalChains: 0, chainsWithRecount: 0, pctRecontagens: 0,
  chainsIndependentAmongRecounted: 0, pctAuditoriasIndependentes: 0,
  chainsApproved: 0, pctAprovadas: 0, reliabilityIndex: 0,
};

const RCA_SETTINGS: RcaSettings = {
  company_id: 'c1', recurrence_threshold_count: 3, recurrence_window_days: 60,
  financial_impact_threshold: null, updated_at: '2026-01-01T00:00:00Z',
};

function cbcSummary(overrides: Partial<CBCCompanySummaryRow> = {}): CBCCompanySummaryRow {
  return {
    company_id: 'c1', avg_confidence: 90, total_scored: 100, distinct_locations: 1,
    excelente_count: 100, bom_count: 0, medio_count: 0, critico_count: 0,
    insufficient_count: 0, overdue_count: 0, due_this_week_count: 0, scheduled_this_week_count: 0,
    ...overrides,
  };
}

const MODERN_FACTORS = {
  accuracyHistory: { score: 33, max: 40 }, recency: { score: 18, max: 25 },
  stability: { score: 14, max: 20 }, integrity: { score: 14, max: 15 },
};

/** Forma real das linhas pré-rework encontradas no workspace (8 fatores, sem `max`). */
const LEGACY_FACTORS = {
  divergenceHistory: { score: 55, weight: 25 }, daysSinceLastCount: { score: 30, weight: 15 },
  recurrence: { score: 100, weight: 15 }, timeWithoutDivergence: { score: 100, weight: 15 },
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

describe('computeBlindScore', () => {
  it('1. nenhum produto avaliado → score indisponível, nunca um número fabricado', () => {
    const result = computeBlindScore(raw({ catalogTotal: 50 }));
    expect(result.score).toBeNull();
    expect(result.status).toBe('indisponivel');
    expect(result.summary).toContain('pelo menos um produto');
  });

  it('2. o score é o avg_confidence real do CBC, arredondado — nenhuma fórmula própria', () => {
    const result = computeBlindScore(raw({
      catalogTotal: 100,
      cbcSummary: cbcSummary({ avg_confidence: 86.6, total_scored: 100, insufficient_count: 0 }),
    }));
    expect(result.score).toBe(87);
  });

  it('3. cobertura 100% → evidência alta, leitura definitiva', () => {
    const result = computeBlindScore(raw({
      catalogTotal: 100,
      cbcSummary: cbcSummary({ avg_confidence: 92, total_scored: 100, insufficient_count: 0 }),
    }));
    expect(result.coverage.pct).toBe(100);
    expect(result.coverage.evidence).toBe('alta');
    expect(result.status).toBe('excelente');
  });

  it('4. cobertura parcial (60%) → evidência moderada, ainda leitura definitiva', () => {
    const result = computeBlindScore(raw({
      catalogTotal: 100,
      cbcSummary: cbcSummary({ avg_confidence: 80, total_scored: 60, insufficient_count: 0 }),
    }));
    expect(result.coverage.pct).toBe(60);
    expect(result.coverage.evidence).toBe('moderada');
    expect(result.status).toBe('bom');
  });

  it('5. cobertura baixa (<40%) → leitura provisória, mesmo com score alto', () => {
    const result = computeBlindScore(raw({
      catalogTotal: 100,
      cbcSummary: cbcSummary({ avg_confidence: 97, total_scored: 18, insufficient_count: 0 }),
    }));
    expect(result.coverage.pct).toBe(18);
    expect(result.coverage.evidence).toBe('baixa');
    expect(result.status).toBe('provisorio');
    expect(result.score).toBe(97);
    expect(result.summary).toContain('cobertura ainda é insuficiente');
    // O percentual e o volume que faltam moram no bloco de cobertura, não na frase do score.
    expect(result.coverage.pct).toBe(18);
    expect(result.coverage.gap).toBe(82);
  });

  it('6. score alto com cobertura baixa nunca vira "excelente" — não é diagnóstico definitivo', () => {
    const result = computeBlindScore(raw({
      catalogTotal: 1000,
      cbcSummary: cbcSummary({ avg_confidence: 99, total_scored: 10, insufficient_count: 0 }),
    }));
    expect(result.status).not.toBe('excelente');
    expect(result.status).toBe('provisorio');
  });

  it('7. ausência de RCA não penaliza o score — só deixa de aparecer como fator redutor', () => {
    const base = raw({
      catalogTotal: 100,
      cbcSummary: cbcSummary({ avg_confidence: 85, total_scored: 100, insufficient_count: 0 }),
    });
    const withoutRca = computeBlindScore(base);
    const withRca = computeBlindScore({ ...base, rcaRecords: [rcaRecord()] });
    expect(withoutRca.score).toBe(withRca.score);
    expect(withoutRca.reducingFactors.some(f => f.key === 'rca_recurrence')).toBe(false);
  });

  it('8. ABC/XYZ não altera a nota — só aparece como exposição operacional separada', () => {
    const base = raw({
      catalogTotal: 100,
      cbcSummary: cbcSummary({ avg_confidence: 85, total_scored: 100, insufficient_count: 0 }),
    });
    const withoutAbcXyz = computeBlindScore(base);
    const withAbcXyz = computeBlindScore({
      ...base,
      abcXyzMatrix: { AX: { count: 50, value: 1000 } } as unknown as Record<AbcXyzCombo, { count: number; value: number }>,
    });
    expect(withoutAbcXyz.score).toBe(withAbcXyz.score);
    expect(withoutAbcXyz.reducingFactors).toEqual(withAbcXyz.reducingFactors);
  });

  it('9. reincidência respeita recurrence_window_days — registro fora da janela não vira fator redutor', () => {
    const NOW_ISO = '2026-09-02T12:00:00.000Z';
    const oldRecord = rcaRecord({ sku: 'SKU-1', occurred_at: '2025-01-01T00:00:00.000Z' });
    const result = computeBlindScore(raw({
      catalogTotal: 100,
      cbcSummary: cbcSummary({ avg_confidence: 85, total_scored: 100, insufficient_count: 0 }),
      rcaRecords: [oldRecord, { ...oldRecord, id: 'r2' }, { ...oldRecord, id: 'r3' }],
      rcaSettings: { ...RCA_SETTINGS, recurrence_threshold_count: 3, recurrence_window_days: 30 },
    }));
    // 3 ocorrências bateriam o limiar de 3 se a janela não fosse aplicada — mas todas são de
    // 2025, muito fora dos 30 dias configurados a partir de "agora" (mock via Date atual).
    void NOW_ISO;
    expect(result.reducingFactors.some(f => f.key === 'rca_recurrence')).toBe(false);
  });

  it('10. dados ausentes nunca viram zero fictício — pillars/validação/exposição ficam explicitamente "não avaliado"', () => {
    const result = computeBlindScore(raw({ catalogTotal: 0 }));
    expect(result.pillars).toEqual([]);
    expect(result.validation.quality).toBe('nao_avaliada');
    expect(result.abcXyzExposure).toBeNull();
  });

  it('V2.1 — sem amostra de reconferência a validação é "não avaliada", nunca "baixa"', () => {
    // Caso real: 8 contagens registradas, todas aprovadas, nenhuma recontagem. O
    // reliabilityIndex cai por ausência de amostra, não por processo ruim.
    const result = computeBlindScore(raw({
      catalogTotal: 100,
      cbcSummary: cbcSummary({ avg_confidence: 85, total_scored: 100, insufficient_count: 0 }),
      crossCheckChainCount: 8,
      crossCheckSummary: {
        ...EMPTY_CROSS_CHECK, totalChains: 8, chainsWithRecount: 0,
        chainsApproved: 8, pctAprovadas: 100, reliabilityIndex: 20,
      },
    }));
    expect(result.validation.quality).toBe('nao_avaliada');
    expect(result.validation.sampleChains).toBe(0);
  });

  it('V2.1 — com amostra real de reconferência a validação volta a ser classificada', () => {
    const result = computeBlindScore(raw({
      catalogTotal: 100,
      cbcSummary: cbcSummary({ avg_confidence: 85, total_scored: 100, insufficient_count: 0 }),
      crossCheckChainCount: 8,
      crossCheckSummary: {
        ...EMPTY_CROSS_CHECK, totalChains: 8, chainsWithRecount: 8, pctRecontagens: 100,
        chainsIndependentAmongRecounted: 8, pctAuditoriasIndependentes: 100,
        chainsApproved: 8, pctAprovadas: 100, reliabilityIndex: 100,
      },
    }));
    expect(result.validation.quality).toBe('alta');
  });

  it('V2.1 — produtos avaliados com factors atuais geram pilares agregados com base explícita', () => {
    const result = computeBlindScore(raw({
      catalogTotal: 100,
      cbcSummary: cbcSummary({ avg_confidence: 79, total_scored: 20, insufficient_count: 0 }),
      pillarFactorRows: [MODERN_FACTORS, MODERN_FACTORS],
    }));
    expect(result.pillars).toHaveLength(4);
    expect(result.pillars.map(p => p.value)).toEqual([83, 72, 70, 93]);
    expect(result.pillars.every(p => p.reading.length > 0)).toBe(true);
    expect(result.pillarsBase).toBe(2);
    expect(result.pillarsUnavailable).toBeNull();
    expect(result.staleEvaluation).toBe(false);
  });

  it('V2.1 — cobertura baixa NÃO esconde pilares que existem', () => {
    const result = computeBlindScore(raw({
      catalogTotal: 4498,
      cbcSummary: cbcSummary({ avg_confidence: 76, total_scored: 204, insufficient_count: 0 }),
      pillarFactorRows: [MODERN_FACTORS],
    }));
    expect(result.status).toBe('provisorio');
    expect(result.pillars).toHaveLength(4);
    expect(result.pillarsBase).toBe(1);
  });

  it('V2.1 — avaliados só com factors da versão anterior → "stale_algorithm", não "sem produtos"', () => {
    const result = computeBlindScore(raw({
      catalogTotal: 4498,
      cbcSummary: cbcSummary({ avg_confidence: 76, total_scored: 1000, insufficient_count: 796 }),
      pillarFactorRows: Array.from({ length: 204 }, () => LEGACY_FACTORS),
    }));
    expect(result.score).toBe(76);
    expect(result.coverage.evaluated).toBe(204);
    expect(result.coverage.gap).toBe(4294);
    expect(result.pillars).toEqual([]);
    expect(result.pillarsBase).toBe(0);
    expect(result.pillarsUnavailable).toBe('stale_algorithm');
    expect(result.staleEvaluation).toBe(true);
    expect(result.recommendations.map(r => r.key)).toContain('recalculate_confidence');
  });

  it('V2.1 — sem nenhum produto avaliado o motivo é "no_evaluated_products"', () => {
    const result = computeBlindScore(raw({ catalogTotal: 4498, cbcSummary: cbcSummary({ avg_confidence: null, total_scored: 796, insufficient_count: 796 }) }));
    expect(result.pillarsUnavailable).toBe('no_evaluated_products');
    expect(result.staleEvaluation).toBe(false);
    expect(result.score).toBeNull();
  });

  it('V2.1 — "contagens vencidas" e "sem evidência suficiente" não descrevem o mesmo conjunto', () => {
    // Caso real: os 796 vencidos SÃO os 796 sem evidência (vencem por construção), então o
    // item de vencidas não deve aparecer; só o recorte com evidência é acionável.
    const sameSet = computeBlindScore(raw({
      catalogTotal: 4498,
      cbcSummary: cbcSummary({ avg_confidence: 76, total_scored: 1000, insufficient_count: 796, overdue_count: 796 }),
      overdueWithSufficientData: 0,
    }));
    expect(sameSet.reducingFactors.map(f => f.key)).toContain('cbc_insufficient');
    expect(sameSet.reducingFactors.map(f => f.key)).not.toContain('cbc_overdue');

    const distinct = computeBlindScore(raw({
      catalogTotal: 4498,
      cbcSummary: cbcSummary({ avg_confidence: 76, total_scored: 1000, insufficient_count: 796, overdue_count: 850 }),
      overdueWithSufficientData: 54,
    }));
    expect(distinct.reducingFactors.find(f => f.key === 'cbc_overdue')?.count).toBe(54);
  });

  it('V2.1 — recomendações são determinísticas e só saem de condição real', () => {
    const noIssues = computeBlindScore(raw({
      catalogTotal: 100,
      cbcSummary: cbcSummary({ avg_confidence: 95, total_scored: 100, insufficient_count: 0 }),
      pillarFactorRows: [MODERN_FACTORS],
    }));
    expect(noIssues.recommendations).toEqual([]);

    const withGap = computeBlindScore(raw({
      catalogTotal: 4498,
      cbcSummary: cbcSummary({ avg_confidence: 76, total_scored: 204, insufficient_count: 0, critico_count: 12 }),
      pillarFactorRows: [MODERN_FACTORS],
      overdueWithSufficientData: 30,
    }));
    expect(withGap.recommendations.map(r => r.key)).toEqual(['expand_coverage', 'update_overdue', 'review_critical']);
    expect(withGap.recommendations.every(r => r.navigateTo === 'cbc')).toBe(true);
  });

  it('contagens aguardando validação usa as cadeias reais (recontagem sem aprovação)', () => {
    const chain: CountChain = {
      rootId: 'root1', brandId: 'b1', createdAt: '2026-01-01T00:00:00Z',
      contadorUserId: 'u1', contadorName: 'Op 1', hasRecount: true,
      recontadorUserId: 'u2', recontadorName: 'Op 2', isApproved: false,
      approvedBy: null, approvedAt: null, sameUserCountAndRecount: false,
      sameOperatorNameCountAndRecount: false, sameUserCountAndApproval: false, independent: true,
    };
    const result = computeBlindScore(raw({
      catalogTotal: 100,
      cbcSummary: cbcSummary({ avg_confidence: 85, total_scored: 100, insufficient_count: 0 }),
      crossCheckChains: [chain],
      crossCheckChainCount: 1,
    }));
    const item = result.reducingFactors.find(f => f.key === 'audit_pending');
    expect(item?.count).toBe(1);
    expect(item?.navigateTo).toBe('audit');
  });
});

function rcaRecord(overrides: Partial<RcaRecord> = {}): RcaRecord {
  return {
    id: 'r1', company_id: 'c1', source_module: 'import_count', source_item_id: 's1',
    product_id: null, sku: 'SKU-1', product_name: null, location: null,
    operator_user_id: null, operator_name: null, supplier_name: null, supplier_cnpj: null,
    divergence_qty: 1, process_area: null, cause_category: null, subcause_code: null,
    custom_cause_label: null, notes: null, severity: 'media', classification_status: 'classified',
    containment_needed: false, known_recurrence: false, financial_impact: null,
    manual_escalation: false, rca_case_id: null, classified_by: null, classified_by_email: null,
    occurred_at: new Date().toISOString(), created_at: new Date().toISOString(),
    ...overrides,
  };
}
