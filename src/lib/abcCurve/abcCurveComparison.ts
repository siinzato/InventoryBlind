// Curva ABC — comparação entre duas análises JÁ PUBLICADAS do mesmo workspace. Nada aqui
// recalcula classe, recomendação ou sinal: as duas pontas são snapshots imutáveis, e a
// comparação só lê, subtrai e casa SKU por SKU.
//
// O cuidado central é o período: duas análises podem cobrir 31 e 14 dias, e nesse caso
// faturamento absoluto não é comparável. O módulo devolve as duas leituras (absoluta e por
// dia) e diz se as durações batem — a tela decide qual promover, mas nunca finge equivalência.

import { metricClass, metricValue, type AbcMetric, type AbcRow } from './abcCurveAnalytics';
import { ABC_METRIC_OPTIONS } from './abcCurveAnalytics';

/** Forma estrutural mínima de uma análise publicada. AbcCurveAnalysis a satisfaz. */
export interface ComparableAnalysis {
  id: string;
  name: string;
  salesPeriodStart: string;
  salesPeriodEnd: string;
  createdAt: string;
  totalRevenue: number;
  totalQuantity: number;
  totalSkuCount: number;
  costCoveragePct: number | null;
  stockCoveragePct: number | null;
}

/** Dias cobertos pelo período de vendas, inclusive nas duas pontas — a mesma contagem que o
 *  Wizard usa para calcular demanda diária, para as duas leituras não divergirem. */
export function analysisPeriodDays(analysis: Pick<ComparableAnalysis, 'salesPeriodStart' | 'salesPeriodEnd'>): number {
  const start = new Date(analysis.salesPeriodStart).getTime();
  const end = new Date(analysis.salesPeriodEnd).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 1;
  return Math.max(1, Math.round((end - start) / 86400000) + 1);
}

/** Análise imediatamente anterior à selecionada, ordenando por fim do período de vendas e
 *  usando createdAt só como desempate. A lista recebida já vem filtrada por workspace pelo
 *  serviço (`.eq('company_id', …)`), então nunca há candidata de outra empresa aqui — e
 *  análise com período posterior nunca é escolhida como baseline. */
export function findPreviousAnalysis<T extends ComparableAnalysis>(analyses: T[], current: T | null): T | null {
  if (!current) return null;
  const earlier = analyses.filter(a => {
    if (a.id === current.id) return false;
    if (a.salesPeriodEnd !== current.salesPeriodEnd) return a.salesPeriodEnd < current.salesPeriodEnd;
    return a.createdAt < current.createdAt;
  });
  if (earlier.length === 0) return null;
  return earlier.reduce((best, a) => {
    if (a.salesPeriodEnd !== best.salesPeriodEnd) return a.salesPeriodEnd > best.salesPeriodEnd ? a : best;
    return a.createdAt > best.createdAt ? a : best;
  });
}

/** Candidatas a baseline: toda análise anterior à selecionada, mais recente primeiro. */
export function baselineOptions<T extends ComparableAnalysis>(analyses: T[], current: T | null): T[] {
  if (!current) return [];
  return analyses
    .filter(a => a.id !== current.id && (a.salesPeriodEnd < current.salesPeriodEnd
      || (a.salesPeriodEnd === current.salesPeriodEnd && a.createdAt < current.createdAt)))
    .sort((a, b) => (a.salesPeriodEnd === b.salesPeriodEnd
      ? b.createdAt.localeCompare(a.createdAt)
      : b.salesPeriodEnd.localeCompare(a.salesPeriodEnd)));
}

export interface MetricDelta {
  current: number;
  baseline: number;
  /** Diferença absoluta (mesma unidade da métrica). */
  abs: number;
  /** Variação percentual; null quando a base é zero — divisão por zero não é "+100%". */
  pct: number | null;
}

export function buildDelta(current: number, baseline: number): MetricDelta {
  return {
    current,
    baseline,
    abs: current - baseline,
    pct: baseline !== 0 ? ((current - baseline) / Math.abs(baseline)) * 100 : null,
  };
}

