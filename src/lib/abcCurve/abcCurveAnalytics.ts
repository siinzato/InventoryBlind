// Curva ABC — agregações puras de leitura para a Visão geral, Produtos e Matriz de decisão.
// Nada aqui recalcula classificação ou recomendação: as classes e os códigos já foram
// calculados e persistidos no momento da publicação, e são a fonte de verdade. Este arquivo
// só soma, ordena, agrupa e filtra o que já está no snapshot — para a página não fazer isso
// dentro do render e para essas contas terem teste próprio.

/** Forma estrutural mínima de um snapshot persistido (abc_curve_sku_snapshots). Declarada
 *  localmente para o módulo continuar puro — `SkuSnapshotRow & { id }` a satisfaz. */
export interface AbcRow {
  sku: string;
  product_name: string | null;
  quantity: number;
  revenue: number;
  gross_profit: number | null;
  gross_margin: number | null;
  cost_state: string;
  turnover_class: string | null;
  revenue_class: string | null;
  profit_class: string | null;
  stock_available: number | null;
  coverage_days: number | null;
  /** Sinais gravados na publicação (migration 109). Ausente em snapshot anterior à Fase 2. */
  signal_codes?: string[] | null;
}

export type AbcMetric = 'turnover' | 'revenue' | 'profit';

export const ABC_METRIC_OPTIONS: { value: AbcMetric; label: string }[] = [
  { value: 'turnover', label: 'Giro' },
  { value: 'revenue', label: 'Faturamento' },
  { value: 'profit', label: 'Lucro' },
];

export const ABC_METRIC_LABEL: Record<AbcMetric, string> = {
  turnover: 'Giro (unidades)',
  revenue: 'Faturamento',
  profit: 'Lucro bruto',
};

/** Métrica do Pareto. Lucro considera só lucro positivo e elegível — o mesmo critério que o
 *  motor usou para classificar, para barra e classe nunca discordarem. */
export const metricValue = (row: AbcRow, metric: AbcMetric): number => {
  if (metric === 'turnover') return row.quantity;
  if (metric === 'revenue') return row.revenue;
  return row.cost_state === 'NORMAL' && row.gross_profit !== null && row.gross_profit > 0 ? row.gross_profit : 0;
};

export const metricClass = (row: AbcRow, metric: AbcMetric): string | null => {
  if (metric === 'turnover') return row.turnover_class;
  if (metric === 'revenue') return row.revenue_class;
  return row.profit_class;
};

/** Elegível = tem classe persistida naquela curva. SKU sem classe (só estoque, sem venda,
 *  prejuízo) fica fora do Pareto e da distribuição em vez de ser tratado como classe C. */
export const isEligible = (row: AbcRow, metric: AbcMetric): boolean => metricClass(row, metric) !== null;

export interface AbcClassStat {
  cls: 'A' | 'B' | 'C';
  skuCount: number;
  /** Participação em número de SKUs, sobre os elegíveis daquela curva (0–100). */
  skuPct: number;
  /** Participação real na métrica, sobre o total dos elegíveis (0–100). */
  metricShare: number;
}

export interface AbcDistribution {
  eligibleCount: number;
  ineligibleCount: number;
  total: number;
  classes: AbcClassStat[];
}

export function buildAbcDistribution(rows: AbcRow[], metric: AbcMetric): AbcDistribution {
  const eligible = rows.filter(r => isEligible(r, metric));
  const total = eligible.reduce((sum, r) => sum + metricValue(r, metric), 0);

  const classes = (['A', 'B', 'C'] as const).map(cls => {
    const items = eligible.filter(r => metricClass(r, metric) === cls);
    const value = items.reduce((sum, r) => sum + metricValue(r, metric), 0);
    return {
      cls,
      skuCount: items.length,
      skuPct: eligible.length > 0 ? (items.length / eligible.length) * 100 : 0,
      metricShare: total > 0 ? (value / total) * 100 : 0,
    };
  });

  return { eligibleCount: eligible.length, ineligibleCount: rows.length - eligible.length, total, classes };
}

export interface ParetoBin {
  index: number;
  skuCount: number;
  value: number;
  /** Participação individual da barra na métrica total (0–100). */
  individualPct: number;
  /** Acumulado ao FIM da barra (0–100) — o mesmo acumulado real, mesmo quando agrupada. */
  cumulativePct: number;
  /** Nome do produto quando a barra é um SKU só; "N SKUs" quando agrupada. */
  label: string;
  /** SKU quando a barra é um SKU só. */
  sublabel: string | null;
  /** Classe quando toda a barra é da mesma classe. */
  cls: string | null;
}

