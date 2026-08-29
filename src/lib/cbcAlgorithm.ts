// Confidence Based Counting (CBC) — motor de pontuação.
//
// Função pura, sem I/O: recebe os dados brutos já coletados (cbcService.ts busca no banco),
// devolve confiança + prioridade + motivo real de contar + a próxima data de contagem.
//
// Raiz do "76" repetido (achada rastreando o valor até aqui): a versão anterior deste
// arquivo já era uma fórmula real — não um fixture — mas todo SKU sem NENHUM histórico
// (nunca contado, sem picks, sem ajuste, estoque zerado) caía nos mesmos "valores neutros"
// dos 8 fatores antigos, que somados sempre davam 76. Não existia estado "não sei calcular";
// o algoritmo sempre produzia um número. A correção não troca 76 por outro número fixo —
// troca por um estado explícito (`hasSufficientData: false`), quando não há a contagem
// mínima (pelo menos uma contagem real) para basear a confiança.
//
// `RiskLevel` (excelente/bom/medio/critico) continua com as MESMAS 4 chaves de antes —
// é um tipo compartilhado com src/components/slotting/WarehousePositionDrawer.tsx (saúde
// de confiança no Digital Twin do Armazém), fora do escopo desta tarefa. Só os CORTES de
// pontuação e os RÓTULOS exibidos pelo CBC mudaram.

import type { RiskLevel, ConfidenceFactorBreakdown } from './supabase';

export type AbcClass = 'A' | 'B' | 'C' | null;

export interface RecentCount {
  /** Dias desde essa contagem (0 = hoje). */
  daysAgo: number;
  systemQty: number | null;
  physicalQty: number | null;
}

export interface ConfidenceInput {
  abcClass: AbcClass;
  /** Até 5 contagens mais recentes deste SKU-local (mais recente primeiro). Vazio = nunca contado. */
  recentCounts: RecentCount[];
  /** Nº de eventos de contagem distintos com divergência entre as últimas 5 (reincidência). */
  repeatOffenseCount: number;
  /** products.stock_quantity atual. */
  currentStockQuantity: number;
  /** Separações/mês (Full Manager), janela móvel de 60 dias. */
  picksPerMonth: number;
  /** Produto tem marca OU linha associada. */
  hasBrandOrLine: boolean;
  /** products.location não é vazio. */
  hasLocation: boolean;
  /** null = sem EAN cadastrado (não conta contra integridade sozinho); true = EAN válido; false = EAN com dígito verificador errado. */
  eanValid: boolean | null;
}

export interface FactorBreakdown extends ConfidenceFactorBreakdown {
  max: number;
}

export interface ConfidenceResult {
  hasSufficientData: boolean;
  /** null quando hasSufficientData é false. */
  confidenceScore: number | null;
  riskLevel: RiskLevel | null;
  missingFactors: string[];
  factors: Record<'accuracyHistory' | 'recency' | 'stability' | 'integrity', FactorBreakdown>;
  /** Dias-alvo entre contagens para a classe ABC do produto (usado por recência e prioridade). */
  targetIntervalDays: number;
  daysSinceLastCount: number | null;
}

export interface PriorityResult {
  priorityScore: number;
  /** 'calculada' quando a confiança está disponível; 'primeira_avaliacao' quando ainda não há confiança. */
  reason: 'calculada' | 'primeira_avaliacao';
}

const clamp = (n: number, min = 0, max = 100) => Math.max(min, Math.min(max, n));

const TARGET_INTERVAL_DAYS: Record<'A' | 'B' | 'C' | 'none', number> = { A: 15, B: 30, C: 60, none: 90 };

function targetIntervalFor(abcClass: AbcClass): number {
  return TARGET_INTERVAL_DAYS[abcClass ?? 'none'];
}

// A. Histórico de acuracidade — 0 a 40 pontos, pesando mais as contagens recentes.
function accuracyHistoryScore(recentCounts: RecentCount[]): FactorBreakdown {
  const usable = recentCounts.filter(c => c.systemQty != null && c.physicalQty != null);
  if (usable.length === 0) {
    return { score: 0, max: 40, weight: 40, detail: 'Nenhuma contagem com saldo registrado' };
  }
  const weights = [5, 4, 3, 2, 1];
  let weightedSum = 0;
  let weightTotal = 0;
  let divergent = 0;
  usable.slice(0, 5).forEach((c, i) => {
    const system = c.systemQty as number;
    const physical = c.physicalQty as number;
    const accuracy = 1 - Math.min(Math.abs(physical - system) / Math.max(Math.abs(system), 1), 1);
    if (Math.abs(physical - system) > 0) divergent += 1;
    const w = weights[i] ?? 1;
    weightedSum += accuracy * w;
    weightTotal += w;
  });
  const avgAccuracy = weightedSum / weightTotal;
  const score = clamp(Math.round(avgAccuracy * 40), 0, 40);
  return {
    score, max: 40, weight: 40,
    detail: divergent === 0
      ? `${usable.length} contagem(ns) recente(s) sem divergência`
      : `${divergent} de ${usable.length} contagem(ns) recente(s) com divergência`,
  };
}

