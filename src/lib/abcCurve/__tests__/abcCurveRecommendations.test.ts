import { describe, expect, it } from 'vitest';
import { evaluateRecommendation } from '../abcCurveRecommendations';
import { DEFAULT_ABC_POLICY } from '../abcCurvePolicy';
import type { SkuSnapshot } from '../abcCurveEngine';

const base = (overrides: Partial<SkuSnapshot>): SkuSnapshot => ({
  sku: 'SKU1', productName: 'Produto', quantity: 10, revenue: 100, freight: 0,
  avgPrice: 10, listPrice: 10, promoPrice: null, cost: 5, cogs: 50, grossProfit: 50, grossMargin: 0.5,
  realizedMarkup: 2, priceRealization: 1, turnoverClass: null, revenueClass: null, profitClass: null,
  costState: 'NORMAL', stockAvailable: null, stockReserved: null, stockInTransit: null, leadTimeDays: null,
  safetyStock: null, dailyDemand: null, coverageDays: null, reorderPoint: null, suggestedPurchase: null,
  ...overrides,
});

describe('evaluateRecommendation', () => {
  it('PREJUIZO tem prioridade sobre qualquer outra regra', () => {
    const rec = evaluateRecommendation(base({ costState: 'PREJUIZO', grossProfit: -10, profitClass: null }), DEFAULT_ABC_POLICY);
    expect(rec?.code).toBe('PREJUIZO');
    expect(rec?.priority).toBe(1);
  });

  it('custo ausente gera CORRIGIR_CUSTO', () => {
    const rec = evaluateRecommendation(base({ costState: 'SEM_CUSTO', cost: null, cogs: null, grossProfit: null, grossMargin: null }), DEFAULT_ABC_POLICY);
    expect(rec?.code).toBe('CORRIGIR_CUSTO');
  });

  it('lucro classe A com ruptura de estoque gera COMPRA_URGENTE', () => {
    const rec = evaluateRecommendation(base({ profitClass: 'A', stockAvailable: 0, coverageDays: 0 }), DEFAULT_ABC_POLICY);
    expect(rec?.code).toBe('COMPRA_URGENTE');
  });

  it('lucro classe A com cobertura saudável gera PROTEGER_DISPONIBILIDADE', () => {
    const rec = evaluateRecommendation(base({ profitClass: 'A', stockAvailable: 500, coverageDays: 60 }), DEFAULT_ABC_POLICY);
    expect(rec?.code).toBe('PROTEGER_DISPONIBILIDADE');
  });

  it('sem venda, sem custo e com estoque disponível gera ESTOQUE_PARADO (não CORRIGIR_CUSTO)', () => {
    // CORRIGIR_CUSTO exige atividade comercial no período: sem venda, o custo ausente não
    // impede diagnóstico nenhum e o que importa nesse SKU é o estoque parado.
    const rec = evaluateRecommendation(base({ quantity: 0, revenue: 0, stockAvailable: 20, costState: 'SEM_CUSTO', cost: null, cogs: null, grossProfit: null, grossMargin: null }), DEFAULT_ABC_POLICY);
    expect(rec?.code).toBe('ESTOQUE_PARADO');
  });

  it('venda no período sem custo gera CORRIGIR_CUSTO mesmo com estoque disponível', () => {
    const rec = evaluateRecommendation(base({ quantity: 10, revenue: 100, stockAvailable: 20, costState: 'SEM_CUSTO', cost: null, cogs: null, grossProfit: null, grossMargin: null }), DEFAULT_ABC_POLICY);
    expect(rec?.code).toBe('CORRIGIR_CUSTO');
  });

  it('sem venda e sem estoque não recebe recomendação artificial', () => {
    const rec = evaluateRecommendation(base({ quantity: 0, revenue: 0, stockAvailable: 0, costState: 'SEM_CUSTO', cost: null, cogs: null, grossProfit: null, grossMargin: null }), DEFAULT_ABC_POLICY);
    expect(rec).toBeNull();
  });

  it('sem venda, com custo normal e estoque disponível, gera ESTOQUE_PARADO', () => {
    const rec = evaluateRecommendation(base({ quantity: 0, revenue: 0, stockAvailable: 20, cost: 5, costState: 'NORMAL', grossProfit: 0 }), DEFAULT_ABC_POLICY);
    expect(rec?.code).toBe('ESTOQUE_PARADO');
  });

  it('nenhuma regra aplicável retorna null (sem recomendação forçada)', () => {
    const rec = evaluateRecommendation(base({ profitClass: 'B', turnoverClass: 'B', revenueClass: 'B', grossMargin: 0.25 }), DEFAULT_ABC_POLICY);
    expect(rec).toBeNull();
  });
});
