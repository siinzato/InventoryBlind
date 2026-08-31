// Inventário por Risco — motor de pontuação.
//
// Responde "onde uma falha de estoque tem maior PROBABILIDADE de ocorrer e maior
// IMPACTO operacional?" — pergunta diferente do CBC (que mede confiança no saldo).
// Por isso o modelo aqui é Probabilidade × Impacto / 100, com os dois números
// guardados separadamente (nunca só o produto final), para a interface poder
// explicar o cálculo.
//
// Causa raiz do "22-24 repetido" (achada por leitura de código, sem alterar dados):
// a versão anterior tratava "nunca contado" como um valor NEUTRO (score 50 em
// divergência, 80 em recência) em vez de "não sei". Somando esses neutros aos pesos
// antigos, mais um valor unitário/estoque tipicamente baixo, o resultado convergia
// sempre para a faixa 22-24 — o caso mais comum numa base recém-importada. Esta
// reescrita substitui isso por um estado explícito `hasSufficientData: false`
// (riskScore/riskLevel/probability = null) quando o SKU-local nunca foi contado,
// em vez de inventar uma probabilidade.
//
// `RiskBand` (critico/alto/medio/baixo) continua com as MESMAS 4 chaves de antes —
// tipo compartilhado com src/components/slotting/LiveWarehouseMap.tsx (cor de
// saúde no Digital Twin do Armazém), fora do escopo desta tarefa. Só os CORTES de
// pontuação e o RÓTULO de "medio" (agora exibido como "Moderado") mudaram.
//
// Função pura, sem I/O — riskService.ts busca os dados e persiste o resultado.

import type { RiskBand, CriticalityLevel, ConfidenceFactorBreakdown } from './supabase';

export type AbcClass = 'A' | 'B' | 'C' | null;

export interface ProbabilityInput {
  /** Total de contagens já registradas para este SKU-local. 0 = nunca contado. */
  totalCounts: number;
  /** Dessas, quantas vieram com status != 'correct'. */
  divergentCounts: number;
  /** Nº de eventos de contagem distintos com divergência — reincidência. */
  repeatOffenseCount: number;
  /** Dias desde a última contagem. null quando totalCounts é 0. */
  daysSinceLastCount: number | null;
  /** Nº de contagens em que o saldo (sistema ou contado) chegou a zero ou negativo — ruptura. */
  stockoutCount: number;
  /** Nº de contagens com diferença != 0 — ajustes aplicados. */
  adjustmentCount: number;
}

export interface ImpactInput {
  abcClass: AbcClass;
  /** products.price — valor unitário. */
  unitPrice: number;
  /** products.stock_quantity atual. */
  currentStockQuantity: number;
  /** Quantidade média movimentada por mês (Full Manager, janela de 60 dias). */
  quantityMovedPerMonth: number;
  /** Override manual de criticidade operacional. */
  criticalityLevel: CriticalityLevel;
}

export interface RiskInput extends ProbabilityInput, ImpactInput {}

export interface RiskFactor extends ConfidenceFactorBreakdown {
  max: number;
}

export interface RiskResult {
  hasSufficientData: boolean;
  /** null quando hasSufficientData é false — nunca um score fabricado. */
  riskScore: number | null;
  riskLevel: RiskBand | null;
  /** null quando hasSufficientData é false. Sempre disponível: probabilidade 0-100. */
  probability: number | null;
  /** Impacto é sempre calculável (produto sempre tem preço/estoque, mesmo que zero). */
  impact: number;
  dominantCause: string;
  missingFactors: string[];
  probabilityFactors: Record<string, RiskFactor>;
  impactFactors: Record<string, RiskFactor>;
}

const clamp = (n: number, min = 0, max = 100) => Math.max(min, Math.min(max, n));

// ── Probabilidade (0-100) — só calculável com pelo menos 1 contagem real. ──────

const PROBABILITY_WEIGHTS = {
  divergenceHistory: 35,
  recurrence: 15,
  recency: 20,
  stockouts: 15,
  adjustments: 15,
} as const;

function divergenceHistoryScore(totalCounts: number, divergentCounts: number): RiskFactor {
  const rate = divergentCounts / totalCounts;
  return {
    score: clamp(Math.round(rate * 100)),
    max: 100,
    weight: PROBABILITY_WEIGHTS.divergenceHistory,
    detail: `${divergentCounts} de ${totalCounts} contagem(ns) com divergência (${Math.round(rate * 100)}%)`,
  };
}

