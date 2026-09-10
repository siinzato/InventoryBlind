// Curva ABC — comparativo com a Curva ABC do Tiny anexada à análise. A referência do Tiny é
// UMA classificação; o InventoryBlind calcula três. Este módulo compara com a curva de
// FATURAMENTO, que é a equivalência defensável quando o arquivo traz valor/percentuais — e
// quando não traz, o texto para de afirmar equivalência em vez de inventá-la.
//
// Divergência aqui NÃO é erro de ninguém: período, base de cálculo e critério podem diferir.
// O vocabulário do módulo é "coincidente / diferente / sem correspondência", nunca
// "correto / errado".

/** Snapshot com os campos do Tiny (migration 109). Estruturalmente satisfeito por SkuSnapshotRow. */
export interface TinyAwareRow {
  sku: string;
  product_name: string | null;
  revenue: number;
  revenue_class: string | null;
  // Opcionais: snapshot gravado antes da migration 109 simplesmente não tem esses campos, e
  // a leitura precisa tratar ausente e nulo do mesmo jeito (sem dado do Tiny).
  tiny_quantity?: number | null;
  tiny_value?: number | null;
  tiny_individual_pct?: number | null;
  tiny_cumulative_pct?: number | null;
  tiny_classification?: string | null;
}

export type TinySituation = 'match' | 'different' | 'unmatched';

export const TINY_SITUATION_LABEL: Record<TinySituation, string> = {
  match: 'Coincidente',
  different: 'Diferente',
  unmatched: 'Sem correspondência',
};

export interface TinyComparisonRow {
  sku: string;
  productName: string | null;
  tinyClass: string | null;
  ibClass: string | null;
  tinyValue: number | null;
  ibRevenue: number;
  situation: TinySituation;
}

/** Qualquer sinal de que o arquivo do Tiny cobriu este SKU. */
const hasAnyTinyData = (r: TinyAwareRow): boolean =>
  r.tiny_classification != null || r.tiny_value != null || r.tiny_quantity != null;

/** Normaliza só o que é seguro normalizar: espaços e caixa. "a" e "A" são a mesma classe;
 *  qualquer outro rótulo é preservado como veio, para não fingir que entendemos o arquivo. */
export const normalizeTinyClass = (value: string | null | undefined): string | null => {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed.toUpperCase();
};

/** A análise só tem comparativo quando algum SKU realmente recebeu dado do Tiny. Arquivo
 *  anexado sem nenhuma correspondência não gera aba. */
export const hasTinyReference = (rows: TinyAwareRow[]): boolean =>
  rows.some(hasAnyTinyData);

/** A referência é baseada em valor quando o arquivo trouxe valor ou percentuais — só nesse
 *  caso a comparação com o ABC de faturamento tem base declarada. */
export const tinyBasisIsValue = (rows: TinyAwareRow[]): boolean =>
  rows.some(r => r.tiny_value != null || r.tiny_cumulative_pct != null || r.tiny_individual_pct != null);

export interface TinySummary {
  /** SKUs com classe nas duas pontas — a base em que "coincidente/diferente" faz sentido. */
  comparable: number;
  sameClass: number;
  differentClass: number;
  /** SKUs desta análise que o arquivo do Tiny não cobriu. */
  unmatched: number;
  /** SKUs desta análise que receberam qualquer dado do Tiny. */
  withTinyData: number;
}

export function buildTinyComparison(rows: TinyAwareRow[]): { rows: TinyComparisonRow[]; summary: TinySummary } {
  const comparison: TinyComparisonRow[] = rows.map(r => {
    const tinyClass = normalizeTinyClass(r.tiny_classification);
    const ibClass = normalizeTinyClass(r.revenue_class);
    const hasTiny = hasAnyTinyData(r);

    let situation: TinySituation;
    if (!hasTiny || tinyClass === null || ibClass === null) situation = 'unmatched';
    else situation = tinyClass === ibClass ? 'match' : 'different';

    return {
      sku: r.sku,
      productName: r.product_name,
      tinyClass,
      ibClass,
      tinyValue: r.tiny_value ?? null,
      ibRevenue: r.revenue,
      situation,
    };
  });

  const summary: TinySummary = {
    comparable: comparison.filter(r => r.situation !== 'unmatched').length,
    sameClass: comparison.filter(r => r.situation === 'match').length,
    differentClass: comparison.filter(r => r.situation === 'different').length,
    unmatched: comparison.filter(r => r.situation === 'unmatched').length,
    withTinyData: rows.filter(hasAnyTinyData).length,
  };

  return { rows: comparison, summary };
}

export type TinySituationFilter = 'all' | TinySituation;

export const TINY_FILTER_OPTIONS: { value: TinySituationFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'match', label: 'Coincidentes' },
  { value: 'different', label: 'Diferentes' },
  { value: 'unmatched', label: 'Sem correspondência' },
];

/** Filtragem local sobre as linhas já montadas — nova lista, nunca mutação. */
export function filterTinyRows(
  rows: TinyComparisonRow[],
  filters: { search: string; situation: TinySituationFilter },
): TinyComparisonRow[] {
  const term = filters.search.trim().toLowerCase();
  return rows.filter(row => {
    if (filters.situation !== 'all' && row.situation !== filters.situation) return false;
    if (term === '') return true;
    return `${row.sku} ${row.productName ?? ''}`.toLowerCase().includes(term);
  });
}

/** Dados do Tiny por SKU, prontos para colar no snapshot na publicação. */
export interface TinyFileValues {
  quantity: number | null;
  value: number | null;
  individualPct: number | null;
  cumulativePct: number | null;
  classification: string | null;
}