/** Diferença em PONTOS PERCENTUAIS. Cobertura é qualidade do dado, não crescimento comercial:
 *  ir de 72% para 76% é +4 p.p., nunca "+5,6%". */
export function pointsDelta(current: number | null, baseline: number | null): number | null {
  if (current === null || baseline === null) return null;
  return current - baseline;
}

const observedProfitTotal = (rows: AbcRow[]): number =>
  rows.reduce((sum, r) => sum + (r.gross_profit ?? 0), 0);

const classACount = (rows: AbcRow[], metric: AbcMetric): number =>
  rows.filter(r => metricClass(r, metric) === 'A').length;

export interface AnalysisComparison {
  baselineName: string;
  currentDays: number;
  baselineDays: number;
  /** Quando falso, a tela precisa promover as métricas por dia e avisar o usuário. */
  sameDuration: boolean;
  revenue: MetricDelta;
  profit: MetricDelta;
  quantity: MetricDelta;
  skuCount: MetricDelta;
  revenuePerDay: MetricDelta;
  profitPerDay: MetricDelta;
  quantityPerDay: MetricDelta;
  /** Qualidade do dado, em pontos percentuais. */
  costCoveragePoints: number | null;
  stockCoveragePoints: number | null;
  /** Classe A na curva de faturamento, em número de SKUs. */
  classAByRevenue: MetricDelta;
}

export function buildAnalysisComparison(
  current: ComparableAnalysis,
  baseline: ComparableAnalysis,
  currentRows: AbcRow[],
  baselineRows: AbcRow[],
): AnalysisComparison {
  const currentDays = analysisPeriodDays(current);
  const baselineDays = analysisPeriodDays(baseline);
  const currentProfit = observedProfitTotal(currentRows);
  const baselineProfit = observedProfitTotal(baselineRows);

  return {
    baselineName: baseline.name,
    currentDays,
    baselineDays,
    sameDuration: currentDays === baselineDays,
    revenue: buildDelta(current.totalRevenue, baseline.totalRevenue),
    profit: buildDelta(currentProfit, baselineProfit),
    quantity: buildDelta(current.totalQuantity, baseline.totalQuantity),
    skuCount: buildDelta(current.totalSkuCount, baseline.totalSkuCount),
    revenuePerDay: buildDelta(current.totalRevenue / currentDays, baseline.totalRevenue / baselineDays),
    profitPerDay: buildDelta(currentProfit / currentDays, baselineProfit / baselineDays),
    quantityPerDay: buildDelta(current.totalQuantity / currentDays, baseline.totalQuantity / baselineDays),
    costCoveragePoints: pointsDelta(current.costCoveragePct, baseline.costCoveragePct),
    stockCoveragePoints: pointsDelta(current.stockCoveragePct, baseline.stockCoveragePct),
    classAByRevenue: buildDelta(classACount(currentRows, 'revenue'), classACount(baselineRows, 'revenue')),
  };
}

export interface ClassCountDelta {
  metric: AbcMetric;
  label: string;
  a: MetricDelta;
  b: MetricDelta;
  c: MetricDelta;
}

/** Quantos SKUs em cada classe, agora e antes, nas três curvas. Contagem simples de classe
 *  persistida — nenhum score. */
export function buildClassCountDeltas(currentRows: AbcRow[], baselineRows: AbcRow[]): ClassCountDelta[] {
  const count = (rows: AbcRow[], metric: AbcMetric, cls: 'A' | 'B' | 'C') =>
    rows.filter(r => metricClass(r, metric) === cls).length;

  return ABC_METRIC_OPTIONS.map(({ value, label }) => ({
    metric: value,
    label,
    a: buildDelta(count(currentRows, value, 'A'), count(baselineRows, value, 'A')),
    b: buildDelta(count(currentRows, value, 'B'), count(baselineRows, value, 'B')),
    c: buildDelta(count(currentRows, value, 'C'), count(baselineRows, value, 'C')),
  }));
}

