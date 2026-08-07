// Inventário por Risco — motor de pontuação.
//
// Irmão do CBC (cbcAlgorithm.ts), mas com sentido OPOSTO: aqui nota alta = MAIS risco
// (contar logo), enquanto no CBC nota alta = MAIS confiança (pode esperar). Mantido em
// arquivo/tabelas totalmente separados de propósito, para nunca confundir os dois números.
//
// Função pura, sem I/O — pronta para ser trocada por um modelo de ML no futuro sem tocar
// em schema, UI ou pontos de recálculo. Pesos e limiares são heurísticos e documentados.

import type { RiskBand, CriticalityLevel, ConfidenceFactorBreakdown } from './supabase';

export interface RiskInput {
  /** Total de contagens por SKU já registradas. */
  totalCounts: number;
  /** Dessas, quantas vieram com status != 'correct'. */
  divergentCounts: number;
  /** Nº de eventos de contagem distintos com divergência — reincidência. */
  repeatOffenseCount: number;
  /** Dias desde a última contagem (qualquer status). null = nunca foi contado (risco alto por padrão). */
  daysSinceLastCount: number | null;
  /** Picks/mês no Full Manager — proxy de frequência de movimentação. */
  picksPerMonth: number;
  /** Quantidade média movimentada por mês. */
  quantityMovedPerMonth: number;
  /** Estoque atual — usado tanto como fator direto quanto para calcular giro. */
  currentStockQuantity: number;
  /** Nº de contagens em que o saldo (sistema ou contado) chegou a zero ou negativo — ruptura. */
  stockoutCount: number;
  /** Nº de contagens com diferença != 0 — ajustes aplicados. */
  adjustmentCount: number;
  /** products.price — valor unitário. */
  unitPrice: number;
  /** Override manual de criticidade operacional (bônus aditivo, não é mais um fator ponderado). */
  criticalityLevel: CriticalityLevel;
}

export interface RiskResult {
  riskScore: number;
  riskLevel: RiskBand;
  riskReason: string;
  factors: Record<string, ConfidenceFactorBreakdown>;
}

const WEIGHTS = {
  divergenceHistory: 25,
  recurrence: 12,
  daysSinceLastCount: 12,
  turnover: 10,
  movementFrequency: 10,
  adjustments: 10,
  unitValue: 8,
  stockouts: 8,
  stockQuantity: 5,
} as const;

const CRITICALITY_BONUS: Record<CriticalityLevel, number> = {
  baixa: -15,
  normal: 0,
  alta: 15,
  maxima: 30,
};

const clamp = (n: number, min = 0, max = 100) => Math.max(min, Math.min(max, n));

function divergenceHistoryScore(totalCounts: number, divergentCounts: number): { score: number; detail: string } {
  if (totalCounts === 0) {
    return { score: 50, detail: 'Nenhuma contagem registrada ainda (risco neutro por falta de dado)' };
  }
  const rate = divergentCounts / totalCounts;
  return {
    score: clamp(Math.round(rate * 100)),
    detail: `${divergentCounts} de ${totalCounts} contagem(ns) com divergência (${Math.round(rate * 100)}%)`,
  };
}

function recurrenceScore(repeatOffenseCount: number): { score: number; detail: string } {
  return {
    score: clamp(repeatOffenseCount * 20),
    detail: repeatOffenseCount === 0 ? 'Sem reincidência de erros' : `Divergiu em ${repeatOffenseCount} evento(s) de contagem distintos`,
  };
}

function daysSinceLastCountScore(daysSinceLastCount: number | null): { score: number; detail: string } {
  if (daysSinceLastCount === null) {
    return { score: 80, detail: 'Nunca foi contado' };
  }
  return {
    score: clamp(Math.round(daysSinceLastCount / 2)),
    detail: `${daysSinceLastCount} dia(s) desde a última contagem`,
  };
}

function turnoverScore(quantityMovedPerMonth: number, currentStockQuantity: number): { score: number; detail: string } {
  const turnover = quantityMovedPerMonth / Math.max(currentStockQuantity, 1);
  return {
    score: clamp(Math.round(turnover * 40)),
    detail: `Giro estimado de ${turnover.toFixed(2)}x/mês sobre o estoque atual`,
  };
}

function movementFrequencyScore(picksPerMonth: number): { score: number; detail: string } {
  return {
    score: clamp(Math.round(picksPerMonth * 5)),
    detail: `${picksPerMonth.toFixed(1)} separação(ões) por mês em média`,
  };
}

