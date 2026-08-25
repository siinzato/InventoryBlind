import { describe, expect, it } from 'vitest';
import { aggregateVendas, buildPricingMap, buildStockMap, buildSkuSnapshots } from '../abcCurveEngine';
import type { RawRow } from '../abcCurveParsing';

describe('aggregateVendas', () => {
  it('agrega linhas repetidas pelo mesmo SKU (soma quantidade e valor)', () => {
    const rows: RawRow[] = [
      { sku: 'SKU1', produto: 'Produto 1', quantidade: 2, valor: 20 },
      { sku: 'SKU1', produto: 'Produto 1', quantidade: 3, valor: 30 },
    ];
    const { aggregated, errors } = aggregateVendas(rows);
    expect(errors).toHaveLength(0);
    expect(aggregated).toHaveLength(1);
    expect(aggregated[0].quantity).toBe(5);
    expect(aggregated[0].revenue).toBe(50);
  });

  it('bloqueia (erro) linha sem SKU no arquivo de vendas', () => {
    const rows: RawRow[] = [
      { produto: 'Sem SKU', quantidade: 1, valor: 10 },
      { sku: 'SKU2', produto: 'Produto 2', quantidade: 1, valor: 20 },
    ];
    const { aggregated, errors } = aggregateVendas(rows);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/sku ausente/i);
    expect(aggregated).toHaveLength(1);
    expect(aggregated[0].sku).toBe('SKU2');
  });

  it('bloqueia linha sem quantidade ou faturamento', () => {
    const { aggregated, errors } = aggregateVendas([{ sku: 'SKU1', quantidade: 1 }]);
    expect(aggregated).toHaveLength(0);
    expect(errors[0].message).toMatch(/quantidade ou faturamento/i);
  });
});

describe('buildPricingMap', () => {
  it('ignora e avisa (nunca agrupa como produto vazio) linha sem SKU na lista de preços', () => {
    const { map, warnings } = buildPricingMap([
      { descricao: 'Sem SKU', preco: 10, custo: 5 },
      { sku: 'SKU1', preco: 20, custo: 10 },
    ]);
    expect(map.size).toBe(1);
    expect(map.has('')).toBe(false);
    expect(warnings.some(w => /sem sku/i.test(w))).toBe(true);
  });
});

describe('buildSkuSnapshots — custo/estado', () => {
  it('custo zero ou ausente gera estado SEM_CUSTO e margem/CMV/lucro nulos', () => {
    const { aggregated } = aggregateVendas([{ sku: 'SKU1', quantidade: 10, valor: 100 }]);
    const { map: pricing } = buildPricingMap([{ sku: 'SKU1', preco: 15, custo: 0 }]);
    const [snapshot] = buildSkuSnapshots({ vendas: aggregated, pricing, stock: null, periodDays: 30 });
    expect(snapshot.costState).toBe('SEM_CUSTO');
    expect(snapshot.cogs).toBeNull();
    expect(snapshot.grossProfit).toBeNull();
    expect(snapshot.grossMargin).toBeNull();
  });

  it('venda abaixo do custo gera estado PREJUIZO e não esconde o produto (sem classe forçada em C)', () => {
    const { aggregated } = aggregateVendas([{ sku: 'SKU1', quantidade: 10, valor: 50 }]); // preço médio 5
    const { map: pricing } = buildPricingMap([{ sku: 'SKU1', preco: 10, custo: 8 }]); // custo 8 > preço médio 5
    const [snapshot] = buildSkuSnapshots({ vendas: aggregated, pricing, stock: null, periodDays: 30 });
    expect(snapshot.costState).toBe('PREJUIZO');
    expect(snapshot.grossProfit).toBeLessThan(0);
    expect(snapshot.profitClass).toBeNull(); // não entra na classificação de lucro (só lucro positivo)
  });

  it('classifica 80/95 por faturamento decrescente com acumulado', () => {
    const { aggregated } = aggregateVendas([
      { sku: 'A', quantidade: 1, valor: 800 },
      { sku: 'B', quantidade: 1, valor: 150 },
      { sku: 'C', quantidade: 1, valor: 50 },
    ]);
    const { map: pricing } = buildPricingMap([]);
    const [a, b, c] = buildSkuSnapshots({ vendas: aggregated, pricing, stock: null, periodDays: 30, thresholdA: 80, thresholdB: 95 });
    expect(a.revenueClass).toBe('A'); // 800/1000 = 80%
    expect(b.revenueClass).toBe('B'); // acumulado 95%
    expect(c.revenueClass).toBe('C'); // acumulado 100%
  });

  it('sem arquivo de estoque, não calcula cobertura nem sugestão de compra', () => {
    const { aggregated } = aggregateVendas([{ sku: 'SKU1', quantidade: 10, valor: 100 }]);
    const { map: pricing } = buildPricingMap([{ sku: 'SKU1', preco: 15, custo: 5 }]);
    const [snapshot] = buildSkuSnapshots({ vendas: aggregated, pricing, stock: null, periodDays: 30 });
    expect(snapshot.coverageDays).toBeNull();
    expect(snapshot.suggestedPurchase).toBeNull();
  });

  it('com estoque, calcula demanda diária, cobertura, ponto de reposição e sugestão de compra', () => {
    const { aggregated } = aggregateVendas([{ sku: 'SKU1', quantidade: 30, valor: 300 }]); // 1/dia em 30 dias
    const { map: pricing } = buildPricingMap([{ sku: 'SKU1', preco: 10, custo: 5 }]);
    const stock = buildStockMap([{ sku: 'SKU1', estoqueDisponivel: 10, leadTimeDias: 7, estoqueSeguranca: 2 }]);
    const [snapshot] = buildSkuSnapshots({ vendas: aggregated, pricing, stock, periodDays: 30 });
    expect(snapshot.dailyDemand).toBe(1);
    expect(snapshot.coverageDays).toBe(10);
    expect(snapshot.reorderPoint).toBe(9); // 1*7 + 2
    expect(snapshot.suggestedPurchase).toBe(0); // reorderPoint(9) - estoque(10) <= 0
  });
});
