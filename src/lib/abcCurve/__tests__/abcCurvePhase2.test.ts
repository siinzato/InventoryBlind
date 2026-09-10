// Curva ABC Fase 2 — política comercial por análise, sinais associados, comparação histórica
// e comparativo com a referência do Tiny. Só função pura + guardas de fonte (o projeto não tem
// infra de teste de componente); o mecanismo das guardas é o mesmo de migrationGuards.test.ts.

import { describe, expect, it } from 'vitest';
import { DEFAULT_ABC_POLICY, policySummaryRows, validateAbcPolicy, type AbcCommercialPolicy } from '../abcCurvePolicy';
import { evaluateRecommendation } from '../abcCurveRecommendations';
import { countSignals, evaluateSignals, presentSignals, signalLabel } from '../abcCurveSignals';
import { aggregateVendas, buildPricingMap, buildStockMap, buildSkuSnapshots, type SkuSnapshot } from '../abcCurveEngine';
import {
  analysisPeriodDays, baselineOptions, buildAnalysisComparison, buildClassCountDeltas,
  buildClassTransitions, buildDelta, findPreviousAnalysis, pointsDelta, type ComparableAnalysis,
} from '../abcCurveComparison';
import {
  buildTinyComparison, filterTinyRows, hasTinyReference, normalizeTinyClass, tinyBasisIsValue, TINY_SITUATION_LABEL,
  type TinyAwareRow,
} from '../abcCurveTiny';
import { filterSnapshots, EMPTY_PRODUCT_FILTERS, type AbcRow } from '../abcCurveAnalytics';

