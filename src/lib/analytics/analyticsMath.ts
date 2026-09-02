// Analytics — funções puras compartilhadas entre BlindScore e Inventory Health. Cada uma
// retorna `null` quando não há dado suficiente para uma leitura honesta (nunca uma média
// sobre zero registros disfarçada de zero). Sem I/O — recebem o que analyticsDataService.ts
// já carregou, mesmo espírito de rcaAlgorithm.ts.
import type { InventoryCountRecord } from '../supabase';
import type { RcaRecord, AbcXyzCombo } from '../domainTypes';
import { ABC_XYZ_STRATEGIES } from '../abcXyzStrategies';

export interface AccuracyStat {
  sessionsConsidered: number;
  averageAccuracy: number;
  /** Uma sessão por ponto, ordenada por data — a única série real disponível para "evolução". */
  series: { period: string; value: number }[];
}

/** Acurácia real por sessão de contagem — usa accuracy_final quando existe (já reconferida),
 *  senão accuracy_initial. Sessões sem nenhum dos dois ficam de fora, nunca viram um 0. */
export function computeAccuracyStat(records: InventoryCountRecord[]): AccuracyStat | null {
  const withAccuracy = records
    .map(r => ({ record: r, accuracy: r.accuracy_final ?? r.accuracy_initial }))
    .filter((r): r is { record: InventoryCountRecord; accuracy: number } => r.accuracy !== null && r.accuracy !== undefined)
    .sort((a, b) => a.record.created_at.localeCompare(b.record.created_at));

  if (withAccuracy.length === 0) return null;

  const series = withAccuracy.map(r => ({ period: r.record.created_at, value: r.accuracy }));
  const averageAccuracy = series.reduce((sum, p) => sum + p.value, 0) / series.length;
  return { sessionsConsidered: series.length, averageAccuracy, series };
}

export interface DivergenceRateStat {
  totalCounted: number;
  totalDivergent: number;
  ratePct: number;
}

/** Taxa real de divergências: soma de divergencias_reais / soma de skus_contados entre todas
 *  as sessões — não a média das taxas por sessão, que daria peso desproporcional a sessões
 *  pequenas. */
export function computeDivergenceRateStat(records: InventoryCountRecord[]): DivergenceRateStat | null {
  const totalCounted = records.reduce((sum, r) => sum + (r.skus_contados ?? 0), 0);
  if (totalCounted === 0) return null;
  const totalDivergent = records.reduce((sum, r) => sum + (r.divergencias_reais ?? 0), 0);
  return { totalCounted, totalDivergent, ratePct: (totalDivergent / totalCounted) * 100 };
}

export interface AbcXyzRiskStat {
  totalClassified: number;
  highRiskCount: number;
  ratePct: number;
  /** Combinações com prioridade máxima/alta, para o drill-down. */
  highRiskCombos: AbcXyzCombo[];
}

/** SKU "de risco" = combinação ABC/XYZ cuja prioridade operacional já cadastrada em
 *  abcXyzStrategies.ts é 'maxima' ou 'alta' — reaproveita a classificação de prioridade que
 *  o módulo ABC/XYZ já define, não inventa um limiar novo. */
export function computeAbcXyzRiskStat(matrix: Record<AbcXyzCombo, { count: number; value: number }>): AbcXyzRiskStat | null {
  const combos = Object.keys(matrix) as AbcXyzCombo[];
  const totalClassified = combos.reduce((sum, c) => sum + matrix[c].count, 0);
  if (totalClassified === 0) return null;

  const highRiskCombos = combos.filter(c => {
    const priority = ABC_XYZ_STRATEGIES[c].priority;
    return priority === 'maxima' || priority === 'alta';
  });
  const highRiskCount = highRiskCombos.reduce((sum, c) => sum + matrix[c].count, 0);
  return { totalClassified, highRiskCount, ratePct: (highRiskCount / totalClassified) * 100, highRiskCombos };
}

export interface RecurrenceStat {
  distinctSkus: number;
  recurringSkus: number;
  ratePct: number;
  thresholdCount: number;
  windowDays: number;
}

/** Reincidência real: dentre os SKUs com pelo menos uma divergência classificada (RCA)
 *  OCORRIDA dentro da janela configurada pela própria empresa (rca_settings), qual fração já
 *  bateu o limiar de recorrência — o mesmo limiar e o mesmo recorte de janela que
 *  rcaService.checkRecurrence usa (occurred_at >= hoje - recurrence_window_days), não um novo.
 *
 *  Bug real corrigido aqui: os `records` recebidos já vêm de uma janela de busca maior
 *  (analyticsDataService fixa 180 dias como buffer), mas antes dessa correção o `windowDays`
 *  configurado só era devolvido para exibição — nunca aplicado como recorte real sobre
 *  `records`. Um registro fora da janela configurada contava como reincidência mesmo assim. */
