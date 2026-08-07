// Confidence Based Counting (CBC) — motor de pontuação.
//
// Função pura, sem I/O: recebe os dados brutos já coletados (cbcService.ts busca no banco),
// devolve o score final + a faixa de risco + a próxima data de contagem + os motivos.
// Propositalmente isolada nesta assinatura para poder ser substituída por um modelo de
// Machine Learning no futuro sem tocar em schema, UI ou nos pontos de recálculo — só esta
// função mudaria (mesmo formato de entrada/saída).
//
// Todos os pesos e limiares abaixo são heurísticos e documentados — ajustáveis sem mexer
// no resto do módulo.

import type { RiskLevel, ConfidenceFactorBreakdown } from './supabase';

export interface ConfidenceInput {
  /** Total de linhas de contagem por SKU já registradas (inventory_count_import_items). */
  totalCounts: number;
  /** Dessas, quantas vieram com status != 'correct'. */
  divergentCounts: number;
  /** Nº de EVENTOS de contagem distintos (count_record_id) com pelo menos uma divergência deste SKU — reincidência. */
  repeatOffenseCount: number;
  /** Dias desde a última contagem divergente deste SKU. null = nunca teve divergência registrada. */
  daysSinceLastDivergence: number | null;
  /** Dias desde a última contagem (qualquer status) deste SKU. null = nunca foi contado. */
  daysSinceLastCount: number | null;
  /** Média de picks/mês deste SKU no Full Manager (full_operation_items), janela móvel. */
  picksPerMonth: number;
  /** Quantidade média movimentada por mês (SUM(quantity_picked) normalizado). */
  quantityMovedPerMonth: number;
  /** Magnitude média de |diferenca| nas contagens deste SKU — proxy para "ajuste de estoque" (não existe ledger de ajuste manual neste app). */
  avgAdjustmentMagnitude: number;
  /** products.stock_quantity atual — única série de estoque disponível (sem histórico de saldo médio). */
  currentStockQuantity: number;
}

export interface ConfidenceResult {
  confidenceScore: number;
  riskLevel: RiskLevel;
  nextCountDate: string; // ISO date (yyyy-mm-dd)
  factors: Record<string, ConfidenceFactorBreakdown>;
  topReasons: string[];
}

const WEIGHTS = {
  divergenceHistory: 25,
  recurrence: 15,
  timeWithoutDivergence: 15,
  daysSinceLastCount: 15,
  movementFrequency: 10,
  quantityMoved: 10,
  stockAdjustments: 5,
  averageStock: 5,
} as const;

const clamp = (n: number, min = 0, max = 100) => Math.max(min, Math.min(max, n));

function divergenceHistoryScore(totalCounts: number, divergentCounts: number): { score: number; detail: string } {
  if (totalCounts === 0) {
    return { score: 55, detail: 'Nenhuma contagem por SKU registrada ainda (score neutro, priorizando a primeira contagem)' };
  }
  const rate = divergentCounts / totalCounts;
  return {
    score: clamp(Math.round(100 * (1 - rate))),
    detail: `${divergentCounts} de ${totalCounts} contagem(ns) com divergência (${Math.round(rate * 100)}%)`,
  };
}

function recurrenceScore(repeatOffenseCount: number): { score: number; detail: string } {
  return {
    score: clamp(100 - repeatOffenseCount * 20),
    detail: repeatOffenseCount === 0
      ? 'Sem reincidência de erros'
      : `Divergiu em ${repeatOffenseCount} evento(s) de contagem distintos`,
  };
}

function timeWithoutDivergenceScore(daysSinceLastDivergence: number | null): { score: number; detail: string } {
  if (daysSinceLastDivergence === null) {
    return { score: 100, detail: 'Nunca registrou divergência' };
  }
  return {
    score: clamp(Math.round(daysSinceLastDivergence / 2)),
    detail: `${daysSinceLastDivergence} dia(s) sem divergência`,
  };
}

function daysSinceLastCountScore(daysSinceLastCount: number | null): { score: number; detail: string } {
  if (daysSinceLastCount === null) {
    return { score: 30, detail: 'Nunca foi contado' };
  }
  return {
    score: clamp(Math.round(100 - daysSinceLastCount / 2)),
    detail: `${daysSinceLastCount} dia(s) desde a última contagem`,
  };
}

function movementFrequencyScore(picksPerMonth: number): { score: number; detail: string } {
  return {
    score: clamp(Math.round(100 - picksPerMonth * 5)),
    detail: `${picksPerMonth.toFixed(1)} separação(ões) por mês em média`,
  };
}

