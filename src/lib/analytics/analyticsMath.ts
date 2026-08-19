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

/** Reincidência real: dentre os SKUs com pelo menos uma divergência classificada (RCA) na
 *  janela carregada, qual fração já bateu o limiar de recorrência configurado pela própria
 *  empresa (rca_settings) — o mesmo limiar que rcaService/checkRecurrence usam, não um novo. */
export function computeRecurrenceStat(
  records: RcaRecord[],
  thresholdCount: number,
  windowDays: number
): RecurrenceStat | null {
  const withSku = records.filter(r => r.sku);
  if (withSku.length === 0) return null;

  const countBySku = new Map<string, number>();
  for (const r of withSku) countBySku.set(r.sku as string, (countBySku.get(r.sku as string) ?? 0) + 1);

  const distinctSkus = countBySku.size;
  const recurringSkus = Array.from(countBySku.values()).filter(c => c >= thresholdCount).length;
  return { distinctSkus, recurringSkus, ratePct: (recurringSkus / distinctSkus) * 100, thresholdCount, windowDays };
}
