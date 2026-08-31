// Classificação ABC+XYZ — motor de classificação.
//
// Duas funções puras, sem I/O. Diferente de CBC/Risco (que pontuam produto a produto de
// forma independente), a classe ABC de um SKU depende do rank dele entre TODOS os SKUs da
// empresa — por isso classifyABCBatch recebe a lista inteira, não um produto isolado. XYZ
// já é independente por produto (previsibilidade da própria demanda), calculado à parte.
//
// Causa raiz do "todo mundo CZ / R$ 0 sempre" (achada por leitura de código + contagem no
// banco, sem alterar dados): a fonte de movimento usada antes (full_operation_items) está
// vazia neste workspace, então quantidade_movimentada e valor_movimentado eram sempre 0
// para todo produto — e os dois branches antigos ("total <= 0 → todos C",
// "menos de 2 meses com movimento → Z") transformavam esse zero universal em CZ universal.
// Não era um erro de fórmula: era ausência real de dado sendo tratada como zero, em vez de
// "sem classificação". Esta reescrita nunca classifica isso como C/Z — ver
// `unclassifiedReason` abaixo.

import type { AbcClass, XyzClass, AbcXyzCombo, AbcXyzUnclassifiedReason } from './supabase';

// ── XYZ — previsibilidade de demanda (coeficiente de variação semanal) ────────

export interface XyzInput {
  /** Quantidade movimentada por semana civil completa dentro do período, mais antiga
   *  primeiro. Semanas sem saída entram como 0 — nunca são omitidas do array. */
  weeklyQuantities: number[];
  /** false quando a empresa nunca teve nenhuma venda importada — distingue "fonte nunca
   *  configurada" (todo o catálogo) de "este SKU sem venda" (produto a produto). */
  sourceConnected: boolean;
}

export interface XyzResult {
  /** null quando unclassifiedReason está preenchido — nunca uma classe fabricada. */
  xyzClass: XyzClass | null;
  coefficientOfVariation: number | null;
  meanWeekly: number | null;
  stdDevWeekly: number | null;
  weeksWithData: number;
  weeksWithoutSale: number;
  unclassifiedReason: AbcXyzUnclassifiedReason | null;
  detail: string;
}

export interface XyzThresholds {
  x: number;
  y: number;
}

export const DEFAULT_XYZ_THRESHOLDS: XyzThresholds = { x: 0.25, y: 0.50 };
export const MIN_COMPLETE_WEEKS = 8;

export function classifyXYZ(input: XyzInput, thresholds: XyzThresholds = DEFAULT_XYZ_THRESHOLDS): XyzResult {
  if (!input.sourceConnected) {
    return {
      xyzClass: null, coefficientOfVariation: null, meanWeekly: null, stdDevWeekly: null,
      weeksWithData: 0, weeksWithoutSale: 0, unclassifiedReason: 'fonte_desconectada',
      detail: 'Nenhuma fonte de vendas configurada para este workspace',
    };
  }

  const weeksWithData = input.weeklyQuantities.length;
  if (weeksWithData < MIN_COMPLETE_WEEKS) {
    return {
      xyzClass: null, coefficientOfVariation: null, meanWeekly: null, stdDevWeekly: null,
      weeksWithData, weeksWithoutSale: input.weeklyQuantities.filter(q => q === 0).length,
      unclassifiedReason: 'historico_insuficiente',
      detail: `Apenas ${weeksWithData} semana(s) completa(s) no período — mínimo de ${MIN_COMPLETE_WEEKS} exigido`,
    };
  }

  const weeksWithoutSale = input.weeklyQuantities.filter(q => q === 0).length;
  const mean = input.weeklyQuantities.reduce((a, b) => a + b, 0) / weeksWithData;
  if (mean === 0) {
    return {
      xyzClass: null, coefficientOfVariation: null, meanWeekly: 0, stdDevWeekly: null,
      weeksWithData, weeksWithoutSale, unclassifiedReason: 'sem_movimento',
      detail: 'Nenhuma saída registrada no período',
    };
  }

  const variance = input.weeklyQuantities.reduce((sum, q) => sum + (q - mean) ** 2, 0) / weeksWithData;
  const stdDev = Math.sqrt(variance);
  const cv = stdDev / mean;
  const xyzClass: XyzClass = cv <= thresholds.x ? 'X' : cv <= thresholds.y ? 'Y' : 'Z';
  const label = xyzClass === 'X' ? 'alta previsibilidade' : xyzClass === 'Y' ? 'variabilidade média' : 'alta variabilidade';

  return {
    xyzClass, coefficientOfVariation: cv, meanWeekly: mean, stdDevWeekly: stdDev,
    weeksWithData, weeksWithoutSale, unclassifiedReason: null,
    detail: `CV de ${cv.toFixed(2)} sobre ${weeksWithData} semanas — ${label}`,
  };
}