export interface ParetoData {
  bins: ParetoBin[];
  total: number;
  eligibleCount: number;
  /** Barras agrupadas porque o número de SKUs elegíveis passou do limite de renderização. */
  grouped: boolean;
}

/** Pareto real: ordena decrescente pela métrica e devolve barras + acumulado. Com muitos SKUs
 *  as barras são agrupadas para não renderizar milhares de retângulos — o CÁLCULO continua
 *  por SKU, só a apresentação é agregada. */
export function buildPareto(rows: AbcRow[], metric: AbcMetric, maxBins = 60): ParetoData {
  const ranked = rows
    .filter(r => isEligible(r, metric) && metricValue(r, metric) > 0)
    .sort((a, b) => metricValue(b, metric) - metricValue(a, metric));

  const total = ranked.reduce((sum, r) => sum + metricValue(r, metric), 0);
  if (ranked.length === 0 || total <= 0) {
    return { bins: [], total: 0, eligibleCount: ranked.length, grouped: false };
  }

  const binCount = Math.min(maxBins, ranked.length);
  const perBin = ranked.length / binCount;
  const bins: ParetoBin[] = [];
  let cumulative = 0;

  for (let i = 0; i < binCount; i++) {
    const start = Math.floor((i * ranked.length) / binCount);
    const end = i === binCount - 1 ? ranked.length : Math.floor(((i + 1) * ranked.length) / binCount);
    const items = ranked.slice(start, end);
    if (items.length === 0) continue;

    const value = items.reduce((sum, r) => sum + metricValue(r, metric), 0);
    cumulative += value;
    const uniqueClass = items.every(r => metricClass(r, metric) === metricClass(items[0], metric))
      ? metricClass(items[0], metric)
      : null;

    bins.push({
      index: bins.length,
      skuCount: items.length,
      value,
      individualPct: (value / total) * 100,
      cumulativePct: (cumulative / total) * 100,
      label: items.length === 1 ? (items[0].product_name ?? items[0].sku) : `${items.length} SKUs`,
      sublabel: items.length === 1 ? items[0].sku : null,
      cls: uniqueClass,
    });
  }

  return { bins, total, eligibleCount: ranked.length, grouped: perBin > 1 };
}

export interface CurveComparisonRow {
  metric: AbcMetric;
  label: string;
  a: number;
  b: number;
  c: number;
  /** Participação da classe A na métrica (0–100). */
  aShare: number;
  eligible: number;
}

/** Giro × Faturamento × Lucro lado a lado — o mesmo SKU pode ter classe diferente em cada uma. */
export function buildCurveComparison(rows: AbcRow[]): CurveComparisonRow[] {
  return ABC_METRIC_OPTIONS.map(({ value, label }) => {
    const dist = buildAbcDistribution(rows, value);
    const byClass = (cls: 'A' | 'B' | 'C') => dist.classes.find(c => c.cls === cls);
    return {
      metric: value,
      label,
      a: byClass('A')?.skuCount ?? 0,
      b: byClass('B')?.skuCount ?? 0,
      c: byClass('C')?.skuCount ?? 0,
      aShare: byClass('A')?.metricShare ?? 0,
      eligible: dist.eligibleCount,
    };
  });
}

export interface ObservedProfit {
  total: number;
  /** SKUs com lucro calculável (custo cadastrado). */
  coveredSkus: number;
  totalSkus: number;
  coveragePct: number | null;
}

/** Soma só `gross_profit` não-nulo: lucro de SKU sem custo não é zero, é desconhecido — e não
 *  pode ser inventado nem somado como zero sem dizer sobre quantos SKUs a conta foi feita. */
export function observedProfit(rows: AbcRow[]): ObservedProfit {
  const covered = rows.filter(r => r.gross_profit !== null);
  const total = covered.reduce((sum, r) => sum + (r.gross_profit ?? 0), 0);
  return {
    total,
    coveredSkus: covered.length,
    totalSkus: rows.length,
    coveragePct: rows.length > 0 ? (covered.length / rows.length) * 100 : null,
  };
}

export const soldSkuCount = (rows: AbcRow[]): number => rows.filter(r => r.quantity > 0 || r.revenue > 0).length;

export const hasStockData = (rows: AbcRow[]): boolean => rows.some(r => r.stock_available !== null);

