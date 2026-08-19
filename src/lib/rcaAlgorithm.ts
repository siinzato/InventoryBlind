// Root Cause Analysis — catálogo de causas e funções puras de agregação.
//
// Sem I/O: recebe listas de RcaRecord já carregadas (pelo serviço) e calcula Pareto,
// recorrência e agrupamentos por dimensão. Mantém o mesmo espírito de riskAlgorithm.ts/
// cbcAlgorithm.ts — pontuação/estatística isolada da camada de acesso a dados.

import type { RcaCauseCategory, RcaRecord } from './domainTypes';

export const CAUSE_CATEGORIES: { value: RcaCauseCategory; label: string }[] = [
  { value: 'recebimento', label: 'Recebimento' },
  { value: 'armazenagem', label: 'Armazenagem' },
  { value: 'picking', label: 'Picking' },
  { value: 'separacao', label: 'Separação' },
  { value: 'expedicao', label: 'Expedição' },
  { value: 'inventario', label: 'Inventário' },
  { value: 'furto_perda', label: 'Furto/Perda' },
  { value: 'avaria', label: 'Avaria' },
  { value: 'cadastro', label: 'Cadastro' },
  { value: 'conversao_unidade', label: 'Conversão de Unidade' },
  { value: 'erro_operacional', label: 'Erro Operacional' },
  { value: 'sistema_integracao', label: 'Sistema/Integração' },
  { value: 'sem_causa_identificada', label: 'Sem Causa Identificada' },
  { value: 'outro', label: 'Outro' },
];

export const CAUSE_LABEL: Record<RcaCauseCategory, string> = CAUSE_CATEGORIES.reduce(
  (acc, c) => ({ ...acc, [c.value]: c.label }),
  {} as Record<RcaCauseCategory, string>
);

export interface ParetoBucket {
  category: RcaCauseCategory;
  count: number;
  pctOfTotal: number;
  cumulativePct: number;
}

/** Pareto 80/20: causas ordenadas por frequência desc, com % acumulado. */
export function computeParetoBuckets(records: RcaRecord[]): ParetoBucket[] {
  const total = records.length;
  if (total === 0) return [];

  const counts = new Map<RcaCauseCategory, number>();
  for (const r of records) counts.set(r.cause_category, (counts.get(r.cause_category) ?? 0) + 1);

  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);

  let cumulative = 0;
  return sorted.map(([category, count]) => {
    const pctOfTotal = (count / total) * 100;
    cumulative += pctOfTotal;
    return { category, count, pctOfTotal, cumulativePct: cumulative };
  });
}

export interface RecurrenceResult {
  skuRecurrence: boolean;
  skuOccurrenceCount: number;
  causeRecurrence: boolean;
  causeOccurrenceCount: number;
}

/**
 * Conta quantas vezes o mesmo SKU (ou a mesma causa) já apareceu em `recentRecords`
 * (já pré-filtrados pela janela de dias pelo chamador) incluindo o próprio `newRecord`,
 * e sinaliza se bateu o limiar configurado. Pura — quem decide o que fazer com o
 * resultado (abrir uma sessão de 5 Porquês) é o serviço.
 */
export function checkRecurrence(
  recentRecords: RcaRecord[],
  newRecord: Pick<RcaRecord, 'sku' | 'cause_category'>,
  thresholdCount: number
): RecurrenceResult {
  const skuOccurrenceCount = newRecord.sku
    ? recentRecords.filter(r => r.sku === newRecord.sku).length
    : 0;
  const causeOccurrenceCount = recentRecords.filter(r => r.cause_category === newRecord.cause_category).length;

  return {
    skuRecurrence: !!newRecord.sku && skuOccurrenceCount >= thresholdCount,
    skuOccurrenceCount,
    causeRecurrence: causeOccurrenceCount >= thresholdCount,
    causeOccurrenceCount,
  };
}

export type RcaDimension = 'operator' | 'location' | 'sku' | 'supplier' | 'period' | 'cause_category';

export interface DimensionBucket {
  key: string;
  label: string;
  count: number;
}

/** Agrupamento genérico usado pelas visões "causas por operador/endereço/SKU/fornecedor/período"
 *  e, para Análise de Tendência (Auditoria de Estoque), também por categoria de causa. */
