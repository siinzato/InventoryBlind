import { describe, expect, it } from 'vitest';
import {
  simulateCount, assessCapacity, buildScenarios, buildOperatorsCurve,
  buildScenarioDiagnostic, assessForecastConfidence, type SimulationInput,
} from '../auditSimulationEngine';

const baseInput: SimulationInput = {
  totalSkus: 279,
  numOperators: 2,
  avgSkusPerHourPerOperator: 316,
  costPerHourPerOperator: 12,
  hoursPerWorkday: 8,
  startDate: '2026-09-01T00:00:00.000Z',
};

describe('assessCapacity', () => {
  it('classifica adequada/atenção/sobrecarga pelas mesmas faixas usadas na tela', () => {
    expect(assessCapacity(4, 2, 8).classification).toBe('adequada'); // 25%
    expect(assessCapacity(14, 2, 8).classification).toBe('atencao'); // 87.5%
    expect(assessCapacity(20, 2, 8).classification).toBe('sobrecarga'); // 125%
  });

  it('nunca deixa a folga negativa quando em sobrecarga', () => {
    const capacity = assessCapacity(20, 2, 8);
    expect(capacity.slackPercent).toBe(0);
  });

  it('não produz NaN/Infinity quando não há operadores ou horas configuradas', () => {
    const capacity = assessCapacity(10, 0, 0);
    expect(Number.isFinite(capacity.utilizationPercent)).toBe(true);
    expect(Number.isFinite(capacity.slackPercent)).toBe(true);
  });
});

describe('buildScenarios', () => {
  it('mantém econômico <= recomendado <= acelerado em número de operadores', () => {
    const [economic, recommended, accelerated] = buildScenarios(baseInput);
    expect(economic.operators).toBeLessThanOrEqual(recommended.operators);
    expect(recommended.operators).toBeLessThanOrEqual(accelerated.operators);
  });

  it('reage à configuração — mais SKUs aumenta o tempo do cenário recomendado', () => {
    const small = buildScenarios(baseInput).find(s => s.key === 'recomendado')!;
    const big = buildScenarios({ ...baseInput, totalSkus: 2790 }).find(s => s.key === 'recomendado')!;
    expect(big.wallClockHours).toBeGreaterThan(small.wallClockHours);
  });

  it('nunca produz cenário com 0 operadores mesmo partindo de 1', () => {
    const scenarios = buildScenarios({ ...baseInput, numOperators: 1 });
    expect(scenarios.every(s => s.operators >= 1)).toBe(true);
  });

  it('nunca deixa NaN/Infinity vazar quando a produtividade é 0', () => {
    const scenarios = buildScenarios({ ...baseInput, avgSkusPerHourPerOperator: 0 });
    for (const s of scenarios) {
      expect(Number.isFinite(s.wallClockHours)).toBe(true);
      expect(Number.isFinite(s.estimatedCost)).toBe(true);
      expect(Number.isFinite(s.efficiencyPercent)).toBe(true);
    }
  });
});

describe('buildOperatorsCurve', () => {
  it('gera uma faixa crescente de operadores com tempo decrescente', () => {
    const curve = buildOperatorsCurve(baseInput);
    expect(curve.length).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i].wallClockHours).toBeLessThanOrEqual(curve[i - 1].wallClockHours);
    }
  });
});

describe('buildScenarioDiagnostic', () => {
  it('menciona o nº de operadores recomendado na mensagem', () => {
    const capacity = assessCapacity(4, 2, 8);
    expect(buildScenarioDiagnostic(capacity, 2)).toContain('2 operadores');
    expect(buildScenarioDiagnostic(capacity, 1)).toContain('1 operador');
    expect(buildScenarioDiagnostic(capacity, 1)).not.toContain('1 operadores');
  });
});

describe('assessForecastConfidence', () => {
  it('retorna null sem histórico suficiente — a tela deve omitir o card', () => {
    expect(assessForecastConfidence(null)).toBeNull();
    expect(assessForecastConfidence(0)).toBeNull();
  });

  it('sobe de Baixa a Alta conforme mais horas históricas ficam disponíveis', () => {
    expect(assessForecastConfidence(5)?.level).toBe('Baixa');
    expect(assessForecastConfidence(15)?.level).toBe('Média');
    expect(assessForecastConfidence(50)?.level).toBe('Alta');
  });
});

describe('simulateCount (regra de cálculo do enunciado)', () => {
  it('segue capacidadePorHora = produtividade*operadores e horasPessoa = tempoHoras*operadores', () => {
    const estimate = simulateCount(baseInput);
    const capacidadePorHora = baseInput.avgSkusPerHourPerOperator * baseInput.numOperators;
    const tempoHoras = baseInput.totalSkus / capacidadePorHora;
    const horasPessoa = tempoHoras * baseInput.numOperators;
    expect(estimate.wallClockHours).toBeCloseTo(tempoHoras, 6);
    expect(estimate.totalWorkHours).toBeCloseTo(horasPessoa, 6);
    expect(estimate.estimatedCost).toBeCloseTo(horasPessoa * baseInput.costPerHourPerOperator, 6);
  });
});