const SOURCES = import.meta.glob('/src/lib/abcCurve/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const COMPONENTS = import.meta.glob('/src/components/abcCurve/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const MIGRATIONS = import.meta.glob('/supabase/migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const pick = (map: Record<string, string>, fragment: string): string =>
  map[Object.keys(map).find(p => p.endsWith(fragment) || p.includes(fragment)) ?? ''] ?? '';

const MIGRATION_109 = pick(MIGRATIONS, '109_abc_curve_phase2.sql');
const RECOMMENDATIONS = pick(SOURCES, 'abcCurveRecommendations.ts');
const SERVICE = pick(SOURCES, 'abcCurveService.ts');
const WIZARD = pick(COMPONENTS, 'AbcCurveImportWizard.tsx');
const PAGE = pick(COMPONENTS, 'AbcCurvePage.tsx');
const COMPARISON_PANEL = pick(COMPONENTS, 'AbcComparisonPanel.tsx');
const TINY_TAB = pick(COMPONENTS, 'AbcTinyTab.tsx');

const snapshot = (overrides: Partial<SkuSnapshot>): SkuSnapshot => ({
  sku: 'SKU1', productName: 'Produto', quantity: 10, revenue: 100, freight: 0,
  avgPrice: 10, listPrice: 10, promoPrice: null, cost: 5, cogs: 50, grossProfit: 50, grossMargin: 0.5,
  realizedMarkup: 2, priceRealization: 1, turnoverClass: null, revenueClass: null, profitClass: null,
  costState: 'NORMAL', stockAvailable: null, stockReserved: null, stockInTransit: null, leadTimeDays: null,
  safetyStock: null, dailyDemand: null, coverageDays: null, reorderPoint: null, suggestedPurchase: null,
  ...overrides,
});

// ────────────────────────────── POLÍTICA ──────────────────────────────

describe('política comercial', () => {
  it('1. os defaults são exatamente os limiares que estavam fixos no código', () => {
    expect(DEFAULT_ABC_POLICY).toEqual({
      thresholdA: 80, thresholdB: 95,
      lowCoverageDays: 7, healthyCoverageDays: 30, excessCoverageDays: 90,
      lowMarginPct: 15, strongMarginPct: 40,
    });
    // E o módulo de regras não guarda mais nenhuma constante própria.
    expect(RECOMMENDATIONS).not.toMatch(/const (LOW|HEALTHY|EXCESS)_COVERAGE_DAYS/);
    expect(RECOMMENDATIONS).not.toMatch(/const (STRONG|LOW)_MARGIN/);
  });

  it('2. política inválida é bloqueada, em cada uma das regras', () => {
    const bad = (o: Partial<AbcCommercialPolicy>) => validateAbcPolicy({ ...DEFAULT_ABC_POLICY, ...o });
    expect(validateAbcPolicy(DEFAULT_ABC_POLICY)).toBeNull();
    expect(bad({ thresholdA: 95, thresholdB: 80 })).not.toBeNull();
    expect(bad({ thresholdA: 80, thresholdB: 80 })).not.toBeNull();
    expect(bad({ thresholdA: 0 })).not.toBeNull();
    expect(bad({ thresholdB: 101 })).not.toBeNull();
    expect(bad({ lowCoverageDays: -1 })).not.toBeNull();
    expect(bad({ lowCoverageDays: 30, healthyCoverageDays: 30 })).not.toBeNull();
    expect(bad({ healthyCoverageDays: 90, excessCoverageDays: 90 })).not.toBeNull();
    expect(bad({ lowMarginPct: -1 })).not.toBeNull();
    expect(bad({ lowMarginPct: 40, strongMarginPct: 40 })).not.toBeNull();
    expect(bad({ strongMarginPct: 101 })).not.toBeNull();
    expect(bad({ lowCoverageDays: NaN })).not.toBeNull();
    // 0 <= lowCoverageDays: zero é aceitável.
    expect(bad({ lowCoverageDays: 0 })).toBeNull();
  });

  it('3. a publicação grava a política e a migration adiciona as colunas', () => {
    expect(SERVICE).toContain('low_coverage_days: input.policy.lowCoverageDays');
    expect(SERVICE).toContain('healthy_coverage_days: input.policy.healthyCoverageDays');
    expect(SERVICE).toContain('excess_coverage_days: input.policy.excessCoverageDays');
    expect(SERVICE).toContain('low_margin_pct: input.policy.lowMarginPct');
    expect(SERVICE).toContain('strong_margin_pct: input.policy.strongMarginPct');

    for (const column of ['low_coverage_days', 'healthy_coverage_days', 'excess_coverage_days', 'low_margin_pct', 'strong_margin_pct']) {
      expect(MIGRATION_109, column).toContain(`ADD COLUMN IF NOT EXISTS ${column}`);
    }
    // Aditiva: nada removido, nada renomeado, threshold_a/b preservados.
    expect(MIGRATION_109).not.toMatch(/DROP COLUMN|RENAME|DELETE FROM|TRUNCATE/i);
    expect(MIGRATION_109).not.toMatch(/ALTER TABLE (products|inventory_\w+|physical_count_\w+)/i);
  });

  it('4. análise antiga resolve para os defaults equivalentes à regra antiga', () => {
    // Os DEFAULTs da migration são os mesmos números do código antigo...
    expect(MIGRATION_109).toContain('low_coverage_days     numeric NOT NULL DEFAULT 7');
    expect(MIGRATION_109).toContain('healthy_coverage_days numeric NOT NULL DEFAULT 30');
    expect(MIGRATION_109).toContain('excess_coverage_days  numeric NOT NULL DEFAULT 90');
    expect(MIGRATION_109).toContain('low_margin_pct        numeric NOT NULL DEFAULT 15');
    expect(MIGRATION_109).toContain('strong_margin_pct     numeric NOT NULL DEFAULT 40');
    // ...e a leitura cai nesses mesmos valores se a coluna vier ausente/nula.
    expect(SERVICE).toContain('row.low_coverage_days ?? DEFAULT_ABC_POLICY.lowCoverageDays');
    expect(SERVICE).toContain('row.strong_margin_pct ?? DEFAULT_ABC_POLICY.strongMarginPct');
  });

  it('5. a recomendação usa a política recebida, não uma constante global', () => {
    const base = snapshot({ profitClass: 'A', stockAvailable: 100, coverageDays: 20 });

    // Cobertura de 20 dias: "saudável" com o padrão (>= 30 não; entre 7 e 30 => nenhuma das
    // duas regras), mas política com saudável em 15 dias já classifica como protegida.
    expect(evaluateRecommendation(base, DEFAULT_ABC_POLICY)?.code).not.toBe('PROTEGER_DISPONIBILIDADE');
    expect(evaluateRecommendation(base, { ...DEFAULT_ABC_POLICY, healthyCoverageDays: 15 })?.code)
      .toBe('PROTEGER_DISPONIBILIDADE');

    // Baixa cobertura: 20 dias não é baixa no padrão (7), é baixa numa política de 25.
    expect(evaluateRecommendation(base, { ...DEFAULT_ABC_POLICY, lowCoverageDays: 25, healthyCoverageDays: 30 })?.code)
      .toBe('COMPRA_URGENTE');

    // Margem: 20% não é baixa no padrão (15%), é baixa numa política de 25%.
    const lowMargin = snapshot({ revenueClass: 'A', grossMargin: 0.2 });
    expect(evaluateRecommendation(lowMargin, DEFAULT_ABC_POLICY)?.code).not.toBe('RENEGOCIAR_CUSTO_OU_PRECO');
    expect(evaluateRecommendation(lowMargin, { ...DEFAULT_ABC_POLICY, lowMarginPct: 25 })?.code)
      .toBe('RENEGOCIAR_CUSTO_OU_PRECO');
  });

  it('a leitura da política é somente leitura e mostra os operadores reais das regras', () => {
    const rows = policySummaryRows(DEFAULT_ABC_POLICY);
    expect(rows.map(r => r.label)).toEqual(['ABC', 'Baixa cobertura', 'Cobertura saudável', 'Excesso', 'Margem baixa', 'Margem forte']);
    expect(rows.find(r => r.label === 'Baixa cobertura')?.value).toBe('< 7d');
    expect(rows.find(r => r.label === 'Cobertura saudável')?.value).toBe('≥ 30d');
    expect(rows.find(r => r.label === 'Excesso')?.value).toBe('> 90d');
  });
});

// ────────────────────────────── SINAIS ──────────────────────────────

describe('sinais associados', () => {
  it('6. um SKU tem UMA recomendação principal e VÁRIOS sinais', () => {
    const s = snapshot({
      quantity: 10, revenue: 100, costState: 'SEM_CUSTO', cost: null, cogs: null,
      grossProfit: null, grossMargin: null, stockAvailable: 0, coverageDays: 0, turnoverClass: 'A',
    });
    const rec = evaluateRecommendation(s, DEFAULT_ABC_POLICY);
    const signals = evaluateSignals(s, DEFAULT_ABC_POLICY);

    expect(rec?.code).toBe('CORRIGIR_CUSTO');
    expect(signals).toContain('SEM_CUSTO');
    expect(signals).toContain('RUPTURA');
    expect(signals).toContain('BAIXA_COBERTURA');
    expect(signals).toContain('ALTO_GIRO');
    expect(signals.length).toBeGreaterThan(1);
  });

  it('7. os sinais são determinísticos: mesma entrada, mesma saída e mesma ordem', () => {
    const s = snapshot({ profitClass: 'A', revenueClass: 'A', turnoverClass: 'A', grossMargin: 0.6, stockAvailable: 5, coverageDays: 120 });
    const first = evaluateSignals(s, DEFAULT_ABC_POLICY);
    const second = evaluateSignals(s, DEFAULT_ABC_POLICY);
    expect(first).toEqual(second);
    // Problema antes de destaque, sempre na mesma ordem.
    expect(first).toEqual(['EXCESSO_COBERTURA', 'MARGEM_FORTE', 'ALTO_GIRO', 'ALTO_FATURAMENTO', 'ALTO_LUCRO']);
  });

  it('7b. os sinais respondem à política, não a constantes', () => {
    const s = snapshot({ grossMargin: 0.2, coverageDays: 50, stockAvailable: 10 });
    expect(evaluateSignals(s, DEFAULT_ABC_POLICY)).not.toContain('MARGEM_BAIXA');
    expect(evaluateSignals(s, { ...DEFAULT_ABC_POLICY, lowMarginPct: 25 })).toContain('MARGEM_BAIXA');
    expect(evaluateSignals(s, DEFAULT_ABC_POLICY)).not.toContain('EXCESSO_COBERTURA');
    expect(evaluateSignals(s, { ...DEFAULT_ABC_POLICY, excessCoverageDays: 40 })).toContain('EXCESSO_COBERTURA');
  });

  it('8. os sinais históricos vêm do snapshot — a leitura nunca reavalia', () => {
    // Persistidos na publicação...
    expect(SERVICE).toContain('signal_codes: input.signalsBySku.get(s.sku) ?? []');
    expect(MIGRATION_109).toContain("ADD COLUMN IF NOT EXISTS signal_codes        text[] NOT NULL DEFAULT '{}'");
    // ...e a página lê o array gravado, sem chamar evaluateSignals.
    expect(PAGE).toContain('s.signal_codes ?? []');
    expect(PAGE).not.toContain('evaluateSignals');
    // Sinais são calculados no wizard (publicação), uma vez.
    expect(WIZARD).toContain('const signals = evaluateSignals(s, policy)');
  });

  it('9. sem venda e com estoque positivo inclui ESTOQUE_PARADO', () => {
    const signals = evaluateSignals(snapshot({ quantity: 0, revenue: 0, stockAvailable: 40, costState: 'SEM_CUSTO', grossMargin: null }), DEFAULT_ABC_POLICY);
    expect(signals).toContain('ESTOQUE_PARADO');
    expect(signals).not.toContain('RUPTURA');
  });

  it('10. venda sem custo inclui SEM_CUSTO', () => {
    const signals = evaluateSignals(snapshot({ quantity: 10, revenue: 100, costState: 'SEM_CUSTO', cost: null, grossMargin: null }), DEFAULT_ABC_POLICY);
    expect(signals).toContain('SEM_CUSTO');
  });

  it('estoque desconhecido não gera sinal de estoque', () => {
    const signals = evaluateSignals(snapshot({ quantity: 0, revenue: 0, stockAvailable: null, coverageDays: null }), DEFAULT_ABC_POLICY);
    expect(signals).not.toContain('ESTOQUE_PARADO');
    expect(signals).not.toContain('RUPTURA');
    expect(signals).not.toContain('BAIXA_COBERTURA');
  });

  it('o filtro só oferece sinais presentes, e conta por grupo', () => {
    const rows = [
      { signal_codes: ['SEM_CUSTO', 'ALTO_GIRO'] },
      { signal_codes: ['SEM_CUSTO'] },
      { signal_codes: null },
    ];
    expect(presentSignals(rows)).toEqual(['SEM_CUSTO', 'ALTO_GIRO']);
    expect(countSignals(rows)).toEqual([{ code: 'SEM_CUSTO', count: 2 }, { code: 'ALTO_GIRO', count: 1 }]);
    expect(signalLabel('SEM_CUSTO')).toBe('Sem custo');
    // Código desconhecido não desaparece nem quebra.
    expect(presentSignals([{ signal_codes: ['FUTURO'] }])).toEqual(['FUTURO']);
    expect(signalLabel('FUTURO')).toBe('FUTURO');
  });

  it('o filtro por sinal usa o array gravado, e snapshot sem sinais não entra no recorte', () => {
    const row = (sku: string, codes: string[] | null): AbcRow => ({
      sku, product_name: sku, quantity: 1, revenue: 10, gross_profit: 1, gross_margin: 0.1,
      cost_state: 'NORMAL', turnover_class: 'A', revenue_class: 'A', profit_class: 'A',
      stock_available: null, coverage_days: null, signal_codes: codes,
    });
    const rows = [row('COM', ['SEM_CUSTO']), row('SEM', null)];
    const out = filterSnapshots(rows, { ...EMPTY_PRODUCT_FILTERS, signal: 'SEM_CUSTO' }, new Map());
    expect(out.map(r => r.sku)).toEqual(['COM']);
  });

  it('o pipeline completo grava sinais coerentes com o snapshot', () => {
    const { aggregated } = aggregateVendas([{ sku: 'VENDIDO', quantidade: 30, valor: 300 }]);
    const { map: pricing } = buildPricingMap([{ sku: 'VENDIDO', preco: 10, custo: 2 }]);
    const { map: stock } = buildStockMap([{ sku: 'VENDIDO', estoqueDisponivel: 3 }, { sku: 'PARADO', estoqueDisponivel: 12 }]);
    const snapshots = buildSkuSnapshots({ vendas: aggregated, pricing, stock, periodDays: 30 });

    const vendido = snapshots.find(s => s.sku === 'VENDIDO')!;
    const parado = snapshots.find(s => s.sku === 'PARADO')!;
    expect(evaluateSignals(vendido, DEFAULT_ABC_POLICY)).toContain('BAIXA_COBERTURA'); // 3 dias
    expect(evaluateSignals(vendido, DEFAULT_ABC_POLICY)).toContain('MARGEM_FORTE');    // 80%
    expect(evaluateSignals(parado, DEFAULT_ABC_POLICY)).toContain('ESTOQUE_PARADO');
  });
});

// ────────────────────────────── HISTÓRICO ──────────────────────────────

const analysis = (o: Partial<ComparableAnalysis> & { id: string }): ComparableAnalysis => ({
  name: `Análise ${o.id}`, salesPeriodStart: '2026-08-01', salesPeriodEnd: '2026-08-31',
  createdAt: '2026-09-01T00:00:00Z', totalRevenue: 1000, totalQuantity: 100, totalSkuCount: 10,
  costCoveragePct: 70, stockCoveragePct: 80, ...o,
});

const abcRow = (o: Partial<AbcRow> & { sku: string }): AbcRow => ({
  product_name: `Produto ${o.sku}`, quantity: 10, revenue: 100, gross_profit: 40, gross_margin: 0.4,
  cost_state: 'NORMAL', turnover_class: 'A', revenue_class: 'A', profit_class: 'A',
  stock_available: null, coverage_days: null, ...o,
});

describe('comparação histórica', () => {
  it('11. o baseline nunca pode vir de outro workspace', () => {
    // A garantia é estrutural: a lista chega do serviço já filtrada por company_id, e a
    // página só monta candidatas a partir dela.
    expect(SERVICE).toContain("from('abc_curve_analyses').select('*')");
    expect(SERVICE).toContain(".eq('company_id', companyId).eq('status', 'published')");
    expect(PAGE).toContain('buildBaselineOptions(analyses, selected)');
    // E a busca dos snapshots do baseline também é company-scoped.
    expect(PAGE).toContain('listSkuSnapshots(companyId, baselineId)');
    const fn = SERVICE.slice(SERVICE.indexOf('export async function listSkuSnapshots'), SERVICE.indexOf('export async function listRecommendations'));
    expect(fn).toContain(".eq('company_id', companyId)");
  });

  it('12. a análise anterior é realmente anterior (fim do período, createdAt só desempata)', () => {
    const atual = analysis({ id: 'atual', salesPeriodEnd: '2026-08-31' });
    const anterior = analysis({ id: 'anterior', salesPeriodEnd: '2026-07-31' });
    const antiga = analysis({ id: 'antiga', salesPeriodEnd: '2026-06-30' });
    const futura = analysis({ id: 'futura', salesPeriodEnd: '2026-09-30' });
    const all = [atual, futura, antiga, anterior];

    expect(findPreviousAnalysis(all, atual)?.id).toBe('anterior');
    expect(baselineOptions(all, atual).map(a => a.id)).toEqual(['anterior', 'antiga']);
    // Análise futura nunca é baseline.
    expect(baselineOptions(all, atual).some(a => a.id === 'futura')).toBe(false);
    expect(findPreviousAnalysis([atual], atual)).toBeNull();

    // Mesmo fim de período: createdAt desempata.
    const a1 = analysis({ id: 'a1', salesPeriodEnd: '2026-08-31', createdAt: '2026-09-01T00:00:00Z' });
    const a2 = analysis({ id: 'a2', salesPeriodEnd: '2026-08-31', createdAt: '2026-09-05T00:00:00Z' });
    expect(findPreviousAnalysis([a1, a2], a2)?.id).toBe('a1');
    expect(findPreviousAnalysis([a1, a2], a1)).toBeNull();
  });

  it('13. mesma duração calcula delta direto', () => {
    const atual = analysis({ id: 'a', salesPeriodStart: '2026-08-01', salesPeriodEnd: '2026-08-31', totalRevenue: 1200, totalQuantity: 120 });
    const anterior = analysis({ id: 'b', salesPeriodStart: '2026-07-01', salesPeriodEnd: '2026-07-31', totalRevenue: 1000, totalQuantity: 100 });
    const cmp = buildAnalysisComparison(atual, anterior, [abcRow({ sku: 'X', gross_profit: 60 })], [abcRow({ sku: 'X', gross_profit: 50 })]);

    expect(cmp.sameDuration).toBe(true);
    expect(cmp.currentDays).toBe(31);
    expect(cmp.revenue.abs).toBe(200);
    expect(cmp.revenue.pct).toBeCloseTo(20, 5);
    expect(cmp.profit.current).toBe(60);
    expect(cmp.profit.baseline).toBe(50);
  });

  it('14. durações diferentes calculam métricas por dia', () => {
    const atual = analysis({ id: 'a', salesPeriodStart: '2026-08-01', salesPeriodEnd: '2026-08-14', totalRevenue: 700, totalQuantity: 70 });
    const anterior = analysis({ id: 'b', salesPeriodStart: '2026-07-01', salesPeriodEnd: '2026-07-31', totalRevenue: 1000, totalQuantity: 100 });
    const cmp = buildAnalysisComparison(atual, anterior, [], []);

    expect(cmp.sameDuration).toBe(false);
    expect(cmp.currentDays).toBe(14);
    expect(cmp.baselineDays).toBe(31);
    // Absoluto cai, por dia sobe — as duas leituras existem e não se confundem.
    expect(cmp.revenue.abs).toBeLessThan(0);
    expect(cmp.revenuePerDay.current).toBeCloseTo(50, 5);
    expect(cmp.revenuePerDay.baseline).toBeCloseTo(1000 / 31, 5);
    expect(cmp.revenuePerDay.abs).toBeGreaterThan(0);
    expect(analysisPeriodDays({ salesPeriodStart: '2026-08-01', salesPeriodEnd: '2026-08-01' })).toBe(1);
  });

  it('15. cobertura é comparada em pontos percentuais, nunca em variação relativa', () => {
    const atual = analysis({ id: 'a', costCoveragePct: 76, stockCoveragePct: null });
    const anterior = analysis({ id: 'b', costCoveragePct: 72, stockCoveragePct: 80 });
    const cmp = buildAnalysisComparison(atual, anterior, [], []);

    expect(cmp.costCoveragePoints).toBeCloseTo(4, 5);
    expect(cmp.stockCoveragePoints).toBeNull(); // sem snapshot agora: nada é afirmado
    expect(pointsDelta(76, 72)).toBeCloseTo(4, 5);
    expect(pointsDelta(null, 72)).toBeNull();
    // E a UI usa "p.p." nesse bloco.
    expect(COMPARISON_PANEL).toContain('p.p.');
  });

  it('16. a transição A → B é detectada, e a matriz conta os pares', () => {
    const current = [
      abcRow({ sku: 'CAIU', revenue_class: 'B', revenue: 50 }),
      abcRow({ sku: 'SUBIU', revenue_class: 'A', revenue: 900 }),
      abcRow({ sku: 'ESTAVEL', revenue_class: 'A', revenue: 500 }),
    ];
    const baseline = [
      abcRow({ sku: 'CAIU', revenue_class: 'A', revenue: 800 }),
      abcRow({ sku: 'SUBIU', revenue_class: 'C', revenue: 10 }),
      abcRow({ sku: 'ESTAVEL', revenue_class: 'A', revenue: 480 }),
    ];
    const t = buildClassTransitions(current, baseline, 'revenue');

    expect(t.matchedCount).toBe(3);
    expect(t.outOfA.map(r => r.sku)).toEqual(['CAIU']);
    expect(t.outOfA[0].fromClass).toBe('A');
    expect(t.outOfA[0].toClass).toBe('B');
    expect(t.upToA.map(r => r.sku)).toEqual(['SUBIU']);
    expect(t.matrix.find(m => m.from === 'A' && m.to === 'B')?.count).toBe(1);
    expect(t.matrix.find(m => m.from === 'A' && m.to === 'A')?.count).toBe(1);

    // A curva escolhida manda: por giro, as classes são as mesmas nas duas pontas.
    const byTurnover = buildClassTransitions(current, baseline, 'turnover');
    expect(byTurnover.upToA).toHaveLength(0);
    expect(byTurnover.outOfA).toHaveLength(0);
  });

  it('a distribuição por classe é comparada nas três curvas', () => {
    const current = [abcRow({ sku: 'X', revenue_class: 'A', turnover_class: 'B', profit_class: 'C' })];
    const baseline = [abcRow({ sku: 'X', revenue_class: 'B', turnover_class: 'B', profit_class: 'C' })];
    const deltas = buildClassCountDeltas(current, baseline);
    expect(deltas.map(d => d.metric)).toEqual(['turnover', 'revenue', 'profit']);
    expect(deltas.find(d => d.metric === 'revenue')!.a.abs).toBe(1);
    expect(deltas.find(d => d.metric === 'revenue')!.b.abs).toBe(-1);
    expect(deltas.find(d => d.metric === 'turnover')!.b.abs).toBe(0);
  });

  it('17. SKU só na análise atual é "novo na análise", nunca "produto novo"', () => {
    const t = buildClassTransitions([abcRow({ sku: 'NOVO' })], [abcRow({ sku: 'VELHO' })], 'revenue');
    expect(t.newInCurrent.map(r => r.sku)).toEqual(['NOVO']);
    expect(t.newInCurrent[0].fromClass).toBeNull();
    expect(t.newInCurrent[0].baselineValue).toBeNull();
    expect(COMPARISON_PANEL).toContain('Novo na análise');
    expect(COMPARISON_PANEL).not.toMatch(/produto novo|rec[eé]m[- ]cadastrado/i);
  });

  it('18. SKU ausente é "ausente no período atual", nunca "descontinuado"', () => {
    const t = buildClassTransitions([abcRow({ sku: 'NOVO' })], [abcRow({ sku: 'VELHO', revenue_class: 'A' })], 'revenue');
    expect(t.absentInCurrent.map(r => r.sku)).toEqual(['VELHO']);
    expect(t.absentInCurrent[0].toClass).toBeNull();
    expect(t.absentInCurrent[0].fromClass).toBe('A');
    expect(COMPARISON_PANEL).toContain('Ausente no período atual');
    expect(COMPARISON_PANEL).not.toMatch(/descontinuad|fora de linha/i);
    // Ausente não conta como "saiu de A": ele não trocou de classe, ele não está aqui.
    expect(t.outOfA).toHaveLength(0);
  });

  it('delta sem base não inventa percentual', () => {
    expect(buildDelta(10, 0).pct).toBeNull();
    expect(buildDelta(10, 0).abs).toBe(10);
    expect(buildDelta(5, -10).pct).toBeCloseTo(150, 5); // base negativa usa módulo
  });

  it('o baseline é carregado sob demanda, só da análise escolhida', () => {
    // Um efeito dedicado ao baselineId — não um carregamento de todas as análises.
    expect(PAGE).toContain('if (!baselineId) { setBaselineRows([]); return; }');
    expect(PAGE).toMatch(/\}, \[companyId, baselineId\]\);/);
    // E as contas da comparação passam por useMemo.
    const flat = COMPARISON_PANEL.replace(/\s+/g, ' ');
    for (const fn of ['buildAnalysisComparison', 'buildClassCountDeltas', 'buildClassTransitions']) {
      expect(flat, fn).toContain(fn);
      expect(flat).toContain('useMemo(');
    }
  });
});