export function groupByDimension(records: RcaRecord[], dimension: RcaDimension): DimensionBucket[] {
  const keyOf = (r: RcaRecord): { key: string; label: string } => {
    switch (dimension) {
      case 'operator':
        return { key: r.operator_user_id ?? 'sem-operador', label: r.operator_name ?? 'Não informado' };
      case 'location':
        return { key: r.location ?? 'sem-local', label: r.location ?? 'Não informado' };
      case 'sku':
        return { key: r.sku ?? 'sem-sku', label: r.sku ?? 'Não informado' };
      case 'supplier':
        return { key: r.supplier_name ?? 'sem-fornecedor', label: r.supplier_name ?? 'Não informado' };
      case 'period':
        return { key: r.occurred_at.slice(0, 10), label: r.occurred_at.slice(0, 10) };
      case 'cause_category':
        return { key: r.cause_category, label: CAUSE_LABEL[r.cause_category] ?? r.cause_category };
    }
  };

  const buckets = new Map<string, DimensionBucket>();
  for (const r of records) {
    const { key, label } = keyOf(r);
    const existing = buckets.get(key);
    if (existing) existing.count += 1;
    else buckets.set(key, { key, label, count: 1 });
  }

  return Array.from(buckets.values()).sort((a, b) => b.count - a.count);
}

/** Filtro pelo valor de uma dimensão — usado pela Análise de Tendência para isolar os
 *  registros de um bucket específico (ex.: só location === "Rua B") antes de gerar a série
 *  temporal. Mesma lógica de chave de groupByDimension, só que como predicado. */
function matchesDimensionKey(r: RcaRecord, dimension: RcaDimension, key: string): boolean {
  switch (dimension) {
    case 'operator': return (r.operator_user_id ?? 'sem-operador') === key;
    case 'location': return (r.location ?? 'sem-local') === key;
    case 'sku': return (r.sku ?? 'sem-sku') === key;
    case 'supplier': return (r.supplier_name ?? 'sem-fornecedor') === key;
    case 'period': return r.occurred_at.slice(0, 10) === key;
    case 'cause_category': return r.cause_category === key;
  }
}

export interface TrendSeriesPoint {
  period: string;
  count: number;
}

export type TrendDirection = 'crescimento' | 'estabilidade' | 'reducao' | 'alerta_critico';

export interface TrendResult {
  series: TrendSeriesPoint[];
  direction: TrendDirection;
  pctChange: number | null;
  firstHalfCount: number;
  secondHalfCount: number;
  summary: string;
}

const TREND_DIRECTION_LABEL: Record<TrendDirection, string> = {
  crescimento: 'Crescimento',
  estabilidade: 'Estabilidade',
  reducao: 'Redução',
  alerta_critico: 'Alerta crítico',
};

/**
 * Série mensal de ocorrências para um valor de dimensão (ex.: location="Rua B"), mais a
 * classificação de tendência: compara a primeira metade da janela contra a segunda metade
 * (não mês-a-mês, para não depender de meses cheios) e classifica por variação percentual.
 * >=50% de aumento com volume relevante (>=5 no período recente) vira "alerta_critico" —
 * o mesmo padrão de frase do exemplo do pedido ("Rua B teve aumento de 32%...").
 */
export function computeTrend(records: RcaRecord[], dimension: RcaDimension, key: string, label: string): TrendResult {
  const filtered = records
    .filter(r => matchesDimensionKey(r, dimension, key))
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));

  const byMonth = new Map<string, number>();
  for (const r of filtered) {
    const month = r.occurred_at.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + 1);
  }
  const series = Array.from(byMonth.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([period, count]) => ({ period, count }));

  if (filtered.length === 0) {
    return { series, direction: 'estabilidade', pctChange: null, firstHalfCount: 0, secondHalfCount: 0, summary: `Sem registros de divergência para ${label} no período.` };
  }

  const mid = Math.floor(filtered.length / 2);
  const firstHalfCount = mid;
  const secondHalfCount = filtered.length - mid;
  const pctChange = firstHalfCount > 0 ? ((secondHalfCount - firstHalfCount) / firstHalfCount) * 100 : null;

  let direction: TrendDirection = 'estabilidade';
  if (pctChange !== null) {
    if (pctChange >= 50 && secondHalfCount >= 5) direction = 'alerta_critico';
    else if (pctChange >= 15) direction = 'crescimento';
    else if (pctChange <= -15) direction = 'reducao';
  }

  const pctLabel = pctChange !== null ? `${pctChange >= 0 ? 'aumento' : 'redução'} de ${Math.abs(pctChange).toFixed(0)}%` : 'volume estável';
  const summary = pctChange !== null
    ? `${label} apresentou ${pctLabel} nas divergências (${firstHalfCount} → ${secondHalfCount} ocorrências) — ${TREND_DIRECTION_LABEL[direction].toLowerCase()}.`
    : `${label} tem ${filtered.length} divergência(s) registrada(s), volume insuficiente para comparar tendência.`;

  return { series, direction, pctChange, firstHalfCount, secondHalfCount, summary };
}

/** "Setor Full concentra 42% das divergências" — maior bucket de uma dimensão como % do total. */
export function topConcentration(records: RcaRecord[], dimension: RcaDimension): { label: string; pct: number } | null {
  if (records.length === 0) return null;
  const buckets = groupByDimension(records, dimension);
  if (buckets.length === 0) return null;
  const top = buckets[0];
  return { label: top.label, pct: (top.count / records.length) * 100 };
}