function recurrenceScore(repeatOffenseCount: number): RiskFactor {
  return {
    score: clamp(repeatOffenseCount * 20),
    max: 100,
    weight: PROBABILITY_WEIGHTS.recurrence,
    detail: repeatOffenseCount === 0 ? 'Sem reincidência de erros' : `Divergiu em ${repeatOffenseCount} evento(s) de contagem distintos`,
  };
}

function recencyScore(daysSinceLastCount: number): RiskFactor {
  return {
    score: clamp(Math.round(daysSinceLastCount / 2)),
    max: 100,
    weight: PROBABILITY_WEIGHTS.recency,
    detail: `${daysSinceLastCount} dia(s) desde a última contagem`,
  };
}

function stockoutsScore(stockoutCount: number): RiskFactor {
  return {
    score: clamp(stockoutCount * 25),
    max: 100,
    weight: PROBABILITY_WEIGHTS.stockouts,
    detail: stockoutCount === 0 ? 'Sem rupturas de estoque registradas' : `${stockoutCount} ruptura(s) de estoque registrada(s)`,
  };
}

function adjustmentsScore(adjustmentCount: number): RiskFactor {
  return {
    score: clamp(adjustmentCount * 15),
    max: 100,
    weight: PROBABILITY_WEIGHTS.adjustments,
    detail: adjustmentCount === 0 ? 'Sem ajustes de saldo registrados' : `${adjustmentCount} contagem(ns) com ajuste de saldo`,
  };
}

// ── Impacto (0-100) — sempre calculável (produto sempre tem preço/estoque). ───
// Classe ABC ausente reduz o conjunto de fatores e redistribui o peso entre os
// demais, em vez de fingir uma classe.

const IMPACT_WEIGHTS_WITH_ABC = {
  abcClass: 25,
  financialValue: 25,
  demand: 15,
  coverage: 20,
  operationalCriticality: 15,
} as const;

const IMPACT_WEIGHTS_WITHOUT_ABC = {
  financialValue: 34,
  demand: 20,
  coverage: 26,
  operationalCriticality: 20,
} as const;

const ABC_IMPACT_SCORE: Record<'A' | 'B' | 'C', number> = { A: 100, B: 60, C: 25 };
const CRITICALITY_SCORE: Record<CriticalityLevel, number> = { baixa: 20, normal: 50, alta: 80, maxima: 100 };

function abcImpactScore(abcClass: 'A' | 'B' | 'C', weight: number): RiskFactor {
  return {
    score: ABC_IMPACT_SCORE[abcClass],
    max: 100,
    weight,
    detail: `Classe ABC ${abcClass}`,
  };
}

function financialValueScore(unitPrice: number, currentStockQuantity: number, weight: number): RiskFactor {
  const value = unitPrice * Math.max(currentStockQuantity, 0);
  return {
    score: clamp(Math.round(Math.min(value, 50000) / 500)),
    max: 100,
    weight,
    detail: `Valor em estoque de R$ ${value.toFixed(2)}`,
  };
}

function demandScore(quantityMovedPerMonth: number, weight: number): RiskFactor {
  return {
    score: clamp(Math.round(quantityMovedPerMonth / 5)),
    max: 100,
    weight,
    detail: `Demanda média de ${quantityMovedPerMonth.toFixed(1)} unidade(s)/mês`,
  };
}

function coverageScore(currentStockQuantity: number, quantityMovedPerMonth: number, weight: number): RiskFactor {
  const dailyDemand = quantityMovedPerMonth / 30;
  if (dailyDemand <= 0) {
    return { score: 0, max: 100, weight, detail: 'Sem demanda registrada nos últimos 60 dias — risco de ruptura não se aplica' };
  }
  const coverageDays = Math.max(currentStockQuantity, 0) / dailyDemand;
  return {
    score: clamp(Math.round(100 - coverageDays)),
    max: 100,
    weight,
    detail: `Cobertura estimada de ${coverageDays.toFixed(1)} dia(s) de estoque`,
  };
}

function operationalCriticalityScore(criticalityLevel: CriticalityLevel, weight: number): RiskFactor {
  return {
    score: CRITICALITY_SCORE[criticalityLevel],
    max: 100,
    weight,
    detail: criticalityLevel === 'normal' ? 'Criticidade operacional não configurada' : `Criticidade operacional configurada como "${criticalityLevel}"`,
  };
}