export interface TransitionRow {
  sku: string;
  productName: string | null;
  /** Classe no baseline; null = SKU não existia lá. */
  fromClass: string | null;
  /** Classe na análise atual; null = SKU não está aqui, ou está sem classe nesta curva. */
  toClass: string | null;
  baselineValue: number | null;
  currentValue: number | null;
}

export type TransitionBucket = 'upToA' | 'outOfA' | 'newInCurrent' | 'absentInCurrent';

export interface ClassTransitions {
  /** Contagem de cada par "antes→depois" (ex.: 'A→B'), só para SKUs presentes nas duas. */
  matrix: { from: string; to: string; count: number }[];
  upToA: TransitionRow[];
  outOfA: TransitionRow[];
  newInCurrent: TransitionRow[];
  absentInCurrent: TransitionRow[];
  /** SKUs presentes nas duas análises — a base em que a transição faz sentido. */
  matchedCount: number;
}

const label = (cls: string | null): string => cls ?? 'Sem classe';

/** Transições de classe na métrica escolhida, casando SKU por SKU (match exato, o mesmo do
 *  resto do módulo — nunca por nome de produto).
 *
 *  "Novo na análise" e "Ausente no período atual" são exatamente isso: presença nos arquivos
 *  comparados. Não afirmam produto novo nem produto descontinuado — o snapshot não prova
 *  cadastro, só o que veio nas planilhas daquele período. */
export function buildClassTransitions(
  currentRows: AbcRow[],
  baselineRows: AbcRow[],
  metric: AbcMetric,
): ClassTransitions {
  const baselineBySku = new Map(baselineRows.map(r => [r.sku, r]));
  const currentBySku = new Map(currentRows.map(r => [r.sku, r]));

  const matrixCounts = new Map<string, number>();
  const upToA: TransitionRow[] = [];
  const outOfA: TransitionRow[] = [];
  const newInCurrent: TransitionRow[] = [];
  const absentInCurrent: TransitionRow[] = [];
  let matchedCount = 0;

  for (const row of currentRows) {
    const before = baselineBySku.get(row.sku);
    const toClass = metricClass(row, metric);
    const currentValue = metricValue(row, metric);

    if (!before) {
      newInCurrent.push({ sku: row.sku, productName: row.product_name, fromClass: null, toClass, baselineValue: null, currentValue });
      continue;
    }

    matchedCount += 1;
    const fromClass = metricClass(before, metric);
    const key = `${label(fromClass)}→${label(toClass)}`;
    matrixCounts.set(key, (matrixCounts.get(key) ?? 0) + 1);

    if (fromClass === toClass) continue;
    const transition: TransitionRow = {
      sku: row.sku, productName: row.product_name, fromClass, toClass,
      baselineValue: metricValue(before, metric), currentValue,
    };
    if (toClass === 'A') upToA.push(transition);
    else if (fromClass === 'A') outOfA.push(transition);
  }

  for (const before of baselineRows) {
    if (currentBySku.has(before.sku)) continue;
    absentInCurrent.push({
      sku: before.sku, productName: before.product_name,
      fromClass: metricClass(before, metric), toClass: null,
      baselineValue: metricValue(before, metric), currentValue: null,
    });
  }

  const byValueDesc = (a: TransitionRow, b: TransitionRow) => (b.currentValue ?? b.baselineValue ?? 0) - (a.currentValue ?? a.baselineValue ?? 0);

  return {
    matrix: Array.from(matrixCounts.entries())
      .map(([key, count]) => { const [from, to] = key.split('→'); return { from, to, count }; })
      .sort((a, b) => b.count - a.count),
    upToA: upToA.sort(byValueDesc),
    outOfA: outOfA.sort(byValueDesc),
    newInCurrent: newInCurrent.sort(byValueDesc),
    absentInCurrent: absentInCurrent.sort(byValueDesc),
    matchedCount,
  };
}

export const TRANSITION_BUCKET_LABEL: Record<TransitionBucket, string> = {
  upToA: 'Subiram para A',
  outOfA: 'Saíram de A',
  newInCurrent: 'Novos na análise',
  absentInCurrent: 'Ausentes no período atual',
};