function quantityMovedScore(quantityMovedPerMonth: number): { score: number; detail: string } {
  return {
    score: clamp(Math.round(100 - quantityMovedPerMonth * 0.5)),
    detail: `${Math.round(quantityMovedPerMonth)} unidade(s) movimentadas por mês em média`,
  };
}

function stockAdjustmentScore(avgAdjustmentMagnitude: number): { score: number; detail: string } {
  return {
    score: clamp(Math.round(100 - avgAdjustmentMagnitude * 3)),
    detail: `Ajuste médio de ${Math.round(avgAdjustmentMagnitude)} unidade(s) por contagem`,
  };
}

// Sinal mais fraco do módulo (peso 5%) — não há série histórica de estoque médio neste app,
// só o saldo atual. Mantido simples de propósito; primeiro candidato a refinar/substituir.
function averageStockScore(currentStockQuantity: number): { score: number; detail: string } {
  if (currentStockQuantity <= 0) {
    return { score: 50, detail: 'Estoque atual zerado' };
  }
  return { score: 70, detail: `Estoque atual de ${currentStockQuantity} unidade(s)` };
}

function bandForScore(score: number): { riskLevel: RiskLevel; nextCountDays: number } {
  if (score >= 95) return { riskLevel: 'excelente', nextCountDays: 180 };
  if (score >= 80) return { riskLevel: 'bom', nextCountDays: 90 };
  if (score >= 60) return { riskLevel: 'medio', nextCountDays: 45 };
  if (score >= 40) return { riskLevel: 'critico', nextCountDays: 15 };
  return { riskLevel: 'critico', nextCountDays: 7 };
}

export function computeConfidenceScore(input: ConfidenceInput): ConfidenceResult {
  const parts: Record<string, { score: number; detail: string; weight: number }> = {
    divergenceHistory: { ...divergenceHistoryScore(input.totalCounts, input.divergentCounts), weight: WEIGHTS.divergenceHistory },
    recurrence: { ...recurrenceScore(input.repeatOffenseCount), weight: WEIGHTS.recurrence },
    timeWithoutDivergence: { ...timeWithoutDivergenceScore(input.daysSinceLastDivergence), weight: WEIGHTS.timeWithoutDivergence },
    daysSinceLastCount: { ...daysSinceLastCountScore(input.daysSinceLastCount), weight: WEIGHTS.daysSinceLastCount },
    movementFrequency: { ...movementFrequencyScore(input.picksPerMonth), weight: WEIGHTS.movementFrequency },
    quantityMoved: { ...quantityMovedScore(input.quantityMovedPerMonth), weight: WEIGHTS.quantityMoved },
    stockAdjustments: { ...stockAdjustmentScore(input.avgAdjustmentMagnitude), weight: WEIGHTS.stockAdjustments },
    averageStock: { ...averageStockScore(input.currentStockQuantity), weight: WEIGHTS.averageStock },
  };

  const weightedSum = Object.values(parts).reduce((sum, p) => sum + (p.score * p.weight) / 100, 0);
  const confidenceScore = clamp(Math.round(weightedSum));
  const { riskLevel, nextCountDays } = bandForScore(confidenceScore);

  const nextCountDate = new Date();
  nextCountDate.setDate(nextCountDate.getDate() + nextCountDays);

  const factors: Record<string, ConfidenceFactorBreakdown> = {};
  for (const [key, p] of Object.entries(parts)) {
    factors[key] = { score: p.score, weight: p.weight, detail: p.detail };
  }

  // "Motivos da nota" — os 3 fatores que mais pesaram contra o score (maior déficit ponderado).
  const topReasons = Object.entries(parts)
    .map(([, p]) => ({ deficit: ((100 - p.score) * p.weight) / 100, detail: p.detail }))
    .sort((a, b) => b.deficit - a.deficit)
    .slice(0, 3)
    .filter(r => r.deficit > 0.5)
    .map(r => r.detail);

  return {
    confidenceScore,
    riskLevel,
    nextCountDate: nextCountDate.toISOString().slice(0, 10),
    factors,
    topReasons: topReasons.length > 0 ? topReasons : ['Nenhum fator de risco relevante identificado'],
  };
}

export const RISK_LEVEL_LABEL: Record<RiskLevel, string> = {
  excelente: 'Excelente',
  bom: 'Bom',
  medio: 'Médio',
  critico: 'Crítico',
};