// ────────────────────────────── TINY ──────────────────────────────

const tinyRow = (o: Partial<TinyAwareRow> & { sku: string }): TinyAwareRow => ({
  product_name: `Produto ${o.sku}`, revenue: 100, revenue_class: 'A',
  tiny_quantity: null, tiny_value: null, tiny_individual_pct: null,
  tiny_cumulative_pct: null, tiny_classification: null, ...o,
});

describe('comparativo Tiny', () => {
  it('19. os campos de ABC_TINY_FIELDS são realmente mapeados e lidos', () => {
    // Mesmo fluxo dos outros arquivos: nenhum parser paralelo.
    expect(WIZARD).toContain('renderUploadStep(\'Curva ABC do Tiny\', ABC_TINY_FIELDS, abcTiny, setAbcTiny, tinyMissing)');
    expect(WIZARD).toContain('applyMapping(abcTiny.rawRows, abcTiny.mapping)');
    for (const field of ['row.quantidade', 'row.valor', 'row.percentualIndividual', 'row.percentualAcumulado', 'row.classificacao']) {
      expect(WIZARD, field).toContain(field);
    }
    // E o campo obrigatório do Tiny bloqueia a prévia como os demais.
    expect(WIZARD).toContain('missingRequiredFields(ABC_TINY_FIELDS, abcTiny.mapping)');
    expect(WIZARD).toContain('tinyMissing.length === 0');
  });

  it('20/21. o match é só por SKU exato — sem fuzzy e sem nome de produto', () => {
    const tinyBlock = WIZARD.slice(WIZARD.indexOf('const tinyBySku'), WIZARD.indexOf('if (tinyUnmatched > 0)'));
    expect(tinyBlock).toContain('const sku = normalizeSku(row.sku)');
    expect(tinyBlock).toContain('snapshotSkus.has(sku)');
    // Nada de similaridade nem casamento por descrição.
    expect(tinyBlock).not.toMatch(/levenshtein|similar|fuzzy|productName|row\.produto/i);
    // SKU do Tiny que não existe na análise não cria produto: só é contado.
    expect(tinyBlock).toContain('tinyUnmatched += 1; continue;');
    expect(tinyBlock).not.toMatch(/snapshots\.push|createProduct|insert/i);
  });

  it('22. os campos do Tiny persistem no snapshot, nulos quando não há correspondência', () => {
    for (const column of ['tiny_quantity', 'tiny_value', 'tiny_individual_pct', 'tiny_cumulative_pct', 'tiny_classification']) {
      expect(MIGRATION_109, column).toContain(`ADD COLUMN IF NOT EXISTS ${column}`);
      expect(SERVICE, column).toContain(`${column}: tiny?.`);
    }
    expect(SERVICE).toContain('tiny_value: tiny?.value ?? null');
    // Nenhuma tabela nova só para o Tiny.
    expect(MIGRATION_109).not.toMatch(/CREATE TABLE/i);
  });

  it('23. a aba só aparece quando há dado comparável', () => {
    expect(hasTinyReference([tinyRow({ sku: 'X' })])).toBe(false);
    expect(hasTinyReference([tinyRow({ sku: 'X', tiny_classification: 'A' })])).toBe(true);
    expect(hasTinyReference([tinyRow({ sku: 'X', tiny_value: 10 })])).toBe(true);
    // Campo ausente (snapshot pré-109) é tratado como sem dado.
    expect(hasTinyReference([{ sku: 'X', product_name: 'X', revenue: 1, revenue_class: 'A' }])).toBe(false);
    // E a aba é condicional na página.
    expect(PAGE).toContain("...(tinyAvailable ? [{ value: 'tiny' as Tab, label: 'Comparativo Tiny' }] : [])");
  });

  it('24. a coincidência de classe é calculada corretamente', () => {
    const rows = [
      tinyRow({ sku: 'IGUAL', revenue_class: 'A', tiny_classification: 'A', tiny_value: 900 }),
      tinyRow({ sku: 'DIFERENTE', revenue_class: 'B', tiny_classification: 'A', tiny_value: 500 }),
      tinyRow({ sku: 'CAIXA', revenue_class: 'A', tiny_classification: ' a ', tiny_value: 400 }),
      tinyRow({ sku: 'SEM_TINY', revenue_class: 'C' }),
    ];
    const { rows: out, summary } = buildTinyComparison(rows);

    expect(summary.comparable).toBe(3);
    expect(summary.sameClass).toBe(2); // IGUAL + CAIXA (" a " normaliza para "A")
    expect(summary.differentClass).toBe(1);
    expect(summary.unmatched).toBe(1);
    expect(out.find(r => r.sku === 'SEM_TINY')?.situation).toBe('unmatched');
    expect(normalizeTinyClass(' a ')).toBe('A');
    expect(normalizeTinyClass('')).toBeNull();
    expect(normalizeTinyClass(undefined)).toBeNull();
  });

  it('25. diferença de classe nunca é chamada de erro', () => {
    // Só o que vai para a tela: comentário explicando a decisão ("nunca correto/errado") não
    // é texto de interface.
    const withoutComments = (src: string) => src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    for (const source of [TINY_TAB, pick(SOURCES, 'abcCurveTiny.ts')]) {
      expect(withoutComments(source)).not.toMatch(/\b(incorreto|errado|erro de classifica|divergência incorreta)\b/i);
    }
    expect(TINY_TAB).toContain('Comparação de referência');
    expect(TINY_TAB).toContain('Diferenças podem decorrer do período, base ou critérios utilizados.');
    // O vocabulário da coluna Situação vem do módulo, e é o neutro.
    expect(TINY_SITUATION_LABEL).toEqual({ match: 'Coincidente', different: 'Diferente', unmatched: 'Sem correspondência' });
  });

  it('26. Tiny sem correspondência aparece como tal, dos dois lados', () => {
    const { summary } = buildTinyComparison([tinyRow({ sku: 'SEM' })]);
    expect(summary.unmatched).toBe(1);
    expect(summary.withTinyData).toBe(0);
    // Lado do arquivo: contagens vindas do batch, sem estrutura nova.
    expect(TINY_TAB).toContain('sem correspondência (não constam nesta análise e não foram criados)');
    expect(PAGE).toContain('fileUnmatched={tinyBatch?.warningCount ?? null}');
  });

  it('a base da comparação é declarada, não presumida', () => {
    expect(tinyBasisIsValue([tinyRow({ sku: 'X', tiny_classification: 'A' })])).toBe(false);
    expect(tinyBasisIsValue([tinyRow({ sku: 'X', tiny_value: 10 })])).toBe(true);
    expect(tinyBasisIsValue([tinyRow({ sku: 'X', tiny_cumulative_pct: 80 })])).toBe(true);
    expect(TINY_TAB).toContain('a equivalência com uma curva específica não pode ser afirmada');
  });

  it('os filtros do comparativo são locais e não mutam a lista', () => {
    const { rows } = buildTinyComparison([
      tinyRow({ sku: 'IGUAL', revenue_class: 'A', tiny_classification: 'A' }),
      tinyRow({ sku: 'DIF', revenue_class: 'B', tiny_classification: 'A' }),
      tinyRow({ sku: 'SEM' }),
    ]);
    const original = [...rows];
    expect(filterTinyRows(rows, { search: '', situation: 'match' }).map(r => r.sku)).toEqual(['IGUAL']);
    expect(filterTinyRows(rows, { search: '', situation: 'different' }).map(r => r.sku)).toEqual(['DIF']);
    expect(filterTinyRows(rows, { search: '', situation: 'unmatched' }).map(r => r.sku)).toEqual(['SEM']);
    expect(filterTinyRows(rows, { search: 'produto sem', situation: 'all' }).map(r => r.sku)).toEqual(['SEM']);
    expect(rows).toEqual(original);
  });
});

