// BlindScore V2.1 — confiança consolidada do estoque do workspace. A nota principal vem direto
// da inteligência de confiança por SKU que o CBC já mantém (cbc_company_summary_v.avg_confidence,
// que já é a média de confidence_score entre os SKUs com has_sufficient_data = true) — nada aqui
// recalcula ou duplica a fórmula de cbcAlgorithm.ts. Este engine só compõe: cobertura real do
// catálogo, qualidade do processo de validação (auditCrossCheckAlgorithm.ts), pilares agregados
// do próprio CBC, os fatores reais que reduzem a confiança e as ações determinísticas para
// aumentá-la — sem somar divergência + acuracidade de novo (o CBC já incorpora isso) e sem deixar
// ABC/XYZ derrubar a nota (é exposição operacional, não prova de saldo incorreto).
import type { AnalyticsRawData } from './analyticsDataService';
import {
  computeAccuracyStat, computeAbcXyzRiskStat, computeRecurrenceStat,
  computePillarAverages, pillarEligibleCount,
} from './analyticsMath';
import type {
  BlindScoreResult, BlindScoreStatus, EvidenceLevel, ValidationQuality,
  PillarScore, PillarsUnavailableReason, Recommendation, RiskFactorItem,
} from './analyticsContracts';

const PILLAR_LABEL: Record<PillarScore['key'], string> = {
  accuracyHistory: 'Histórico de acuracidade',
  recency: 'Recência das contagens',
  stability: 'Estabilidade operacional',
  integrity: 'Integridade dos dados',
};

/** Leitura curta por pilar — determinística, derivada da faixa do próprio valor agregado. */
const PILLAR_READING: Record<PillarScore['key'], (value: number) => string> = {
  accuracyHistory: v => v >= 80 ? 'Boa consistência nas contagens avaliadas.'
    : v >= 50 ? 'Consistência irregular entre as contagens avaliadas.'
    : 'Divergências frequentes nas contagens avaliadas.',
  recency: v => v >= 80 ? 'Contagens recentes na base avaliada.'
    : v >= 50 ? 'Parte da base avaliada está próxima do vencimento.'
    : 'Boa parte da base avaliada está com contagem envelhecida.',
  stability: v => v >= 80 ? 'Sem eventos relevantes de instabilidade.'
    : v >= 50 ? 'Divergências reincidentes em parte dos produtos.'
    : 'Instabilidade recorrente na base avaliada.',
  integrity: v => v >= 80 ? 'Poucas falhas cadastrais relevantes.'
    : v >= 50 ? 'Falhas cadastrais em parte dos produtos avaliados.'
    : 'Falhas cadastrais frequentes na base avaliada.',
};

/** Cortes de apresentação da confiança DA LEITURA (§2) — quanto do catálogo sustenta a nota,
 *  não um julgamento sobre o estoque em si. */
function evidenceFromCoverage(pct: number): EvidenceLevel {
  if (pct >= 80) return 'alta';
  if (pct >= 40) return 'moderada';
  return 'baixa';
}

/** Cobertura < 40% nunca vira uma classificação definitiva (Excelente/Bom/...) — vira
 *  "Leitura provisória" mesmo quando o score entre os produtos avaliados é alto. */
function statusFromScore(score: number | null, coveragePct: number): BlindScoreStatus {
  if (score === null) return 'indisponivel';
  if (coveragePct < 40) return 'provisorio';
  if (score >= 90) return 'excelente';
  if (score >= 75) return 'bom';
  if (score >= 50) return 'atencao';
  return 'critico';
}

/** Só classifica quando existe amostra real de reconferência. Sem nenhuma cadeia recontada, o
 *  reliabilityIndex cai por AUSÊNCIA de amostra, não por processo ruim — chamar isso de "Baixa"
 *  transformaria falta de dado em nota negativa. */
function validationQualityFrom(sampleChains: number, reliabilityIndex: number): ValidationQuality {
  if (sampleChains === 0) return 'nao_avaliada';
  if (reliabilityIndex >= 70) return 'alta';
  if (reliabilityIndex >= 40) return 'moderada';
  return 'baixa';
}

function buildSummary(status: BlindScoreStatus, score: number | null): string {
  if (status === 'indisponivel') {
    return 'É necessário pelo menos um produto com histórico de contagem suficiente para estimar a confiança do estoque.';
  }
  if (status === 'provisorio') {
    const nivel = score !== null && score >= 75 ? 'alta' : score !== null && score >= 50 ? 'moderada' : 'baixa';
    return `Confiança ${nivel} entre os produtos avaliados, mas a cobertura ainda é insuficiente para representar o catálogo completo.`;
  }
  const byStatus: Record<'excelente' | 'bom' | 'atencao' | 'critico', string> = {
    excelente: 'Seu estoque apresenta confiabilidade muito alta com base nas contagens disponíveis.',
    bom: 'Seu estoque apresenta boa confiabilidade com base nas contagens disponíveis.',
    atencao: 'A confiabilidade do estoque requer atenção com base nas contagens disponíveis.',
    critico: 'A confiabilidade do estoque está crítica com base nas contagens disponíveis.',
  };
  return byStatus[status as 'excelente' | 'bom' | 'atencao' | 'critico'];
}