function computeImpact(input: ImpactInput): { impact: number; factors: Record<string, RiskFactor>; missingFactors: string[] } {
  const missingFactors: string[] = [];
  const factors: Record<string, RiskFactor> = {};

  if (input.abcClass) {
    const w = IMPACT_WEIGHTS_WITH_ABC;
    factors.abcClass = abcImpactScore(input.abcClass, w.abcClass);
    factors.financialValue = financialValueScore(input.unitPrice, input.currentStockQuantity, w.financialValue);
    factors.demand = demandScore(input.quantityMovedPerMonth, w.demand);
    factors.coverage = coverageScore(input.currentStockQuantity, input.quantityMovedPerMonth, w.coverage);
    factors.operationalCriticality = operationalCriticalityScore(input.criticalityLevel, w.operationalCriticality);
  } else {
    missingFactors.push('Classificação ABC');
    const w = IMPACT_WEIGHTS_WITHOUT_ABC;
    factors.financialValue = financialValueScore(input.unitPrice, input.currentStockQuantity, w.financialValue);
    factors.demand = demandScore(input.quantityMovedPerMonth, w.demand);
    factors.coverage = coverageScore(input.currentStockQuantity, input.quantityMovedPerMonth, w.coverage);
    factors.operationalCriticality = operationalCriticalityScore(input.criticalityLevel, w.operationalCriticality);
  }

  const impact = clamp(Math.round(
    Object.values(factors).reduce((sum, f) => sum + (f.score * f.weight) / 100, 0)
  ));

  return { impact, factors, missingFactors };
}

function bandForScore(score: number): RiskBand {
  if (score >= 80) return 'critico';
  if (score >= 60) return 'alto';
  if (score >= 40) return 'medio';
  return 'baixo';
}

export const RISK_BAND_LABEL: Record<RiskBand, string> = {
  critico: 'Crítico',
  alto: 'Alto',
  medio: 'Moderado',
  baixo: 'Baixo',
};

const CAUSE_LABEL: Record<string, string> = {
  divergenceHistory: 'Divergência recorrente',
  recurrence: 'Reincidência de divergência',
  recency: 'Contagem desatualizada',
  stockouts: 'Ruptura recente',
  adjustments: 'Ajustes de saldo recorrentes',
  abcClass: 'Alta criticidade ABC',
  financialValue: 'Alto valor em estoque',
  demand: 'Alta demanda',
  coverage: 'Baixa cobertura de estoque',
  operationalCriticality: 'Criticidade operacional configurada',
};

function pickDominantCause(probabilityFactors: Record<string, RiskFactor>, impactFactors: Record<string, RiskFactor>): string {
  const all = { ...probabilityFactors, ...impactFactors };
  const ranked = Object.entries(all)
    .map(([key, f]) => ({ key, contribution: (f.score * f.weight) / 100 }))
    .sort((a, b) => b.contribution - a.contribution);
  const top = ranked[0];
  if (!top || top.contribution <= 2) return 'Nenhum fator de risco relevante identificado';
  return CAUSE_LABEL[top.key] ?? top.key;
}

export function computeRiskScore(input: RiskInput): RiskResult {
  const { impact, factors: impactFactors, missingFactors: impactMissing } = computeImpact(input);

  // Dado mínimo para probabilidade: pelo menos uma contagem real. Sem isso, todos
  // os 5 fatores de probabilidade não têm o que medir — mostrar um número aqui
  // seria inventar uma taxa, exatamente o defeito que originou o 22-24 repetido.
  if (input.totalCounts === 0) {
    return {
      hasSufficientData: false,
      riskScore: null,
      riskLevel: null,
      probability: null,
      impact,
      dominantCause: 'Dados insuficientes para calcular a probabilidade (nunca contado)',
      missingFactors: ['Histórico de divergências', 'Reincidência', 'Recência da contagem', 'Rupturas de estoque', 'Ajustes de saldo', ...impactMissing],
      probabilityFactors: {},
      impactFactors,
    };
  }

  const daysSinceLastCount = input.daysSinceLastCount ?? 0;
  const probabilityFactors: Record<string, RiskFactor> = {
    divergenceHistory: divergenceHistoryScore(input.totalCounts, input.divergentCounts),
    recurrence: recurrenceScore(input.repeatOffenseCount),
    recency: recencyScore(daysSinceLastCount),
    stockouts: stockoutsScore(input.stockoutCount),
    adjustments: adjustmentsScore(input.adjustmentCount),
  };

  const probability = clamp(Math.round(
    Object.values(probabilityFactors).reduce((sum, f) => sum + (f.score * f.weight) / 100, 0)
  ));

  const riskScore = clamp(Math.round((probability * impact) / 100));
  const riskLevel = bandForScore(riskScore);
  const dominantCause = pickDominantCause(probabilityFactors, impactFactors);

  return {
    hasSufficientData: true,
    riskScore,
    riskLevel,
    probability,
    impact,
    dominantCause,
    missingFactors: impactMissing,
    probabilityFactors,
    impactFactors,
  };
}
