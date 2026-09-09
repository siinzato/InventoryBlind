// Curva ABC — recomendações por regras determinísticas e parametrizadas. Nenhuma chamada a
// modelo de IA. Cada SKU recebe no máximo uma recomendação: a de maior prioridade entre as
// regras que se aplicam. Nunca executa ação — só sugere, com prioridade/regra/justificativa.

import type { SkuSnapshot } from './abcCurveEngine';
import type { AbcCommercialPolicy } from './abcCurvePolicy';

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

const hasStock = (s: SkuSnapshot): boolean => s.stockAvailable !== null;

// Regras avaliadas em ordem de prioridade — a primeira que se aplicar decide a recomendação.
//
// A política é PARÂMETRO OBRIGATÓRIO, não constante do módulo: os limiares de cobertura e de
// margem que antes viviam fixos aqui (7/30/90 dias, 15%/40%) agora chegam da análise e ficam
// gravados com ela. Sem valor padrão nesta assinatura de propósito — assim nenhum chamador
// consegue produzir recomendação com critério que a análise não registrou.
export const evaluateRecommendation = (s: SkuSnapshot, policy: AbcCommercialPolicy): Recommendation | null => {
  if (s.costState === 'PREJUIZO') {
    return {
      code: 'PREJUIZO',
      priority: 1,
      ruleApplied: 'preco médio abaixo do custo',
      justification: `Preço médio R$ ${s.avgPrice?.toFixed(2)} abaixo do custo R$ ${s.cost?.toFixed(2)} — lucro bruto R$ ${s.grossProfit?.toFixed(2)}.`,
    };
  }

  // Só é problema de cadastro de custo quando existe atividade comercial real no período:
  // sem venda, o custo ausente não impede diagnóstico nenhum, e a informação útil sobre esse
  // SKU é o estoque parado (última regra) — que antes ficava inalcançável por interceptação.
  if (s.costState === 'SEM_CUSTO' && (s.quantity > 0 || s.revenue > 0)) {
    return {
      code: 'CORRIGIR_CUSTO',
      priority: 2,
      ruleApplied: 'venda no período sem custo cadastrado',
      justification: `SKU ${s.sku} vendeu ${s.quantity} unidades sem custo cadastrado — não é possível calcular lucro/margem.`,
    };
  }

  if (s.profitClass === 'A' && hasStock(s)) {
    if (s.stockAvailable! <= 0 || (s.coverageDays !== null && s.coverageDays < policy.lowCoverageDays)) {
      return {
        code: 'COMPRA_URGENTE',
        priority: 3,
        ruleApplied: 'lucro classe A com ruptura ou baixa cobertura',
        justification: `Classe A de lucro (R$ ${s.grossProfit?.toFixed(2)}) com cobertura de ${s.coverageDays?.toFixed(1) ?? '0'} dias (estoque ${s.stockAvailable}).`,
      };
    }
    if (s.coverageDays !== null && s.coverageDays >= policy.healthyCoverageDays) {
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

  if (s.revenueClass === 'A' && s.grossMargin !== null && s.grossMargin < policy.lowMarginPct / 100) {
    return {
      code: 'RENEGOCIAR_CUSTO_OU_PRECO',
      priority: 6,
      ruleApplied: 'faturamento classe A com margem baixa',
      justification: `Faturamento em classe A (R$ ${s.revenue.toFixed(2)}) com margem de ${(s.grossMargin * 100).toFixed(1)}% — abaixo do saudável.`,
    };
  }

  if ((s.profitClass === 'A' || s.profitClass === 'B') && s.grossMargin !== null && s.grossMargin >= policy.strongMarginPct / 100 && s.turnoverClass === 'C') {
    return {
      code: 'PROMOVER',
      priority: 7,
      ruleApplied: 'lucro classe A/B, margem forte e giro baixo',
      justification: `Margem de ${(s.grossMargin * 100).toFixed(1)}% e lucro classe ${s.profitClass}, mas giro em classe C — potencial de promoção.`,
    };
  }

  if (s.profitClass === 'C' && hasStock(s) && s.coverageDays !== null && s.coverageDays > policy.excessCoverageDays) {
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