export interface GroupAggregate {
  skuCount: number;
  revenue: number;
  /** Lucro observado no grupo (só os SKUs com custo). */
  profit: number;
  profitCoveredSkus: number;
  /** Estoque somado; null quando nenhum SKU do grupo tem snapshot de estoque. */
  stock: number | null;
}

/** Agregados de um grupo da Matriz — sempre e somente sobre os SKUs daquele grupo. Nada de
 *  projeção de impacto: são valores observados na própria análise. */
export function aggregateGroup(rows: AbcRow[]): GroupAggregate {
  const withStock = rows.filter(r => r.stock_available !== null);
  const withProfit = rows.filter(r => r.gross_profit !== null);
  return {
    skuCount: rows.length,
    revenue: rows.reduce((sum, r) => sum + r.revenue, 0),
    profit: withProfit.reduce((sum, r) => sum + (r.gross_profit ?? 0), 0),
    profitCoveredSkus: withProfit.length,
    stock: withStock.length > 0 ? withStock.reduce((sum, r) => sum + (r.stock_available ?? 0), 0) : null,
  };
}

export type ClassFilter = 'all' | 'A' | 'B' | 'C' | 'none';
export type CostFilter = 'all' | 'NORMAL' | 'SEM_CUSTO' | 'PREJUIZO';
export type StockFilter = 'all' | 'with' | 'without' | 'idle';

export interface ProductFilters {
  search: string;
  turnover: ClassFilter;
  revenue: ClassFilter;
  profit: ClassFilter;
  cost: CostFilter;
  recommendation: string;
  stock: StockFilter;
  /** Código de sinal associado (Fase 2); 'all' = sem recorte por sinal. */
  signal: string;
}

export const EMPTY_PRODUCT_FILTERS: ProductFilters = {
  search: '', turnover: 'all', revenue: 'all', profit: 'all', cost: 'all', recommendation: 'all', stock: 'all', signal: 'all',
};

export const hasActiveFilters = (f: ProductFilters): boolean =>
  f.search.trim() !== '' || f.turnover !== 'all' || f.revenue !== 'all' || f.profit !== 'all'
  || f.cost !== 'all' || f.recommendation !== 'all' || f.stock !== 'all' || f.signal !== 'all';

export const CLASS_FILTER_OPTIONS: { value: ClassFilter; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'A', label: 'A' },
  { value: 'B', label: 'B' },
  { value: 'C', label: 'C' },
  { value: 'none', label: 'Sem classe' },
];

const matchesClass = (cls: string | null, filter: ClassFilter): boolean => {
  if (filter === 'all') return true;
  if (filter === 'none') return cls === null;
  return cls === filter;
};

/** Filtragem local sobre os snapshots já carregados — nenhuma consulta por SKU. Devolve nova
 *  lista, nunca reordena nem muta a original (a ordem de faturamento vem do banco). */
export function filterSnapshots<T extends AbcRow>(
  rows: T[],
  filters: ProductFilters,
  recommendationBySku: Map<string, { code: string }>,
): T[] {
  const term = filters.search.trim().toLowerCase();

  return rows.filter(row => {
    if (term !== '') {
      const haystack = `${row.sku} ${row.product_name ?? ''}`.toLowerCase();
      if (!haystack.includes(term)) return false;
    }
    if (!matchesClass(row.turnover_class, filters.turnover)) return false;
    if (!matchesClass(row.revenue_class, filters.revenue)) return false;
    if (!matchesClass(row.profit_class, filters.profit)) return false;
    if (filters.cost !== 'all' && row.cost_state !== filters.cost) return false;
    if (filters.recommendation !== 'all' && recommendationBySku.get(row.sku)?.code !== filters.recommendation) return false;
    // Sinal vem do array gravado no snapshot — snapshot antigo, sem sinais, simplesmente
    // não atende a nenhum recorte por sinal (em vez de aparecer em todos).
    if (filters.signal !== 'all' && !(row.signal_codes ?? []).includes(filters.signal)) return false;

    if (filters.stock !== 'all') {
      // Estoque desconhecido (sem snapshot) nunca é tratado como zero — sai de todos os
      // recortes de estoque em vez de virar "sem estoque".
      if (row.stock_available === null) return false;
      if (filters.stock === 'with' && row.stock_available <= 0) return false;
      if (filters.stock === 'without' && row.stock_available > 0) return false;
      if (filters.stock === 'idle' && !(row.quantity === 0 && row.stock_available > 0)) return false;
    }

    return true;
  });
}
