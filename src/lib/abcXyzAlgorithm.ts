// Classificação ABC+XYZ — motor de classificação.
//
// Duas funções puras, sem I/O. Diferente de CBC/Risco (que pontuam produto a produto de
// forma independente), a classe ABC de um SKU depende do rank dele entre TODOS os SKUs da
// empresa — por isso classifyABCBatch recebe a lista inteira, não um produto isolado. XYZ
// já é independente por produto (previsibilidade da própria demanda), calculado à parte.

import type { AbcClass, XyzClass, AbcXyzCombo } from './supabase';

// ── XYZ — previsibilidade de demanda (coeficiente de variação) ────────────────

export interface XyzResult {
  xyzClass: XyzClass;
  coefficientOfVariation: number | null;
  detail: string;
}

const XYZ_THRESHOLDS = { x: 0.5, y: 1.0 } as const; // limiares clássicos de gestão de estoque

/** `monthlyQuantities` = quantidade movimentada por mês, últimos 12 meses (mesmo se 0 em
 *  meses sem movimento — o zero entra no cálculo, não é omitido). */
export function classifyXYZ(monthlyQuantities: number[]): XyzResult {
  const withData = monthlyQuantities.filter(q => q > 0);
  if (withData.length < 2) {
    return { xyzClass: 'Z', coefficientOfVariation: null, detail: 'Movimento insuficiente para prever demanda — tratado como imprevisível' };
  }

  const mean = monthlyQuantities.reduce((a, b) => a + b, 0) / monthlyQuantities.length;
  if (mean === 0) {
    return { xyzClass: 'Z', coefficientOfVariation: null, detail: 'Sem movimento no período' };
  }

  const variance = monthlyQuantities.reduce((sum, q) => sum + (q - mean) ** 2, 0) / monthlyQuantities.length;
  const stdDev = Math.sqrt(variance);
  const cv = stdDev / mean;

  const xyzClass: XyzClass = cv <= XYZ_THRESHOLDS.x ? 'X' : cv <= XYZ_THRESHOLDS.y ? 'Y' : 'Z';
  const label = xyzClass === 'X' ? 'alta previsibilidade' : xyzClass === 'Y' ? 'variabilidade média' : 'alta variabilidade';
  return { xyzClass, coefficientOfVariation: cv, detail: `CV de ${cv.toFixed(2)} — ${label}` };
}

// ── ABC — valor movimentado, classificado em lote (Pareto) ────────────────────

export interface AbcBatchInput {
  productId: string;
  valueMovedAnnual: number;
}

export interface AbcBatchResult {
  abcClass: AbcClass;
  cumulativePct: number;
  detail: string;
}

const ABC_THRESHOLDS = { a: 0.80, b: 0.95 } as const; // A até ~80%, B até ~95%, C o resto

export function classifyABCBatch(rows: AbcBatchInput[]): Map<string, AbcBatchResult> {
  const total = rows.reduce((sum, r) => sum + r.valueMovedAnnual, 0);
  const result = new Map<string, AbcBatchResult>();

  if (total <= 0) {
    for (const r of rows) {
      result.set(r.productId, { abcClass: 'C', cumulativePct: 0, detail: 'Sem valor movimentado no período' });
    }
    return result;
  }

  const sorted = [...rows].sort((a, b) => b.valueMovedAnnual - a.valueMovedAnnual);
  let cumulative = 0;
  for (const r of sorted) {
    cumulative += r.valueMovedAnnual;
    const cumulativePct = cumulative / total;
    const abcClass: AbcClass = cumulativePct <= ABC_THRESHOLDS.a ? 'A' : cumulativePct <= ABC_THRESHOLDS.b ? 'B' : 'C';
    result.set(r.productId, {
      abcClass,
      cumulativePct,
      detail: `Responde por ${Math.round(cumulativePct * 100)}% do valor movimentado acumulado da empresa`,
    });
  }
  return result;
}

export function combineAbcXyz(abcClass: AbcClass, xyzClass: XyzClass): AbcXyzCombo {
  return `${abcClass}${xyzClass}` as AbcXyzCombo;
}