// B. Recência da contagem — 0 a 25 pontos.
function recencyScore(daysSinceLastCount: number | null, targetIntervalDays: number): FactorBreakdown {
  if (daysSinceLastCount === null) {
    return { score: 0, max: 25, weight: 25, detail: 'Nunca foi contado' };
  }
  const score = clamp(Math.round(25 * (1 - daysSinceLastCount / targetIntervalDays)), 0, 25);
  return {
    score, max: 25, weight: 25,
    detail: `Última contagem há ${daysSinceLastCount} dia(s) · intervalo-alvo ${targetIntervalDays} dias`,
  };
}

// C. Estabilidade operacional — 0 a 20 pontos, começando em 20 e descontando
// eventos reais (nunca o mesmo evento duas vezes: estoque negativo e ruptura
// são mutuamente exclusivos por definição de currentStockQuantity).
function stabilityScore(input: ConfidenceInput): FactorBreakdown {
  let score = 20;
  const notes: string[] = [];
  if (input.currentStockQuantity < 0) { score -= 8; notes.push('saldo negativo'); }
  else if (input.currentStockQuantity === 0) { score -= 5; notes.push('ruptura de estoque'); }
  if (input.repeatOffenseCount >= 2) { score -= 5; notes.push(`${input.repeatOffenseCount} eventos de contagem com divergência`); }
  if (input.picksPerMonth > 30) { score -= 3; notes.push('movimentação atípica'); }
  score = clamp(score, 0, 20);
  return {
    score, max: 20, weight: 20,
    detail: notes.length === 0 ? 'Sem eventos de instabilidade' : notes.join(', '),
  };
}

// D. Integridade dos dados — 0 a 15 pontos. Ausência de EAN sozinha NUNCA é
// penalizada (eanValid === null); só EAN presente e inválido conta.
function integrityScore(input: ConfidenceInput, recentCounts: RecentCount[]): FactorBreakdown {
  let score = 15;
  const notes: string[] = [];
  if (!input.hasLocation) { score -= 5; notes.push('localização não cadastrada'); }
  if (input.eanValid === false) { score -= 5; notes.push('EAN com dígito verificador inválido'); }
  if (!input.hasBrandOrLine) { score -= 3; notes.push('sem marca/linha associada'); }
  const malformed = recentCounts.slice(0, 5).filter(c => c.systemQty == null || c.physicalQty == null).length;
  if (malformed > 0) { score -= Math.min(malformed * 2, 4); notes.push(`${malformed} contagem(ns) com referência incompleta`); }
  score = clamp(score, 0, 15);
  return {
    score, max: 15, weight: 15,
    detail: notes.length === 0 ? 'Sem falhas de integridade' : notes.join(', '),
  };
}

function bandForScore(score: number): RiskLevel {
  if (score >= 90) return 'excelente'; // "Alta"
  if (score >= 70) return 'bom';       // "Estável"
  if (score >= 40) return 'medio';     // "Atenção"
  return 'critico';                    // "Crítica"
}

export function computeConfidenceScore(input: ConfidenceInput): ConfidenceResult {
  const targetIntervalDays = targetIntervalFor(input.abcClass);
  const usableCounts = input.recentCounts.filter(c => c.systemQty != null && c.physicalQty != null);
  const daysSinceLastCount = input.recentCounts.length > 0 ? input.recentCounts[0].daysAgo : null;

  // Dado mínimo para confiar num score: pelo menos uma contagem real com saldo comparável.
  // Sem isso, histórico e recência não têm o que medir — mostrar um número aqui seria
  // inventar uma média, exatamente o defeito que originou o 76 repetido.
  if (usableCounts.length === 0) {
    const stability = stabilityScore(input);
    const integrity = integrityScore(input, input.recentCounts);
    return {
      hasSufficientData: false,
      confidenceScore: null,
      riskLevel: null,
      missingFactors: ['Histórico de acuracidade', 'Recência da contagem'],
      factors: {
        accuracyHistory: { score: 0, max: 40, weight: 40, detail: 'Nenhuma contagem registrada ainda' },
        recency: { score: 0, max: 25, weight: 25, detail: 'Nunca foi contado' },
        stability,
        integrity,
      },
      targetIntervalDays,
      daysSinceLastCount,
    };
  }

  const accuracyHistory = accuracyHistoryScore(input.recentCounts);
  const recency = recencyScore(daysSinceLastCount, targetIntervalDays);
  const stability = stabilityScore(input);
  const integrity = integrityScore(input, input.recentCounts);

  const confidenceScore = clamp(accuracyHistory.score + recency.score + stability.score + integrity.score, 0, 100);

  return {
    hasSufficientData: true,
    confidenceScore,
    riskLevel: bandForScore(confidenceScore),
    missingFactors: [],
    factors: { accuracyHistory, recency, stability, integrity },
    targetIntervalDays,
    daysSinceLastCount,
  };
}

