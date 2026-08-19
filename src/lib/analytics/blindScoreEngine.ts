// BlindScore — nota única 0-100 de confiabilidade do estoque, só com fatores que os dados do
// workspace realmente sustentam. Mesmo espírito de src/lib/intelligence/healthEngine.ts
// (dedução transparente, explicável, nunca inflada por um fator que não pôde ser avaliado),
// mas lendo contagens/RCA/ABC-XYZ em vez de snapshot ERP — aquele engine é escopado à conexão
// de ERP e não serve de base para este score (ver nota em analyticsContracts.ts).
import type { AnalyticsRawData } from './analyticsDataService';
import {
  computeAccuracyStat, computeDivergenceRateStat, computeAbcXyzRiskStat, computeRecurrenceStat,
} from './analyticsMath';
import {
  FACTOR_LABEL,
  type AnalyticsFactorKey, type AnalyticsDeduction, type BlindScoreResult, type BlindScoreStatus,
} from './analyticsContracts';

/** Teto de dedução por fator. A soma dos tetos passa de 100 de propósito — mesmo padrão do
 *  healthEngine de ERP: um workspace ruim em todos os fatores ao mesmo tempo precisa poder
 *  cair a zero, não ficar artificialmente seguro por causa de um teto compartilhado. */
const MAX_DEDUCTION: Record<AnalyticsFactorKey, number> = {
  accuracy: 35,
  divergence_rate: 20,
  reliability: 15,
  abcxyz_risk: 15,
  recurrence: 15,
};

function statusFromScore(score: number | null): BlindScoreStatus {
  if (score === null) return 'indisponivel';
  if (score >= 90) return 'excelente';
  if (score >= 75) return 'bom';
  if (score >= 50) return 'atencao';
  return 'critico';
}

export function computeBlindScore(raw: AnalyticsRawData): BlindScoreResult {
  const deductions: AnalyticsDeduction[] = [];
  const evaluatedFactors: AnalyticsFactorKey[] = [];
  const skippedFactors: BlindScoreResult['skippedFactors'] = [];

  const accuracyStat = computeAccuracyStat(raw.countRecords);
  if (accuracyStat) {
    evaluatedFactors.push('accuracy');
    const points = Math.min(MAX_DEDUCTION.accuracy, Math.max(0, (100 - accuracyStat.averageAccuracy) * 0.5));
    deductions.push({
      factor: 'accuracy',
      label: FACTOR_LABEL.accuracy,
      points,
      detail: `Acurácia média de ${accuracyStat.averageAccuracy.toFixed(1)}% em ${accuracyStat.sessionsConsidered} sessão(ões) de contagem.`,
    });
  } else {
    skippedFactors.push({ factor: 'accuracy', reason: 'insufficient_data' });
  }

  const divergenceStat = computeDivergenceRateStat(raw.countRecords);
  if (divergenceStat) {
    evaluatedFactors.push('divergence_rate');
    const points = Math.min(MAX_DEDUCTION.divergence_rate, divergenceStat.ratePct * 0.6);
    deductions.push({
      factor: 'divergence_rate',
      label: FACTOR_LABEL.divergence_rate,
      points,
      detail: `${divergenceStat.totalDivergent} divergência(s) real(is) em ${divergenceStat.totalCounted} SKUs contados (${divergenceStat.ratePct.toFixed(1)}%).`,
    });
  } else {
    skippedFactors.push({ factor: 'divergence_rate', reason: 'insufficient_data' });
  }

  if (raw.crossCheckChainCount > 0) {
    evaluatedFactors.push('reliability');
    const points = Math.min(MAX_DEDUCTION.reliability, Math.max(0, (100 - raw.crossCheckSummary.reliabilityIndex) * 0.15));
    deductions.push({
      factor: 'reliability',
      label: FACTOR_LABEL.reliability,
      points,
      detail: `Índice de confiabilidade de reconferência: ${raw.crossCheckSummary.reliabilityIndex.toFixed(0)}/100 (${raw.crossCheckSummary.pctRecontagens.toFixed(0)}% com recontagem, ${raw.crossCheckSummary.pctAprovadas.toFixed(0)}% aprovadas).`,
    });
  } else {
    skippedFactors.push({ factor: 'reliability', reason: 'insufficient_data' });
  }

  const riskStat = computeAbcXyzRiskStat(raw.abcXyzMatrix);
  if (riskStat) {
    evaluatedFactors.push('abcxyz_risk');
    const points = Math.min(MAX_DEDUCTION.abcxyz_risk, riskStat.ratePct * 0.2);
    deductions.push({
      factor: 'abcxyz_risk',
      label: FACTOR_LABEL.abcxyz_risk,
      points,
      detail: `${riskStat.highRiskCount} de ${riskStat.totalClassified} SKUs classificados estão em combinações de prioridade máxima/alta.`,
    });
  } else {
    skippedFactors.push({ factor: 'abcxyz_risk', reason: 'not_configured' });
  }

  const recurrenceStat = computeRecurrenceStat(
    raw.rcaRecords,
    raw.rcaSettings.recurrence_threshold_count,
    raw.rcaSettings.recurrence_window_days
  );
  if (recurrenceStat) {
    evaluatedFactors.push('recurrence');
    const points = Math.min(MAX_DEDUCTION.recurrence, recurrenceStat.ratePct * 0.15);
    deductions.push({
      factor: 'recurrence',
      label: FACTOR_LABEL.recurrence,
      points,
      detail: `${recurrenceStat.recurringSkus} de ${recurrenceStat.distinctSkus} SKUs com divergência já atingiram ${recurrenceStat.thresholdCount}+ ocorrências em ${recurrenceStat.windowDays} dias.`,
    });
  } else {
    skippedFactors.push({ factor: 'recurrence', reason: 'insufficient_data' });
  }

  const score = evaluatedFactors.length === 0
    ? null
    : Math.max(0, Math.round(100 - deductions.reduce((sum, d) => sum + d.points, 0)));

  const positives = [...deductions].filter(d => d.points <= 2).sort((a, b) => a.points - b.points).slice(0, 3);
  const negatives = [...deductions].filter(d => d.points > 2).sort((a, b) => b.points - a.points).slice(0, 3);

  const accuracyTrend = (accuracyStat?.series ?? []).map(p => ({ period: p.period, value: p.value }));

  return { status: statusFromScore(score), score, deductions, evaluatedFactors, skippedFactors, positives, negatives, accuracyTrend };
}