export function computeBlindScore(raw: AnalyticsRawData): BlindScoreResult {
  const avgConfidence = raw.cbcSummary?.avg_confidence ?? null;
  const score = avgConfidence !== null ? Math.round(avgConfidence) : null;

  const evaluated = raw.cbcSummary ? Math.max(0, raw.cbcSummary.total_scored - raw.cbcSummary.insufficient_count) : 0;
  const totalCatalog = raw.catalogTotal;
  const coveragePct = totalCatalog > 0 ? (evaluated / totalCatalog) * 100 : 0;
  const coverageGap = Math.max(0, totalCatalog - evaluated);

  const status = statusFromScore(score, coveragePct);
  const summary = buildSummary(status, score);

  const sampleChains = raw.crossCheckSummary.chainsWithRecount;
  const validationQuality = validationQualityFrom(sampleChains, raw.crossCheckSummary.reliabilityIndex);

  // Pilares: só os produtos cujos `factors` são da versão ATUAL do CBC entram na média. Quando
  // existem produtos avaliados mas nenhum deles tem os 4 fatores atuais, a causa é defasagem de
  // recálculo — estado diferente de "não há produtos avaliados", e é isso que a página informa.
  const pillarAverages = computePillarAverages(raw.pillarFactorRows);
  const pillarsBase = pillarEligibleCount(raw.pillarFactorRows);
  const pillars: PillarScore[] = pillarAverages
    ? (Object.keys(PILLAR_LABEL) as PillarScore['key'][]).map(key => ({
        key,
        label: PILLAR_LABEL[key],
        value: pillarAverages[key],
        reading: PILLAR_READING[key](pillarAverages[key]),
      }))
    : [];
  const pillarsUnavailable: PillarsUnavailableReason | null = pillarAverages
    ? null
    : evaluated > 0 ? 'stale_algorithm' : 'no_evaluated_products';
  const staleEvaluation = evaluated > 0 && pillarsBase === 0;

  const reducingFactors: RiskFactorItem[] = [];
  if (raw.cbcSummary) {
    if (raw.cbcSummary.critico_count > 0) {
      reducingFactors.push({
        key: 'cbc_critico',
        label: 'Produtos com confiança crítica',
        detail: 'Confiança abaixo de 40/100 no Confidence Score.',
        count: raw.cbcSummary.critico_count,
        unit: 'produtos',
        severity: 'alta',
        navigateTo: 'cbc',
        actionLabel: 'Abrir Confidence Score',
      });
    }
    // Só o recorte que NÃO é o mesmo conjunto de "sem evidência suficiente" (ver
    // overdueWithSufficientData em analyticsDataService): produtos sem evidência já vencem por
    // construção, e listá-los duas vezes descreveria o mesmo problema em dois itens.
    if (raw.overdueWithSufficientData > 0) {
      reducingFactors.push({
        key: 'cbc_overdue',
        label: 'Contagens vencidas',
        detail: 'O histórico de contagem desses produtos está fora da janela de confiança.',
        count: raw.overdueWithSufficientData,
        unit: 'produtos',
        severity: 'media',
        navigateTo: 'cbc',
        actionLabel: 'Abrir Confidence Score',
      });
    }
    if (raw.cbcSummary.insufficient_count > 0) {
      reducingFactors.push({
        key: 'cbc_insufficient',
        label: 'Produtos sem evidência suficiente',
        detail: 'Esses produtos ainda não possuem histórico suficiente para uma leitura confiável.',
        count: raw.cbcSummary.insufficient_count,
        unit: 'produtos',
        severity: 'media',
        navigateTo: 'cbc',
        actionLabel: 'Abrir Confidence Score',
      });
    }
  }

  // Reincidência entra como fator explicativo/contextual — nunca uma segunda dedução: o CBC já
  // incorpora instabilidade/divergências recorrentes na própria confiança por SKU.
  const recurrenceStat = computeRecurrenceStat(
    raw.rcaRecords,
    raw.rcaSettings.recurrence_threshold_count,
    raw.rcaSettings.recurrence_window_days
  );
  if (recurrenceStat && recurrenceStat.recurringSkus > 0) {
    reducingFactors.push({
      key: 'rca_recurrence',
      label: 'SKUs com divergência reincidente',
      detail: `Ocorrências nos últimos ${recurrenceStat.windowDays} dias.`,
      count: recurrenceStat.recurringSkus,
      unit: 'SKUs',
      severity: 'alta',
      navigateTo: 'rca',
      actionLabel: 'Investigar RCA',
    });
  }

  const pendingApproval = raw.crossCheckChains.filter(c => c.hasRecount && !c.isApproved).length;
  if (pendingApproval > 0) {
    reducingFactors.push({
      key: 'audit_pending',
      label: 'Contagens aguardando validação',
      detail: 'Reconferências pendentes de aprovação.',
      count: pendingApproval,
      unit: 'contagens',
      severity: 'baixa',
      navigateTo: 'audit',
      actionLabel: 'Abrir Auditoria',
    });
  }

  reducingFactors.sort((a, b) => b.count - a.count);

  const recommendations: Recommendation[] = [];
  if (coverageGap > 0) {
    recommendations.push({
      key: 'expand_coverage',
      title: 'Amplie a cobertura da análise',
      detail: `${coverageGap.toLocaleString('pt-BR')} produtos ainda não possuem evidência suficiente para entrar na leitura.`,
      navigateTo: 'cbc',
      actionLabel: 'Abrir Confidence Score',
    });
  }
  if (staleEvaluation) {
    recommendations.push({
      key: 'recalculate_confidence',
      title: 'Recalcule o Confidence Score',
      detail: `Os ${evaluated.toLocaleString('pt-BR')} produtos avaliados foram pontuados por uma versão anterior do cálculo e precisam ser recalculados.`,
      navigateTo: 'cbc',
      actionLabel: 'Abrir Confidence Score',
    });
  }
  if (raw.overdueWithSufficientData > 0) {
    recommendations.push({
      key: 'update_overdue',
      title: 'Atualize as contagens vencidas',
      detail: `${raw.overdueWithSufficientData.toLocaleString('pt-BR')} produtos estão fora da janela de confiança.`,
      navigateTo: 'cbc',
      actionLabel: 'Abrir Confidence Score',
    });
  }
  if ((raw.cbcSummary?.critico_count ?? 0) > 0) {
    recommendations.push({
      key: 'review_critical',
      title: 'Revise os produtos com confiança crítica',
      detail: `${(raw.cbcSummary?.critico_count ?? 0).toLocaleString('pt-BR')} produtos estão na faixa crítica do Confidence Score.`,
      navigateTo: 'cbc',
      actionLabel: 'Abrir Confidence Score',
    });
  }
  if (recurrenceStat && recurrenceStat.recurringSkus > 0) {
    recommendations.push({
      key: 'investigate_recurrence',
      title: 'Investigue as divergências reincidentes',
      detail: `${recurrenceStat.recurringSkus} SKUs bateram o limiar de reincidência nos últimos ${recurrenceStat.windowDays} dias.`,
      navigateTo: 'rca',
      actionLabel: 'Investigar RCA',
    });
  }
  if (sampleChains === 0 && raw.crossCheckChainCount > 0) {
    recommendations.push({
      key: 'run_recounts',
      title: 'Execute reconferências independentes',
      detail: `Nenhuma das ${raw.crossCheckChainCount} contagens registradas tem recontagem, então a qualidade da validação não pode ser avaliada.`,
      navigateTo: 'audit',
      actionLabel: 'Abrir Auditoria',
    });
  }

  // ABC/XYZ fica só como exposição operacional — nunca reduz a nota.
  const riskStat = computeAbcXyzRiskStat(raw.abcXyzMatrix);

  const accuracyStat = computeAccuracyStat(raw.countRecords);
  const accuracyTrend = (accuracyStat?.series ?? []).map(p => ({ period: p.period, value: p.value }));

  return {
    score,
    status,
    summary,
    coverage: { evaluated, totalCatalog, gap: coverageGap, pct: coveragePct, evidence: evidenceFromCoverage(coveragePct) },
    validation: {
      quality: validationQuality,
      totalChains: raw.crossCheckChainCount,
      sampleChains,
      pctRecontagens: raw.crossCheckSummary.pctRecontagens,
      pctIndependentes: raw.crossCheckSummary.pctAuditoriasIndependentes,
      pctAprovadas: raw.crossCheckSummary.pctAprovadas,
    },
    pillars,
    pillarsBase,
    pillarsUnavailable,
    staleEvaluation,
    reducingFactors: reducingFactors.slice(0, 6),
    recommendations: recommendations.slice(0, 5),
    abcXyzExposure: riskStat ? { highRiskCount: riskStat.highRiskCount, totalClassified: riskStat.totalClassified } : null,
    accuracyTrend,
    lastRecalculatedAt: raw.cbcLastRecalculatedAt,
  };
}