const CRITICALITY_BASE: Record<'A' | 'B' | 'C' | 'none', number> = { A: 100, B: 65, C: 35, none: 50 };

function vencimentoUrgency(daysSinceLastCount: number | null, targetIntervalDays: number): number {
  if (daysSinceLastCount === null) return 85; // nunca contado — urgente, mas não "vencido" no sentido literal
  const ratio = daysSinceLastCount / targetIntervalDays;
  if (ratio <= 1) return clamp(ratio * 70, 0, 70);
  const overdueFactor = Math.min((ratio - 1) / 0.5, 1); // atinge 100 quando ~1.5x o intervalo-alvo
  return clamp(70 + overdueFactor * 30, 0, 100);
}

function criticidadeOperacional(input: ConfidenceInput): number {
  let score = CRITICALITY_BASE[input.abcClass ?? 'none'];
  if (input.currentStockQuantity < 0) score += 15;
  else if (input.currentStockQuantity === 0) score += 10;
  if (input.repeatOffenseCount >= 2) score += 10;
  if (input.picksPerMonth > 30) score += 5;
  return clamp(score, 0, 100);
}

export function computePriority(input: ConfidenceInput, confidence: ConfidenceResult): PriorityResult {
  const urgencia = vencimentoUrgency(confidence.daysSinceLastCount, confidence.targetIntervalDays);
  const criticidade = criticidadeOperacional(input);

  if (confidence.hasSufficientData && confidence.confidenceScore != null) {
    const priorityScore = clamp((100 - confidence.confidenceScore) * 0.65 + urgencia * 0.20 + criticidade * 0.15, 0, 100);
    return { priorityScore: Math.round(priorityScore), reason: 'calculada' };
  }

  // Sem confiança disponível: prioridade provisória usando só vencimento + criticidade,
  // redistribuindo o peso que seria de "100 - confiança" entre os dois (0,65 -> 0,65/0,35).
  const priorityScore = clamp(urgencia * 0.65 + criticidade * 0.35, 0, 100);
  return { priorityScore: Math.round(priorityScore), reason: 'primeira_avaliacao' };
}

/** "Por que contar" — motivo real e específico da linha, nunca um texto genérico igual
 *  para todos. Prioriza a causa mais operacionalmente relevante. */
export function buildWhyToCount(input: ConfidenceInput, confidence: ConfidenceResult): string {
  const reasons: string[] = [];
  const { daysSinceLastCount, targetIntervalDays } = confidence;

  if (daysSinceLastCount === null) {
    reasons.push('Nunca contado');
  } else if (daysSinceLastCount > targetIntervalDays) {
    reasons.push(`Vencida há ${daysSinceLastCount - targetIntervalDays} dias`);
  }

  const divergentRecent = input.recentCounts.slice(0, 5).filter(c =>
    c.systemQty != null && c.physicalQty != null && c.systemQty !== c.physicalQty
  ).length;
  if (divergentRecent >= 2) reasons.push(`${divergentRecent} divergências recentes`);
  else if (divergentRecent === 1) reasons.push('1 divergência recente');

  if (input.picksPerMonth > 30) reasons.push('Alta movimentação');

  if (input.abcClass === 'A' && daysSinceLastCount !== null && daysSinceLastCount <= targetIntervalDays
    && (targetIntervalDays - daysSinceLastCount) <= 5) {
    reasons.push('Classe A próxima do prazo');
  }

  if (input.currentStockQuantity < 0) reasons.push('Saldo negativo');
  else if (input.currentStockQuantity === 0 && daysSinceLastCount !== null) reasons.push('Ruptura de estoque');

  if (reasons.length === 0) reasons.push('Saldo consistente');

  return reasons.slice(0, 2).join(' · ');
}

export const RISK_LEVEL_LABEL: Record<RiskLevel, string> = {
  excelente: 'Alta',
  bom: 'Estável',
  medio: 'Atenção',
  critico: 'Crítica',
};
