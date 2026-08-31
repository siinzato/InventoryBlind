import { describe, it, expect } from 'vitest';
import { computeRiskScore, RiskInput } from '../riskAlgorithm';

const base: RiskInput = {
  totalCounts: 4,
  divergentCounts: 1,
  repeatOffenseCount: 0,
  daysSinceLastCount: 10,
  stockoutCount: 0,
  adjustmentCount: 0,
  abcClass: 'B',
  unitPrice: 50,
  currentStockQuantity: 100,
  quantityMovedPerMonth: 30,
  criticalityLevel: 'normal',
};

describe('computeRiskScore — dados insuficientes', () => {
  it('nunca contado (totalCounts = 0) não gera score fabricado', () => {
    const result = computeRiskScore({ ...base, totalCounts: 0, divergentCounts: 0, daysSinceLastCount: null });
    expect(result.hasSufficientData).toBe(false);
    expect(result.riskScore).toBeNull();
    expect(result.riskLevel).toBeNull();
    expect(result.probability).toBeNull();
    // Impacto continua calculável — produto sempre tem preço/estoque.
    expect(result.impact).toBeGreaterThan(0);
  });

  it('não repete a mesma nota para SKUs diferentes sem dados (regressão do "22-24 fixo")', () => {
    const a = computeRiskScore({ ...base, totalCounts: 0, daysSinceLastCount: null, unitPrice: 10, currentStockQuantity: 5 });
    const b = computeRiskScore({ ...base, totalCounts: 0, daysSinceLastCount: null, unitPrice: 900, currentStockQuantity: 500, abcClass: 'A' });
    expect(a.riskScore).toBeNull();
    expect(b.riskScore).toBeNull();
    // Ambos "sem dados" — nenhum score numérico é inventado, então não há
    // convergência para um número fixo como no bug original.
    expect(a.hasSufficientData).toBe(false);
    expect(b.hasSufficientData).toBe(false);
  });
});

describe('computeRiskScore — consistência matemática', () => {
  it('riskScore = round(probabilidade × impacto / 100)', () => {
    const result = computeRiskScore(base);
    expect(result.hasSufficientData).toBe(true);
    expect(result.probability).not.toBeNull();
    expect(result.riskScore).toBe(Math.round((result.probability! * result.impact) / 100));
  });
});

describe('computeRiskScore — faixas', () => {
  it('classifica crítico (80-100)', () => {
    const result = computeRiskScore({
      ...base, totalCounts: 4, divergentCounts: 4, repeatOffenseCount: 5, daysSinceLastCount: 200, stockoutCount: 4, adjustmentCount: 7,
      abcClass: 'A', unitPrice: 1000, currentStockQuantity: 100, quantityMovedPerMonth: 600, criticalityLevel: 'maxima',
    });
    expect(result.riskScore).toBeGreaterThanOrEqual(80);
    expect(result.riskLevel).toBe('critico');
  });

  it('classifica baixo (0-39)', () => {
    const result = computeRiskScore({
      ...base, divergentCounts: 0, repeatOffenseCount: 0, daysSinceLastCount: 1, stockoutCount: 0, adjustmentCount: 0,
      abcClass: 'C', unitPrice: 1, currentStockQuantity: 1, quantityMovedPerMonth: 0, criticalityLevel: 'baixa',
    });
    expect(result.riskScore).toBeLessThan(40);
    expect(result.riskLevel).toBe('baixo');
  });
});

describe('computeRiskScore — probabilidade e impacto são independentes', () => {
  it('mais divergência/reincidência aumenta a probabilidade sem alterar o impacto', () => {
    const low = computeRiskScore({ ...base, divergentCounts: 0, repeatOffenseCount: 0 });
    const high = computeRiskScore({ ...base, divergentCounts: 4, repeatOffenseCount: 3 });
    expect(high.probability!).toBeGreaterThan(low.probability!);
    expect(high.impact).toBe(low.impact);
    expect(high.riskScore!).toBeGreaterThan(low.riskScore!);
  });

  it('maior valor em estoque aumenta o impacto sem alterar a probabilidade', () => {
    const low = computeRiskScore({ ...base, unitPrice: 5, currentStockQuantity: 5 });
    const high = computeRiskScore({ ...base, unitPrice: 900, currentStockQuantity: 900 });
    expect(high.impact).toBeGreaterThan(low.impact);
    expect(high.probability).toBe(low.probability);
  });

  it('classificação ABC ausente não trava o cálculo — redistribui peso e registra o que falta', () => {
    const withAbc = computeRiskScore({ ...base, abcClass: 'A' });
    const withoutAbc = computeRiskScore({ ...base, abcClass: null });
    expect(withoutAbc.hasSufficientData).toBe(true);
    expect(withoutAbc.missingFactors).toContain('Classificação ABC');
    expect(withoutAbc.impact).toBeGreaterThan(0);
    // Sem a classe A (que pesa a favor do impacto), o impacto sem ABC não deve
    // superar o calculado com ABC A presente para o mesmo produto.
    expect(withoutAbc.impact).toBeLessThanOrEqual(withAbc.impact);
  });
});

describe('computeRiskScore — proximidade física não é um fator', () => {
  it('o resultado não recebe nem depende de localização/corredor', () => {
    const result = computeRiskScore(base);
    // RiskInput não tem nenhum campo de localização — garantia estrutural de que
    // a proximidade física não pode influenciar o risco intrínseco.
    expect('location' in result).toBe(false);
    expect('corridor' in result).toBe(false);
  });
});