export function computeRecurrenceStat(
  records: RcaRecord[],
  thresholdCount: number,
  windowDays: number,
  now: number = Date.now()
): RecurrenceStat | null {
  const since = now - windowDays * 86400000;
  const withSku = records.filter(r => r.sku && new Date(r.occurred_at).getTime() >= since);
  if (withSku.length === 0) return null;

  const countBySku = new Map<string, number>();
  for (const r of withSku) countBySku.set(r.sku as string, (countBySku.get(r.sku as string) ?? 0) + 1);

  const distinctSkus = countBySku.size;
  const recurringSkus = Array.from(countBySku.values()).filter(c => c >= thresholdCount).length;
  return { distinctSkus, recurringSkus, ratePct: (recurringSkus / distinctSkus) * 100, thresholdCount, windowDays };
}

export interface PillarAverages {
  accuracyHistory: number;
  recency: number;
  stability: number;
  integrity: number;
  /** Produtos que realmente entraram na média (não o total lido). */
  sampleSize: number;
}

const PILLAR_KEYS = ['accuracyHistory', 'recency', 'stability', 'integrity'] as const;

/** Um fator de product_confidence_scores.factors. `max` é o que o CBC atual grava; `weight`
 *  existe desde a primeira versão e, no CBC atual, é sempre igual a `max` — por isso serve de
 *  fallback sem inventar um teto novo. */
export type PillarFactorRow = Record<string, { score: number; max?: number; weight?: number } | undefined>;

function usableMax(factor: { score: number; max?: number; weight?: number } | undefined): number | null {
  if (!factor) return null;
  const max = factor.max ?? factor.weight;
  return typeof max === 'number' && max > 0 ? max : null;
}

/** Uma linha só entra nos pilares se tiver pelo menos um dos 4 fatores do CBC ATUAL. Linhas
 *  gravadas pela versão anterior do algoritmo (8 fatores: divergenceHistory, daysSinceLastCount,
 *  movementFrequency, ...) não são convertíveis nestes 4 — elas precisam ser recalculadas pelo
 *  CBC, e tratá-las como base dos pilares seria mostrar um agregado que não corresponde à
 *  composição atual da confiança. */
export function isPillarEligible(row: PillarFactorRow): boolean {
  return PILLAR_KEYS.some(key => usableMax(row[key]) !== null);
}

export function pillarEligibleCount(factorRows: PillarFactorRow[]): number {
  return factorRows.filter(isPillarEligible).length;
}

/** Média normalizada (0-100) de cada um dos 4 pilares que cbcAlgorithm.ts já calcula por SKU
 *  (accuracyHistory/recency/stability/integrity), agregada por workspace — nenhuma fórmula de
 *  confiança nova, só a agregação dos fatores que o CBC já persiste em
 *  product_confidence_scores.factors para os SKUs com has_sufficient_data = true. null quando
 *  nenhuma linha lida tem os fatores da versão atual (nunca uma média fabricada). */
export function computePillarAverages(factorRows: PillarFactorRow[]): PillarAverages | null {
  const eligible = factorRows.filter(isPillarEligible);
  if (eligible.length === 0) return null;

  const sums: Record<(typeof PILLAR_KEYS)[number], number> = { accuracyHistory: 0, recency: 0, stability: 0, integrity: 0 };
  const counts: Record<(typeof PILLAR_KEYS)[number], number> = { accuracyHistory: 0, recency: 0, stability: 0, integrity: 0 };

  for (const row of eligible) {
    for (const key of PILLAR_KEYS) {
      const factor = row[key];
      const max = usableMax(factor);
      if (!factor || max === null) continue;
      sums[key] += (factor.score / max) * 100;
      counts[key] += 1;
    }
  }

  return {
    accuracyHistory: counts.accuracyHistory > 0 ? Math.round(sums.accuracyHistory / counts.accuracyHistory) : 0,
    recency: counts.recency > 0 ? Math.round(sums.recency / counts.recency) : 0,
    stability: counts.stability > 0 ? Math.round(sums.stability / counts.stability) : 0,
    integrity: counts.integrity > 0 ? Math.round(sums.integrity / counts.integrity) : 0,
    sampleSize: eligible.length,
  };
}
