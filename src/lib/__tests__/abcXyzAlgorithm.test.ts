import { describe, it, expect } from 'vitest';
import { classifyXYZ, classifyABCBatch, combineAbcXyz, MIN_COMPLETE_WEEKS, ABC_THRESHOLDS } from '../abcXyzAlgorithm';
import { PERIOD_DAYS } from '../abcXyzService';

const weeks8 = (values: number[]) => {
  const arr = new Array(MIN_COMPLETE_WEEKS).fill(0);
  values.forEach((v, i) => { arr[i] = v; });
  return arr;
};

describe('classifyABCBatch — quantidade × custo', () => {
  it('gera o valor movimentado correto (quantidade × custo unitário)', () => {
    const result = classifyABCBatch([
      { productId: 'p1', quantityMoved: 100, unitCost: 10, sourceConnected: true },
    ]);
    expect(result.get('p1')!.valueMoved).toBe(1000);
    expect(result.get('p1')!.abcClass).toBe('A');
  });

  it('custo cadastrado sem movimento não gera valor movimentado', () => {
    const result = classifyABCBatch([
      { productId: 'p1', quantityMoved: 0, unitCost: 25, sourceConnected: true },
    ]);
    const r = result.get('p1')!;
    expect(r.valueMoved).toBe(0);
    expect(r.abcClass).toBeNull();
    expect(r.unclassifiedReason).toBe('sem_movimento');
  });

  it('movimento sem custo válido fica sem classificação ABC (nunca vira C)', () => {
    const result = classifyABCBatch([
      { productId: 'p1', quantityMoved: 50, unitCost: null, sourceConnected: true },
    ]);
    const r = result.get('p1')!;
    expect(r.abcClass).toBeNull();
    expect(r.unclassifiedReason).toBe('sem_custo');
  });

  it('fonte desconectada não classifica nenhum produto', () => {
    const result = classifyABCBatch([
      { productId: 'p1', quantityMoved: 50, unitCost: 10, sourceConnected: false },
    ]);
    expect(result.get('p1')!.abcClass).toBeNull();
    expect(result.get('p1')!.unclassifiedReason).toBe('fonte_desconectada');
  });

  it('respeita a participação acumulada (Pareto 80/95) e nunca deixa o topo sem classe', () => {
    const rows = [
      { productId: 'top', quantityMoved: 1, unitCost: 8500, sourceConnected: true }, // 85% sozinho
      { productId: 'mid', quantityMoved: 1, unitCost: 1000, sourceConnected: true },
      { productId: 'low', quantityMoved: 1, unitCost: 500, sourceConnected: true },
    ];
    const result = classifyABCBatch(rows);
    // O item de maior valor (85% do total, sozinho > 80%) continua sendo A.
    expect(result.get('top')!.abcClass).toBe('A');
    expect(result.get('top')!.cumulativePct).toBeCloseTo(0.85, 2);
  });

  it('os valores agregados da classificação somam exatamente o total de entrada', () => {
    const rows = [
      { productId: 'p1', quantityMoved: 10, unitCost: 5, sourceConnected: true },
      { productId: 'p2', quantityMoved: 20, unitCost: 3, sourceConnected: true },
      { productId: 'p3', quantityMoved: 0, unitCost: null, sourceConnected: true },
    ];
    const result = classifyABCBatch(rows);
    const totalClassified = [...result.values()].reduce((sum, r) => sum + (r.valueMoved ?? 0), 0);
    expect(totalClassified).toBe(10 * 5 + 20 * 3 + 0);
  });
});

describe('classifyXYZ — média, desvio padrão e CV semanal', () => {
  it('calcula CV = desvio padrão / média corretamente', () => {
    const result = classifyXYZ({ weeklyQuantities: weeks8([10, 10, 10, 10, 10, 10, 10, 10]), sourceConnected: true });
    expect(result.meanWeekly).toBe(10);
    expect(result.stdDevWeekly).toBe(0);
    expect(result.coefficientOfVariation).toBe(0);
    expect(result.xyzClass).toBe('X');
  });

  it('produto sem demanda não vira Z automaticamente — fica sem classificação', () => {
    const result = classifyXYZ({ weeklyQuantities: new Array(MIN_COMPLETE_WEEKS).fill(0), sourceConnected: true });
    expect(result.xyzClass).toBeNull();
    expect(result.unclassifiedReason).toBe('sem_movimento');
  });

  it('sem 8 semanas completas gera dados insuficientes, não Z', () => {
    const result = classifyXYZ({ weeklyQuantities: [5, 5, 5], sourceConnected: true });
    expect(result.xyzClass).toBeNull();
    expect(result.unclassifiedReason).toBe('historico_insuficiente');
  });

  it('fonte desconectada nunca classifica como Z', () => {
    const result = classifyXYZ({ weeklyQuantities: [], sourceConnected: false });
    expect(result.xyzClass).toBeNull();
    expect(result.unclassifiedReason).toBe('fonte_desconectada');
  });

  it('média zero não causa divisão por zero (sem NaN/Infinity)', () => {
    const result = classifyXYZ({ weeklyQuantities: new Array(MIN_COMPLETE_WEEKS).fill(0), sourceConnected: true });
    expect(Number.isNaN(result.coefficientOfVariation)).toBe(false);
    expect(result.coefficientOfVariation).toBeNull();
  });

  it('classifica X/Y/Z pelos limiares configuráveis', () => {
    const stable = classifyXYZ({ weeklyQuantities: weeks8([10, 11, 9, 10, 10, 9, 11, 10]), sourceConnected: true });
    const erratic = classifyXYZ({ weeklyQuantities: weeks8([0, 40, 0, 0, 35, 0, 0, 30]), sourceConnected: true });
    expect(stable.xyzClass).toBe('X');
    expect(erratic.xyzClass).toBe('Z');
  });
});

describe('combineAbcXyz — combinação só com os dois válidos', () => {
  it('produz uma combinação válida quando ambas as classes existem', () => {
    expect(combineAbcXyz('A', 'X')).toBe('AX');
    expect(combineAbcXyz('C', 'Z')).toBe('CZ');
  });
});

describe('PERIOD_DAYS — períodos suportados', () => {
  it('mapeia 90 dias, 6 meses e 12 meses', () => {
    expect(PERIOD_DAYS['90d']).toBe(90);
    expect(PERIOD_DAYS['6m']).toBeGreaterThan(150);
    expect(PERIOD_DAYS['12m']).toBe(365);
  });
});

describe('ABC_THRESHOLDS — constantes de corte', () => {
  it('mantém os limiares padrão de 80% e 95%', () => {
    expect(ABC_THRESHOLDS.a).toBe(0.8);
    expect(ABC_THRESHOLDS.b).toBe(0.95);
  });
});