function adjustmentsScore(adjustmentCount: number): { score: number; detail: string } {
  return {
    score: clamp(adjustmentCount * 15),
    detail: adjustmentCount === 0 ? 'Sem ajustes de saldo registrados' : `${adjustmentCount} contagem(ns) com ajuste de saldo`,
  };
}

function unitValueScore(unitPrice: number): { score: number; detail: string } {
  return {
    score: clamp(Math.round(Math.min(unitPrice, 1000) / 10)),
    detail: `Valor unitário de R$ ${unitPrice.toFixed(2)}`,
  };
}

function stockoutsScore(stockoutCount: number): { score: number; detail: string } {
  return {
    score: clamp(stockoutCount * 25),
    detail: stockoutCount === 0 ? 'Sem rupturas de estoque registradas' : `${stockoutCount} ruptura(s) de estoque registrada(s)`,
  };
}

function stockQuantityScore(currentStockQuantity: number): { score: number; detail: string } {
  return {
    score: clamp(Math.round(Math.min(currentStockQuantity, 2000) / 20)),
    detail: `Estoque atual de ${currentStockQuantity} unidade(s)`,
  };
}

function bandForScore(score: number): RiskBand {
  if (score >= 90) return 'critico';
  if (score >= 70) return 'alto';
  if (score >= 50) return 'medio';
  return 'baixo';
}

export const RISK_BAND_LABEL: Record<RiskBand, string> = {
  critico: 'Crítico',
  alto: 'Alto',
  medio: 'Médio',
  baixo: 'Baixo',
};

export function computeRiskScore(input: RiskInput): RiskResult {
  const parts: Record<string, { score: number; detail: string; weight: number }> = {
    divergenceHistory: { ...divergenceHistoryScore(input.totalCounts, input.divergentCounts), weight: WEIGHTS.divergenceHistory },
    recurrence: { ...recurrenceScore(input.repeatOffenseCount), weight: WEIGHTS.recurrence },
    daysSinceLastCount: { ...daysSinceLastCountScore(input.daysSinceLastCount), weight: WEIGHTS.daysSinceLastCount },
    turnover: { ...turnoverScore(input.quantityMovedPerMonth, input.currentStockQuantity), weight: WEIGHTS.turnover },
    movementFrequency: { ...movementFrequencyScore(input.picksPerMonth), weight: WEIGHTS.movementFrequency },
    adjustments: { ...adjustmentsScore(input.adjustmentCount), weight: WEIGHTS.adjustments },
    unitValue: { ...unitValueScore(input.unitPrice), weight: WEIGHTS.unitValue },
    stockouts: { ...stockoutsScore(input.stockoutCount), weight: WEIGHTS.stockouts },
    stockQuantity: { ...stockQuantityScore(input.currentStockQuantity), weight: WEIGHTS.stockQuantity },
  };

  const weightedBase = Object.values(parts).reduce((sum, p) => sum + (p.score * p.weight) / 100, 0);
  const withCriticality = weightedBase + CRITICALITY_BONUS[input.criticalityLevel];
  const riskScore = clamp(Math.round(withCriticality));
  const riskLevel = bandForScore(riskScore);

  const factors: Record<string, ConfidenceFactorBreakdown> = {};
  for (const [key, p] of Object.entries(parts)) {
    factors[key] = { score: p.score, weight: p.weight, detail: p.detail };
  }
  if (input.criticalityLevel !== 'normal') {
    factors.operationalCriticality = {
      score: clamp(50 + CRITICALITY_BONUS[input.criticalityLevel]),
      weight: 0,
      detail: `Criticidade operacional configurada como "${input.criticalityLevel}" (bônus de ${CRITICALITY_BONUS[input.criticalityLevel] > 0 ? '+' : ''}${CRITICALITY_BONUS[input.criticalityLevel]} pontos)`,
    };
  }

  const topReasons = Object.entries(parts)
    .map(([, p]) => ({ contribution: (p.score * p.weight) / 100, detail: p.detail }))
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 3)
    .filter(r => r.contribution > 2)
    .map(r => r.detail);

  const riskReason = topReasons.length > 0 ? topReasons.join('; ') : 'Nenhum fator de risco relevante identificado';

  return { riskScore, riskLevel, riskReason, factors };
}