// ────────────────────────────── REGRESSÃO ──────────────────────────────

describe('regressão da Fase 1', () => {
  it('27. o Pareto da Fase 1 continua no lugar e correto', () => {
    expect(PAGE).toContain('<AbcParetoChart data={pareto}');
    expect(PAGE).toContain('buildPareto(snapshots, paretoMetric)');
    expect(PAGE).toContain('Concentração ABC');
    expect(pick(COMPONENTS, 'AbcParetoChart.tsx').length).toBeGreaterThan(0);
  });

  it('28. os filtros de Produtos da Fase 1 continuam existindo', () => {
    for (const id of ['abc-filter-turnover', 'abc-filter-revenue', 'abc-filter-profit', 'abc-filter-cost', 'abc-filter-recommendation', 'abc-filter-stock']) {
      expect(PAGE, id).toContain(id);
    }
    // E o novo, da Fase 2.
    expect(PAGE).toContain('abc-filter-signal');
    expect(PAGE).toContain('filterSnapshots(snapshots, filters, recommendationBySku)');
  });

  it('29. a Matriz da Fase 1 continua, agora com sinais no drill-down', () => {
    expect(PAGE).toContain('aggregateGroup(rows)');
    expect(PAGE).toContain('RECOMMENDATION_RULE[code]');
    expect(PAGE).toContain('Sinais associados');
    expect(PAGE).toContain('countSignals(rows)');
  });

  it('30. Fontes continua, com política e situação real da referência Tiny', () => {
    expect(PAGE).toContain('Linhas recebidas');
    expect(PAGE).toContain('Linhas válidas');
    expect(PAGE).toContain('Parâmetros utilizados');
    expect(PAGE).toContain('referência utilizada no comparativo');
    expect(PAGE).toContain('referência sem dados comparáveis');
  });

  it('31. análise histórica é read-only: nada é recalculado ao selecioná-la', () => {
    // A página não roda motor nenhum: nem classes, nem recomendação, nem sinais, nem Tiny.
    expect(PAGE).not.toMatch(/buildSkuSnapshots|classifyInPlace|evaluateRecommendation|evaluateSignals/);
    expect(PAGE).not.toMatch(/normalizeTinyClass|parseNumber/);
    // E não escreve: nenhuma publicação/atualização disparada pela leitura.
    expect(PAGE).not.toMatch(/publishAnalysis|\.update\(|\.insert\(/);
    // A política exibida é a da análise, não o padrão atual do produto.
    expect(PAGE).toContain('policy={selected.policy}');
    expect(PAGE).not.toContain('DEFAULT_ABC_POLICY');
  });

  it('troca de workspace limpa baseline, comparação, Tiny e filtros', () => {
    const effect = PAGE.slice(PAGE.indexOf('useEffect(() => {\n    setAnalyses([]);'), PAGE.indexOf('}, [companyId]);'));
    expect(effect).toContain('setBaselineId(\'\')');
    expect(effect).toContain('setBaselineRows([])');
    expect(effect).toContain('setSnapshots([])');
    expect(effect).toContain('setBatches([])');
    expect(effect).toContain('setFilters(EMPTY_PRODUCT_FILTERS)');
    // A aba volta para Visão geral: "Comparativo Tiny" pode não existir no novo workspace.
    expect(effect).toContain("setTab('overview')");
  });

  it('nenhum módulo da Fase 2 chama IA nem adiciona dependência', () => {
    for (const source of [pick(SOURCES, 'abcCurvePolicy.ts'), pick(SOURCES, 'abcCurveSignals.ts'), pick(SOURCES, 'abcCurveComparison.ts'), pick(SOURCES, 'abcCurveTiny.ts'), COMPARISON_PANEL, TINY_TAB]) {
      expect(source.length).toBeGreaterThan(0);
      expect(source).not.toMatch(/anthropic|openai|claude-|gpt-|messages\.create/i);
      expect(source).not.toMatch(/from 'recharts'|from 'chart\.js'|from 'd3'|from 'lodash'/);
    }
  });
});