// ── ABC — valor movimentado, classificado em lote (Pareto) ────────────────────

export interface AbcBatchInput {
  productId: string;
  /** Soma das quantidades de saída válidas no período (mesma fonte do XYZ). */
  quantityMoved: number;
  /** Custo unitário — do movimento se existir, senão products.price. null = sem custo válido. */
  unitCost: number | null;
  sourceConnected: boolean;
}

export interface AbcBatchResult {
  abcClass: AbcClass | null;
  valueMoved: number | null;
  cumulativePct: number | null;
  unclassifiedReason: AbcXyzUnclassifiedReason | null;
  detail: string;
}

export const ABC_THRESHOLDS = { a: 0.80, b: 0.95 } as const; // A até 80%, B até 95%, C o resto

export function classifyABCBatch(rows: AbcBatchInput[]): Map<string, AbcBatchResult> {
  const result = new Map<string, AbcBatchResult>();

  const eligible: { productId: string; valueMoved: number }[] = [];
  for (const r of rows) {
    if (!r.sourceConnected) {
      result.set(r.productId, { abcClass: null, valueMoved: null, cumulativePct: null, unclassifiedReason: 'fonte_desconectada', detail: 'Nenhuma fonte de vendas configurada para este workspace' });
      continue;
    }
    if (r.unitCost == null) {
      result.set(r.productId, { abcClass: null, valueMoved: null, cumulativePct: null, unclassifiedReason: 'sem_custo', detail: 'Sem custo válido cadastrado — preço de venda não é usado como custo' });
      continue;
    }
    const valueMoved = r.quantityMoved * r.unitCost;
    if (valueMoved <= 0) {
      result.set(r.productId, { abcClass: null, valueMoved: 0, cumulativePct: null, unclassifiedReason: 'sem_movimento', detail: 'Nenhuma saída registrada no período' });
      continue;
    }
    eligible.push({ productId: r.productId, valueMoved });
  }

  const total = eligible.reduce((sum, r) => sum + r.valueMoved, 0);
  if (total <= 0) return result;

  const sorted = [...eligible].sort((a, b) => b.valueMoved - a.valueMoved);
  let cumulative = 0;
  sorted.forEach((r, index) => {
    cumulative += r.valueMoved;
    const cumulativePct = cumulative / total;
    // O item de maior valor é sempre A, mesmo que sozinho ultrapasse 80% do total —
    // Pareto não pode deixar o topo do ranking sem classe por um efeito de arredondamento.
    const abcClass: AbcClass = index === 0 ? 'A' : cumulativePct <= ABC_THRESHOLDS.a ? 'A' : cumulativePct <= ABC_THRESHOLDS.b ? 'B' : 'C';
    result.set(r.productId, {
      abcClass,
      valueMoved: r.valueMoved,
      cumulativePct,
      unclassifiedReason: null,
      detail: `Responde por ${Math.round(cumulativePct * 100)}% do valor movimentado acumulado da empresa`,
    });
  });
  return result;
}

export function combineAbcXyz(abcClass: AbcClass, xyzClass: XyzClass): AbcXyzCombo {
  return `${abcClass}${xyzClass}` as AbcXyzCombo;
}
