// Curva ABC — recomendações por regras determinísticas e parametrizadas. Nenhuma chamada a
// modelo de IA. Cada SKU recebe no máximo uma recomendação: a de maior prioridade entre as
// regras que se aplicam. Nunca executa ação — só sugere, com prioridade/regra/justificativa.

import type { SkuSnapshot } from './abcCurveEngine';

export type RecommendationCode =
  | 'PREJUIZO' | 'CORRIGIR_CUSTO' | 'COMPRA_URGENTE' | 'PROTEGER_DISPONIBILIDADE'
  | 'REVISAR_PRECO_CUSTO' | 'RENEGOCIAR_CUSTO_OU_PRECO' | 'PROMOVER'
  | 'REDUZIR_COMPRA_OU_LIQUIDAR' | 'ESTOQUE_PARADO';

export interface Recommendation {
  code: RecommendationCode;
  priority: number;
  ruleApplied: string;
  justification: string;
}

// Limiares locais do módulo (não configuráveis via UI nesta versão) — documentados aqui porque
// o pedido não especificou um número exato para "baixa/alta cobertura" ou "margem forte/baixa".
const LOW_COVERAGE_DAYS = 7;
const HEALTHY_COVERAGE_DAYS = 30;
const EXCESS_COVERAGE_DAYS = 90;
const STRONG_MARGIN = 0.4;
const LOW_MARGIN = 0.15;

const hasStock = (s: SkuSnapshot): boolean => s.stockAvailable !== null;

// Regras avaliadas em ordem de prioridade — a primeira que se aplicar decide a recomendação.
export const evaluateRecommendation = (s: SkuSnapshot): Recommendation | null => {
  if (s.costState === 'PREJUIZO') {
    return {
      code: 'PREJUIZO',
      priority: 1,
      ruleApplied: 'preco médio abaixo do custo',
      justification: `Preço médio R$ ${s.avgPrice?.toFixed(2)} abaixo do custo R$ ${s.cost?.toFixed(2)} — lucro bruto R$ ${s.grossProfit?.toFixed(2)}.`,
    };
  }

  if (s.costState === 'SEM_CUSTO') {
    return {
      code: 'CORRIGIR_CUSTO',
      priority: 2,
      ruleApplied: 'custo ausente',
      justification: `SKU ${s.sku} vendeu ${s.quantity} unidades sem custo cadastrado — não é possível calcular lucro/margem.`,
    };
  }

  if (s.profitClass === 'A' && hasStock(s)) {
    if (s.stockAvailable! <= 0 || (s.coverageDays !== null && s.coverageDays < LOW_COVERAGE_DAYS)) {
      return {
        code: 'COMPRA_URGENTE',
        priority: 3,
        ruleApplied: 'lucro classe A com ruptura ou baixa cobertura',
        justification: `Classe A de lucro (R$ ${s.grossProfit?.toFixed(2)}) com cobertura de ${s.coverageDays?.toFixed(1) ?? '0'} dias (estoque ${s.stockAvailable}).`,
      };
    }
    if (s.coverageDays !== null && s.coverageDays >= HEALTHY_COVERAGE_DAYS) {
      return {
        code: 'PROTEGER_DISPONIBILIDADE',
        priority: 4,
        ruleApplied: 'lucro classe A com cobertura saudável',
        justification: `Classe A de lucro (R$ ${s.grossProfit?.toFixed(2)}) com cobertura de ${s.coverageDays.toFixed(1)} dias — manter disponibilidade.`,
      };
    }
  }

  if (s.turnoverClass === 'A' && (s.profitClass === 'B' || s.profitClass === 'C')) {
    return {
      code: 'REVISAR_PRECO_CUSTO',
      priority: 5,
      ruleApplied: 'giro classe A com lucro classe B/C',
      justification: `Alto giro (classe A, ${s.quantity} unidades) mas lucro em classe ${s.profitClass} — revisar preço ou custo.`,
    };
  }

  if (s.revenueClass === 'A' && s.grossMargin !== null && s.grossMargin < LOW_MARGIN) {
    return {
      code: 'RENEGOCIAR_CUSTO_OU_PRECO',
      priority: 6,
      ruleApplied: 'faturamento classe A com margem baixa',
      justification: `Faturamento em classe A (R$ ${s.revenue.toFixed(2)}) com margem de ${(s.grossMargin * 100).toFixed(1)}% — abaixo do saudável.`,
    };
  }

  if ((s.profitClass === 'A' || s.profitClass === 'B') && s.grossMargin !== null && s.grossMargin >= STRONG_MARGIN && s.turnoverClass === 'C') {
    return {
      code: 'PROMOVER',
      priority: 7,
      ruleApplied: 'lucro classe A/B, margem forte e giro baixo',
      justification: `Margem de ${(s.grossMargin * 100).toFixed(1)}% e lucro classe ${s.profitClass}, mas giro em classe C — potencial de promoção.`,
    };
  }

  if (s.profitClass === 'C' && hasStock(s) && s.coverageDays !== null && s.coverageDays > EXCESS_COVERAGE_DAYS) {
    return {
      code: 'REDUZIR_COMPRA_OU_LIQUIDAR',
      priority: 8,
      ruleApplied: 'lucro classe C com excesso de estoque',
      justification: `Lucro em classe C com ${s.coverageDays.toFixed(1)} dias de cobertura — reduzir compra ou liquidar.`,
    };
  }

  if (s.quantity === 0 && hasStock(s) && (s.stockAvailable ?? 0) > 0) {
    return {
      code: 'ESTOQUE_PARADO',
      priority: 9,
      ruleApplied: 'sem venda no período com estoque disponível',
      justification: `Nenhuma venda no período, mas ${s.stockAvailable} unidades em estoque.`,
    };
  }

  return null;
};
