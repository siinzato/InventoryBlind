import { describe, expect, it } from 'vitest';
import { computeConfidenceScore, computePriority, buildWhyToCount, type ConfidenceInput } from '../cbcAlgorithm';

function input(overrides: Partial<ConfidenceInput> = {}): ConfidenceInput {
  return {
    abcClass: null,
    recentCounts: [],
    repeatOffenseCount: 0,
    currentStockQuantity: 10,
    picksPerMonth: 0,
    hasBrandOrLine: true,
    hasLocation: true,
    eanValid: true,
    ...overrides,
  };
}

describe('computeConfidenceScore — dados insuficientes (causa raiz do 76 repetido)', () => {
  it('SKU nunca contado não recebe confiança fabricada — estado explícito, não um número', () => {
    const result = computeConfidenceScore(input({ recentCounts: [], currentStockQuantity: 0 }));
    expect(result.hasSufficientData).toBe(false);
    expect(result.confidenceScore).toBeNull();
    expect(result.riskLevel).toBeNull();
    expect(result.missingFactors.length).toBeGreaterThan(0);
  });

  it('dois SKUs sem nenhum histórico não terminam ambos em 76 — ambos ficam "insuficiente", não um número', () => {
    const a = computeConfidenceScore(input({ recentCounts: [], currentStockQuantity: 0, picksPerMonth: 0 }));
    const b = computeConfidenceScore(input({ recentCounts: [], currentStockQuantity: 0, picksPerMonth: 50 }));
    expect(a.confidenceScore).toBeNull();
    expect(b.confidenceScore).toBeNull();
    // nenhum dos dois é 76 nem qualquer outro valor fixo — o estado é "sem dados", não um score
    expect(a.hasSufficientData).toBe(false);
    expect(b.hasSufficientData).toBe(false);
  });
});

describe('computeConfidenceScore — históricos diferentes geram scores diferentes', () => {
  it('SKU-local com contagens sempre corretas vs. SKU-local com divergências grandes não empatam', () => {
    const good = computeConfidenceScore(input({
      recentCounts: [
        { daysAgo: 2, systemQty: 100, physicalQty: 100 },
        { daysAgo: 20, systemQty: 90, physicalQty: 90 },
      ],
    }));
    const bad = computeConfidenceScore(input({
      recentCounts: [
        { daysAgo: 2, systemQty: 100, physicalQty: 40 },
        { daysAgo: 20, systemQty: 90, physicalQty: 30 },
      ],
      repeatOffenseCount: 2,
    }));
    expect(good.hasSufficientData).toBe(true);
    expect(bad.hasSufficientData).toBe(true);
    expect(good.confidenceScore).not.toBe(bad.confidenceScore);
    expect(good.confidenceScore!).toBeGreaterThan(bad.confidenceScore!);
  });

  it('mesmo SKU em duas localizações (dois inputs independentes) pode ter scores diferentes', () => {
    // "SKU-local" aqui é modelado como um input independente por localização (histórico
    // de contagem filtrado pela localização atual do produto em cbcService.ts) — o motor
    // puro não mistura nada: cada chamada é isolada, então dois locais = dois resultados.
    const locationA = computeConfidenceScore(input({
      recentCounts: [{ daysAgo: 1, systemQty: 50, physicalQty: 50 }],
    }));
    const locationB = computeConfidenceScore(input({
      recentCounts: [{ daysAgo: 1, systemQty: 50, physicalQty: 10 }],
    }));
    expect(locationA.confidenceScore).not.toBe(locationB.confidenceScore);
  });

  it('divergência reduz o histórico de acuracidade', () => {
    const withDivergence = computeConfidenceScore(input({
      recentCounts: [{ daysAgo: 1, systemQty: 100, physicalQty: 50 }],
    }));
    const withoutDivergence = computeConfidenceScore(input({
      recentCounts: [{ daysAgo: 1, systemQty: 100, physicalQty: 100 }],
    }));
    expect(withDivergence.factors.accuracyHistory.score).toBeLessThan(withoutDivergence.factors.accuracyHistory.score);
  });

  it('passagem do tempo reduz a recência', () => {
    const recent = computeConfidenceScore(input({
      abcClass: 'B',
      recentCounts: [{ daysAgo: 2, systemQty: 10, physicalQty: 10 }],
    }));
    const stale = computeConfidenceScore(input({
      abcClass: 'B',
      recentCounts: [{ daysAgo: 29, systemQty: 10, physicalQty: 10 }],
    }));
    expect(recent.factors.recency.score).toBeGreaterThan(stale.factors.recency.score);
  });
});

describe('computePriority — conceito separado de confiança', () => {
  it('prioridade provisória ("Primeira avaliação") quando não há confiança', () => {
    const confidence = computeConfidenceScore(input({ recentCounts: [] }));
    const priority = computePriority(input({ recentCounts: [] }), confidence);
    expect(priority.reason).toBe('primeira_avaliacao');
    expect(priority.priorityScore).toBeGreaterThanOrEqual(0);
    expect(priority.priorityScore).toBeLessThanOrEqual(100);
  });

  it('prioridade calculada não é igual à confiança (indicadores independentes)', () => {
    const inp = input({
      abcClass: 'A',
      recentCounts: [{ daysAgo: 40, systemQty: 100, physicalQty: 100 }],
    });
    const confidence = computeConfidenceScore(inp);
    const priority = computePriority(inp, confidence);
    expect(priority.reason).toBe('calculada');
    expect(priority.priorityScore).not.toBe(confidence.confidenceScore);
  });
});

describe('buildWhyToCount — motivos reais, nunca genéricos e iguais para todos', () => {
  it('produz motivos diferentes para situações diferentes', () => {
    const overdue = computeConfidenceScore(input({ abcClass: 'A', recentCounts: [{ daysAgo: 40, systemQty: 10, physicalQty: 10 }] }));
    const reasonOverdue = buildWhyToCount(input({ abcClass: 'A', recentCounts: [{ daysAgo: 40, systemQty: 10, physicalQty: 10 }] }), overdue);

    const stable = computeConfidenceScore(input({ abcClass: 'C', recentCounts: [{ daysAgo: 1, systemQty: 10, physicalQty: 10 }] }));
    const reasonStable = buildWhyToCount(input({ abcClass: 'C', recentCounts: [{ daysAgo: 1, systemQty: 10, physicalQty: 10 }] }), stable);

    expect(reasonOverdue).not.toBe(reasonStable);
    expect(reasonOverdue).toContain('Vencida há');
    expect(reasonStable).toBe('Saldo consistente');
  });
});
